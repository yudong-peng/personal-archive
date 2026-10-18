'use strict';
const crypto=require('node:crypto');
const PROVIDER='Microsoft Passport Key Storage Provider';
const DOMAIN=Buffer.from('PersonalArchive/Hello/signature-wrap/v1');
const KEY_RE=/^S-\d(?:-\d+)+\/\/PersonalArchive\/OfflineArchive\/[a-f0-9]{32}$/;
const UNSUPPORTED=new Set([0x80090029,0x80090011,0x80090027,0x8009000a,0x80070032,0x32]);
class HelloError extends Error{
 constructor(stage,status){super(`Windows Hello 操作未完成。\n失败步骤：${stage}\n诊断码：0x${(status>>>0).toString(16).toUpperCase().padStart(8,'0')}\n仍可使用主密码或恢复密钥登录。`);this.stage=stage;this.status=status>>>0;}
}
function checked(status,stage){if(status!==0)throw new HelloError(stage,status);}
function assertSilent(status){if((status>>>0)!==0x80090022)throw new HelloError('检查是否禁止静默签名',status===0?0xa0040003:status);}
function signatureKey(signature,challenge,publicKey){
 if(signature.length!==256||challenge.length!==32||!crypto.verify('sha256',Buffer.concat([DOMAIN,challenge]),{key:publicKey,padding:crypto.constants.RSA_PKCS1_PADDING},signature))throw new HelloError('核对系统签名',0xa0040004);
 return Buffer.from(crypto.hkdfSync('sha256',signature,challenge,DOMAIN,32));
}
class WindowsHelloNative{
 constructor(){
  if(process.platform!=='win32')throw new Error('此设备不是 Windows，主密码仍可使用。');
  const koffi=require('koffi');
  // ncrypt.dll is a Windows system library; never search the program folder.
  const lib=koffi.load(require('node:path').join(process.env.SystemRoot||'C:\\Windows','System32','ncrypt.dll'));
  const padding=koffi.struct('PersonalArchivePkcs1Padding',{algorithm:'str16'});
  this.koffi=koffi;this.padding=padding;this.fn={
   openProvider:lib.func('int32_t __stdcall NCryptOpenStorageProvider(_Out_ uintptr_t *provider, str16 name, uint32_t flags)'),
   create:lib.func('int32_t __stdcall NCryptCreatePersistedKey(uintptr_t provider, _Out_ uintptr_t *key, str16 algorithm, str16 name, uint32_t legacy, uint32_t flags)'),
   open:lib.func('int32_t __stdcall NCryptOpenKey(uintptr_t provider, _Out_ uintptr_t *key, str16 name, uint32_t legacy, uint32_t flags)'),
   set:lib.func('int32_t __stdcall NCryptSetProperty(uintptr_t object, str16 name, const void *data, uint32_t length, uint32_t flags)'),
   get:lib.func('int32_t __stdcall NCryptGetProperty(uintptr_t object, str16 name, void *data, uint32_t length, _Out_ uint32_t *written, uint32_t flags)'),
   finalize:lib.func('int32_t __stdcall NCryptFinalizeKey(uintptr_t key, uint32_t flags)'),
   sign:lib.func('NCryptSignHash','int32_t',['uintptr_t',koffi.pointer(padding),'const void *','uint32_t','void *','uint32_t',koffi.out(koffi.pointer('uint32_t')),'uint32_t']),
   export:lib.func('int32_t __stdcall NCryptExportKey(uintptr_t key, uintptr_t exportKey, str16 kind, void *parameters, void *output, uint32_t size, _Out_ uint32_t *written, uint32_t flags)'),
   free:lib.func('int32_t __stdcall NCryptFreeObject(uintptr_t object)'),
   delete:lib.func('int32_t __stdcall NCryptDeleteKey(uintptr_t key, uint32_t flags)')
  };
 }
 invoke(fn,...args){return new Promise((resolve,reject)=>fn.async(...args,(error,status)=>error?reject(new HelloError('调用系统安全接口',0xa0040005)):resolve(status)));}
 async newKeyName(){
  const executable=require('node:path').join(process.env.SystemRoot||'C:\\Windows','System32','whoami.exe');
  const output=await new Promise((resolve,reject)=>require('node:child_process').execFile(executable,['/user','/fo','csv','/nh'],{windowsHide:true,timeout:10000,maxBuffer:16384},(error,stdout)=>error?reject(new HelloError('读取当前 Windows 用户标识',0xa004000b)):resolve(stdout)));
  const sid=output.match(/\bS-\d(?:-\d+)+\b/);
  if(!sid)throw new HelloError('读取当前 Windows 用户标识',0xa004000b);
  return sid[0]+'//PersonalArchive/OfflineArchive/'+crypto.randomUUID().replaceAll('-','');
 }
 provider(){const output=[0];checked(this.fn.openProvider(output,PROVIDER,0),'打开 Windows Hello 密钥提供程序');return output[0];}
 checkName(name){if(!KEY_RE.test(name))throw new HelloError('核对本应用密钥名称',0xa0040006);}
 set(key,name,value,stage){checked(this.fn.set(key,name,value,value.length,0),stage);}
 uint(value){const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;}
 hwnd(owner){const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(owner||0));return b;}
 read(key,name){const output=Buffer.alloc(256),length=[0];checked(this.fn.get(key,name,output,output.length,length,0),'核对系统密钥保护策略');if(length[0]>output.length)throw new HelloError('核对系统密钥保护策略',0xa0040007);return output.subarray(0,length[0]);}
 validate(key){
  let cache;try{cache=this.read(key,'NgcCacheType');}catch(error){if(!UNSUPPORTED.has(error.status))throw error;cache=this.read(key,'NgcCacheTypeProperty');}
  const policy=this.read(key,'Export Policy'),usage=this.read(key,'Key Usage'),length=this.read(key,'Length');
  if(cache.length!==4||cache.readUInt32LE()!==1||policy.length!==4||policy.readUInt32LE()!==0||usage.length!==4||!(usage.readUInt32LE()&2)||length.length!==4||length.readUInt32LE()!==2048)throw new HelloError('核对不可导出与每次验证策略',0xa0040001);
 }
 fresh(key,owner){
  this.set(key,'HWND Handle',this.hwnd(owner),'绑定系统验证窗口');
  this.set(key,'Use Context',Buffer.from('解锁个人档案库\0','utf16le'),'设置验证说明');
  this.set(key,'PinCacheIsGestureRequired',this.uint(1),'要求新的系统验证');
 }
 openKey(name,owner){
  this.checkName(name);const provider=this.provider(),out=[0];
  try{checked(this.fn.open(provider,out,name,0,0),'打开本应用系统密钥');}finally{this.fn.free(provider);}
  try{this.validate(out[0]);this.set(out[0],'HWND Handle',this.hwnd(owner),'绑定系统验证窗口');return out[0];}catch(error){this.fn.free(out[0]);throw error;}
 }
 async create(name,owner){
  this.checkName(name);let provider,key;
  try{
   provider=this.provider();const out=[0];checked(this.fn.create(provider,out,'RSA',name,0,0),'创建本应用系统密钥');key=out[0];
   this.set(key,'Length',this.uint(2048),'设置密钥长度');this.set(key,'Key Usage',this.uint(2),'设置签名用途');
   let status=this.fn.set(key,'NgcCacheType',this.uint(1),4,0);
   if(UNSUPPORTED.has(status>>>0))status=this.fn.set(key,'NgcCacheTypeProperty',this.uint(1),4,0);
   checked(status,'设置每次验证策略');
   this.set(key,'HWND Handle',this.hwnd(owner),'绑定系统验证窗口');
   this.set(key,'Use Context',Buffer.from('启用个人档案库 Windows Hello\0','utf16le'),'设置验证说明');
   checked(await this.invoke(this.fn.finalize,key,0),'完成系统密钥创建');this.validate(key);
  }catch(error){if(key){if(this.fn.delete(key,0)!==0)this.fn.free(key);key=null;}throw error;}
  finally{if(key)this.fn.free(key);if(provider)this.fn.free(provider);}
 }
 publicKey(key){
  const length=[0];checked(this.fn.export(key,0,'RSAPUBLICBLOB',null,null,0,length,0),'读取系统公钥');
  if(length[0]<24||length[0]>1024)throw new HelloError('核对系统公钥',0xa0040008);
  const output=Buffer.alloc(length[0]);checked(this.fn.export(key,0,'RSAPUBLICBLOB',null,output,output.length,length,0),'读取系统公钥');
  if(output.readUInt32LE(0)!==0x31415352||output.readUInt32LE(4)!==2048||output.readUInt32LE(12)!==256||output.readUInt32LE(16)!==0||output.readUInt32LE(20)!==0)throw new HelloError('核对系统公钥',0xa0040008);
  const exponent=output.readUInt32LE(8);if(exponent<1||exponent>8||output.length!==24+exponent+256)throw new HelloError('核对系统公钥',0xa0040008);
  return crypto.createPublicKey({format:'jwk',key:{kty:'RSA',e:output.subarray(24,24+exponent).toString('base64url'),n:output.subarray(24+exponent).toString('base64url')}});
 }
 silent(key,hash){const output=Buffer.alloc(256),length=[0];try{assertSilent(this.fn.sign(key,{algorithm:'SHA256'},hash,hash.length,output,output.length,length,2|0x40));}finally{output.fill(0);}}
 async derive(name,challenge,owner){
  if(!Buffer.isBuffer(challenge)||challenge.length!==32)throw new HelloError('核对解锁挑战',0xa0040009);
  const key=this.openKey(name,owner),signature=Buffer.alloc(256),length=[0];let derived;
  try{
   const hash=crypto.createHash('sha256').update(DOMAIN).update(challenge).digest();
   this.fresh(key,owner);this.silent(key,hash);this.fresh(key,owner);
   checked(await this.invoke(this.fn.sign,key,{algorithm:'SHA256'},hash,hash.length,signature,signature.length,length,2),'请求 Windows Hello 验证并签名');
   if(length[0]!==256)throw new HelloError('核对系统签名长度',0xa004000a);
   derived=signatureKey(signature,challenge,this.publicKey(key));
   this.fresh(key,owner);this.silent(key,hash);
   const result=derived;derived=null;return result;
  }finally{signature.fill(0);if(derived)derived.fill(0);this.fn.free(key);}
 }
 async delete(name){this.checkName(name);const provider=this.provider(),out=[0];let key;
  try{const status=this.fn.open(provider,out,name,0,0);if((status>>>0)===0x80090016)return;checked(status,'打开本应用系统密钥');key=out[0];checked(this.fn.delete(key,0),'删除本应用系统密钥');key=null;}finally{if(key)this.fn.free(key);this.fn.free(provider);}
 }
}
module.exports={WindowsHelloNative,HelloError,signatureKey,assertSilent,DOMAIN,KEY_RE};
