'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {MAX_FILE}=require('./vault.cjs');
const {userMetadata}=require('./attachments.cjs');
class Uploads{
 constructor(getVault,nativeImage){this.getVault=getVault;this.nativeImage=nativeImage;this.pending=new Map();}
 clear(){for(const token of this.pending.keys())this.cancel(token);}
 cancel(token){const batch=this.pending.get(token);if(batch){for(const file of batch.files)file.data.fill(0);this.pending.delete(token);}return true;}
 stage(recordId,paths){
  const record=recordId?this.getVault().record(recordId):{category:'收集箱',fields:{},deleted:false};if(record.deleted)throw new Error('请先恢复资料再导入附件。');
  if(!Array.isArray(paths)||!paths.length||paths.length>50)throw new Error('每次请选择 1～50 个图片或 PDF 文件。');
  for(const [token,batch]of this.pending)if(Date.now()-batch.created>10*60000)this.cancel(token);
  const files=[],errors=[];let total=[...this.pending.values()].reduce((n,b)=>n+b.files.reduce((s,f)=>s+f.data.length,0),0);
  for(const filename of paths){
   let data;
   try{
    if(typeof filename!=='string'||!path.isAbsolute(filename)||!fs.statSync(filename).isFile())throw new Error('请选择本机文件，暂不支持文件夹。');
    const size=fs.statSync(filename).size;if(!size||size>MAX_FILE)throw new Error('单个附件应大于 0 且不超过 20 MiB。');
    if(total+size>100*1024*1024)throw new Error('本次附件合计超过 100 MiB，请分批导入。');
    const name=path.basename(filename),ext=path.extname(name).toLowerCase();
    const mime=({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.bmp':'image/bmp','.pdf':'application/pdf'})[ext];
    if(!mime)throw new Error('支持 JPG、PNG、WEBP、BMP 图片与 PDF。');
    data=fs.readFileSync(filename);if(data.length>MAX_FILE)throw new Error('附件超过 20 MiB。');const metadata={};let thumbnail=null;
    if(mime==='application/pdf'){if(data.subarray(0,5).toString()!=='%PDF-')throw new Error('PDF 文件头无效。');}
    else{
     const image=this.nativeImage.createFromBuffer(data);if(image.isEmpty())throw new Error('图片无法读取。');
     const {width,height}=image.getSize();if(width*height>40000000)throw new Error('图片超过 4000 万像素。');
     Object.assign(metadata,{width,height,format:ext.slice(1).toUpperCase()});
     thumbnail=image.resize({width:Math.max(1,Math.round(width*Math.min(1,240/width,180/height))),height:Math.max(1,Math.round(height*Math.min(1,240/width,180/height)))}).toDataURL();
    }
    files.push({id:crypto.randomUUID(),name,mime,size:data.length,data,metadata,thumbnail});total+=data.length;data=null;
   }catch(error){errors.push(path.basename(String(filename))+'：'+error.message);}finally{if(data)data.fill(0);}
  }
  if(!files.length)return {token:null,files:[],errors};
  const token=crypto.randomUUID();this.pending.set(token,{recordId,files,created:Date.now()});
  return {token,files:files.map(({data,metadata,...file})=>file),errors};
 }
 commitTo(token,recordId){const batch=this.pending.get(token);if(!batch)throw new Error('待上传附件已失效，请重新选择。');if(batch.recordId&&batch.recordId!==recordId)throw new Error('附件目标已变更，请重新选择。');batch.recordId=recordId;return this.commit(token,batch.files.map(file=>({id:file.id})));}
 commit(token,items){
  const batch=this.pending.get(token);if(!batch||Date.now()-batch.created>10*60000){this.cancel(token);throw new Error('待上传附件已过期，请重新选择。');}
  const vault=this.getVault(),record=vault.record(batch.recordId);
  if(record.deleted)throw new Error('资料已移入回收站，请先恢复。');
  if(!Array.isArray(items)||items.length!==batch.files.length||new Set(items.map(item=>item.id)).size!==items.length)throw new Error('待上传附件列表不匹配。');
  const prepared=batch.files.map(file=>{const item=items.find(item=>item.id===file.id);if(!item)throw new Error('待上传附件不存在。');return {...file,metadata:{...file.metadata,...userMetadata(record,item)}};});
  let added=0;const errors=[],ids=[];
  try{for(const file of prepared)try{ids.push(vault.addAttachment(batch.recordId,file.name,file.data,file.metadata));added++;}catch(error){errors.push(file.name+'：'+error.message);}}
  finally{this.cancel(token);}
  return {added,errors,ids};
 }
}
module.exports={Uploads};
