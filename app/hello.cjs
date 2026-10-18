'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Vault,atomicWrite}=require('./vault.cjs');
const {WindowsHelloNative,KEY_RE}=require('./hello-native.cjs');
const SLOT_KEYS=['version','kdf','salt','pw_nonce','pw_wrap','rec_nonce','rec_wrap'];
const AAD=Buffer.from('PersonalArchive/Hello/device-envelope/v1');
function binding(header){const data={};for(const key of SLOT_KEYS){if(header[key]===undefined)throw new Error('档案头部不完整。');data[key]=header[key];}return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');}
function readBinding(filename){
 const fd=fs.openSync(filename,'r');try{
  const prefix=Buffer.alloc(13);if(fs.readSync(fd,prefix,0,13,0)!==13||prefix.subarray(0,9).toString('hex')!=='504152434849564501')throw new Error('不是受支持的档案。');
  const size=prefix.readUInt32BE(9);if(size<100||size>4096)throw new Error('档案头部无效。');
  const data=Buffer.alloc(size);if(fs.readSync(fd,data,0,size,13)!==size)throw new Error('档案头部不完整。');return binding(JSON.parse(data.toString('utf8')));
 }finally{fs.closeSync(fd);}
}
function decode(text,length){if(typeof text!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw new Error('本机 Windows Hello 记录格式无效。');const data=Buffer.from(text,'base64');if(length&&data.length!==length)throw new Error('本机 Windows Hello 记录长度无效。');return data;}
function seal(key,bound,dataKey,challenge,keyName){
 const nonce=crypto.randomBytes(12),payload=Buffer.concat([Buffer.from(bound,'hex'),dataKey]),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
 try{cipher.setAAD(Buffer.concat([AAD,Buffer.from(bound,'hex'),challenge]));const ciphertext=Buffer.concat([cipher.update(payload),cipher.final(),cipher.getAuthTag()]);return {version:1,binding:bound,keyName,challenge:challenge.toString('base64'),nonce:nonce.toString('base64'),ciphertext:ciphertext.toString('base64')};}finally{payload.fill(0);}
}
function openRecord(record,key,expected){
 if(record.version!==1||record.binding!==expected||!KEY_RE.test(record.keyName))throw new Error('Windows Hello 记录与当前档案不匹配，请使用主密码重新启用。');
 const challenge=decode(record.challenge,32),nonce=decode(record.nonce,12),ciphertext=decode(record.ciphertext,80);
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(Buffer.concat([AAD,Buffer.from(expected,'hex'),challenge]));decipher.setAuthTag(ciphertext.subarray(-16));
 let payload;try{payload=Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]);if(payload.length!==64||!crypto.timingSafeEqual(payload.subarray(0,32),Buffer.from(expected,'hex')))throw new Error('设备凭据未通过档案绑定校验。');return Buffer.from(payload.subarray(32));}finally{if(payload)payload.fill(0);}
}
class Hello{
 constructor(directory,{supported=process.platform==='win32',nativeFactory=()=>new WindowsHelloNative()}={}){this.directory=directory;this.supported=supported;this.nativeFactory=nativeFactory;this.nativeInstance=null;}
 native(){if(!this.supported)throw new Error('Windows Hello 仅在 Windows 上可用，主密码仍可使用。');return this.nativeInstance ||= this.nativeFactory();}
 filename(bound){if(!/^[a-f0-9]{64}$/.test(bound))throw new Error('档案绑定无效。');return path.join(this.directory,'hello-'+bound+'.json');}
 status(filename){
  if(!this.supported)return {supported:false,enabled:false,reason:'此系统不支持 Windows Hello'};
  try{const bound=readBinding(filename);return {supported:true,enabled:fs.existsSync(this.filename(bound)),reason:null};}
  catch{return {supported:true,enabled:false,reason:null};}
 }
 read(bound){const filename=this.filename(bound);if(fs.statSync(filename).size>8192)throw new Error('Windows Hello 本机记录过大。');const record=JSON.parse(fs.readFileSync(filename,'utf8'));if(record.version!==1||record.binding!==bound||!KEY_RE.test(record.keyName))throw new Error('Windows Hello 记录无效，请使用主密码重新启用。');decode(record.challenge,32);decode(record.nonce,12);decode(record.ciphertext,80);return record;}
 async enable(vault,password,owner,ensureCurrent=()=>{}){
  const verified=await Vault.open(vault.filename,password);try{if(!crypto.timingSafeEqual(verified.key,vault.key))throw new Error('主密码验证与当前档案不匹配。');}finally{verified.close();}
  ensureCurrent();
  const bound=binding(vault.header),filename=this.filename(bound),native=this.native();
  const challenge=crypto.randomBytes(32),keyName=native.newKeyName?await native.newKeyName():'S-1-0-0//PersonalArchive/OfflineArchive/'+crypto.randomUUID().replaceAll('-','');let key,key2,payloadKey,created=false,oldRecord;
  ensureCurrent();
  try{
   if(fs.existsSync(filename)){try{oldRecord=this.read(bound);}catch{}}
   await native.create(keyName,owner);created=true;ensureCurrent();
   key=await native.derive(keyName,challenge,owner);ensureCurrent();
   const record=seal(key,bound,vault.key,challenge,keyName);key.fill(0);key=null;
   key2=await native.derive(keyName,challenge,owner);ensureCurrent();payloadKey=openRecord(record,key2,bound);key2.fill(0);key2=null;
   const test=await Vault.openWithKey(vault.filename,payloadKey);test.close();
   ensureCurrent();atomicWrite(filename,Buffer.from(JSON.stringify(record,null,2)));
   created=false;
   if(oldRecord){try{await native.delete(oldRecord.keyName);}catch{}}
   return true;
  }catch(error){if(created){try{await native.delete(keyName);}catch{}}throw error;}
  finally{if(key)key.fill(0);if(key2)key2.fill(0);if(payloadKey)payloadKey.fill(0);}
 }
 async unlock(filename,owner){
  const bound=readBinding(filename),record=this.read(bound);let key,dataKey;
  try{key=await this.native().derive(record.keyName,decode(record.challenge,32),owner);dataKey=openRecord(record,key,bound);return await Vault.openWithKey(filename,dataKey);}
  catch(error){if(error.stage)throw error;throw new Error('Windows Hello 解锁未完成，可能已取消验证或本机凭据失效。主密码仍可使用。');}
  finally{if(key)key.fill(0);if(dataKey)dataKey.fill(0);}
 }
 async disable(filename){
  const bound=readBinding(filename),recordPath=this.filename(bound);if(!fs.existsSync(recordPath))return;
  let record;try{record=this.read(bound);}catch{}
  // Revocation does not require another successful gesture. Orphan native keys
  // cannot unlock this archive without the deleted authenticated envelope.
  fs.unlinkSync(recordPath);if(record){try{await this.native().delete(record.keyName);}catch{}}
 }
}
module.exports={Hello,binding,readBinding,seal,openRecord};
