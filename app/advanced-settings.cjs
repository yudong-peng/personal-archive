'use strict';
const fs=require('node:fs');
const {atomicWrite}=require('./vault.cjs');
const DEFAULTS={remindersEnabled:true,reminderDays:30,systemNotifications:false,floatingEnabled:false,floatingTopmost:true,floatingOpacity:85,closeToTray:false,autoStart:false,aiEnabled:false,provider:'compatible',baseURL:'https://api.openai.com/v1',model:'',timeoutSeconds:120,maxPages:6};
function checked(input,current=DEFAULTS){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('设置格式无效。');
 const next={...current};
 for(const key of ['remindersEnabled','systemNotifications','floatingEnabled','floatingTopmost','closeToTray','autoStart','aiEnabled'])if(input[key]!==undefined){if(typeof input[key]!=='boolean')throw new Error('开关设置无效。');next[key]=input[key];}
 for(const [key,min,max]of [['reminderDays',1,3650],['floatingOpacity',60,100],['timeoutSeconds',10,300],['maxPages',1,20]])if(input[key]!==undefined){if(!Number.isInteger(input[key])||input[key]<min||input[key]>max)throw new Error('数值设置超出允许范围：'+key);next[key]=input[key];}
 for(const key of ['baseURL','model','provider'])if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>2000)throw new Error('接口设置无效。');next[key]=input[key].trim();}
 if(!['compatible','openai','qwen','deepseek','local'].includes(next.provider))throw new Error('服务商设置无效。');
 endpoint(next.baseURL);if(next.model.length>200||/[\r\n]/.test(next.model))throw new Error('模型名称无效。');
 return next;
}
function endpoint(base){
 let url;try{url=new URL(base);}catch{throw new Error('请输入有效的 API 地址。');}
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&local))throw new Error('API 地址应使用 HTTPS；本机模型可使用 localhost HTTP。');
 url.pathname=url.pathname.replace(/\/+$/,'')+'/chat/completions';return url;
}
class AdvancedSettings{
 constructor(filename,safeStorage){this.filename=filename;this.safeStorage=safeStorage;this.value={...DEFAULTS};this.secret=null;this.sessionKey='';this.error=null;
  if(fs.existsSync(filename))try{const saved=JSON.parse(fs.readFileSync(filename,'utf8'));this.value=checked(saved.settings);if(saved.key)this.secret=saved.key;}catch{this.error='高级设置无法读取，请重新保存。';}
 }
 protectedAvailable(){return this.safeStorage.isEncryptionAvailable()&&(!this.safeStorage.getSelectedStorageBackend||this.safeStorage.getSelectedStorageBackend()!=='basic_text');}
 info(){return {...this.value,keyConfigured:!!(this.secret||this.sessionKey),keyPersistent:!!this.secret,keyStorageAvailable:this.protectedAvailable(),error:this.error};}
 key(){if(this.sessionKey)return this.sessionKey;if(!this.secret)return '';try{return this.safeStorage.decryptString(Buffer.from(this.secret,'base64'));}catch{throw new Error('本机 API 密钥无法解密，请重新输入并保存。');}}
 update(input){
  const next=checked(input,this.value);let secret=this.secret,sessionKey=this.sessionKey;
  if(input.clearKey){secret=null;sessionKey='';}
  if(input.apiKey!==undefined&&input.apiKey!==''){
   if(typeof input.apiKey!=='string'||input.apiKey.length>8192||/[\r\n]/.test(input.apiKey))throw new Error('API Key 格式无效。');
   if(this.protectedAvailable()){secret=this.safeStorage.encryptString(input.apiKey.trim()).toString('base64');sessionKey='';}else{secret=null;sessionKey=input.apiKey.trim();}
  }
  atomicWrite(this.filename,Buffer.from(JSON.stringify({version:1,settings:next,key:secret},null,2)));this.value=next;this.secret=secret;this.sessionKey=sessionKey;this.error=null;return this.info();
 }
 lock(){this.sessionKey='';}
}
module.exports={DEFAULTS,checked,endpoint,AdvancedSettings};
