'use strict';
const fs=require('node:fs'),path=require('node:path');
const {zipSync,strToU8}=require('fflate');
const {atomicWrite,formatRecord}=require('./vault.cjs');
const FormModel=require('../renderer/form-model.js');
const {displayName}=require('./attachments.cjs');
const safeName=text=>path.basename(String(text)).replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/[ .]+$/,'').slice(0,100)||'附件';
class Downloads{
 constructor(configFile,defaultDirectory){
  this.configFile=configFile;this.defaultDirectory=path.resolve(defaultDirectory);this.directory=this.defaultDirectory;this.error=null;
  if(fs.existsSync(configFile))try{
   const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
   if(config.version!==1||!path.isAbsolute(config.directory))throw new Error('invalid');
   this.directory=path.resolve(config.directory);
  }catch{this.error='默认下载目录配置无法读取，请在设置中重新选择。';}
 }
 info(){return {downloadDirectory:this.directory,downloadError:this.error};}
 set(directory){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||!fs.statSync(directory).isDirectory())throw new Error('请选择有效的下载文件夹。');
  fs.accessSync(directory,fs.constants.W_OK);
  atomicWrite(this.configFile,Buffer.from(JSON.stringify({version:1,directory:path.resolve(directory)},null,2)));
  this.directory=path.resolve(directory);this.error=null;return this.info();
 }
 write(name,bytes,directory){
  if(!directory&&this.error)throw new Error(this.error);
  const selected=directory||this.directory;
  if(!path.isAbsolute(selected))throw new Error('请选择有效的导出文件夹。');
  if(selected===this.defaultDirectory&&!directory)fs.mkdirSync(selected,{recursive:true});
  if(!fs.existsSync(selected)||!fs.statSync(selected).isDirectory())throw new Error('下载目录暂时不可用，请连接原磁盘或选择其他位置。');
  const base=safeName(name),ext=path.extname(base),stem=base.slice(0,base.length-ext.length);
  for(let i=0;i<10000;i++){
   const filename=path.join(selected,stem+(i?` (${i})`:'')+ext);let fd;
   try{fd=fs.openSync(filename,'wx',0o600);}catch(error){if(error.code==='EEXIST')continue;throw error;}
   try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}catch(error){fs.closeSync(fd);try{fs.unlinkSync(filename);}catch{}throw error;}
   fs.closeSync(fd);return {saved:true,path:filename};
  }
  throw new Error('同名文件过多，请选择其他导出位置。');
 }
}
function filteredRecords(records,options){
 if(options.fields!==undefined&&(!Array.isArray(options.fields)||options.fields.some(f=>typeof f!=='string')))throw new Error('导出字段选择无效。');
 return records.map(({reminders,aiUndoAvailable,...record})=>({...record,fields:Object.fromEntries(Object.entries(record.fields).filter(([name])=>!options.fields||options.fields.includes(name))),
  versions:options.includeDescriptions===false?{}:record.versions,notes:options.includeNotes===false?'':record.notes}));
}
function csvCell(value){
 let text=String(value??'');if(/^[\s]*[=+\-@]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
function buildExport(vault,ids,version,kind,options={}){
 if(!['zip','attachments','images','txt','json','csv'].includes(kind))throw new Error('请选择支持的导出格式。');
 if(!Array.isArray(ids)||!ids.length)throw new Error('请先选择资料。');
 const originals=[...new Set(ids)].map(id=>vault.record(id)).filter(r=>!r.deleted);
 if(!originals.length)throw new Error('没有可导出的有效资料。');
 const group=options.attachmentGroup||'all';
 if(!['all','general','document','profile-photo'].includes(group))throw new Error('附件范围选择无效。');
 const selectedAttachments=id=>vault.attachments(id).filter(info=>group==='all'||(info.metadata.role||'general')===group);
 const records=filteredRecords(originals,options).map(record=>({...record,attachments:selectedAttachments(record.id)})),stamp=new Date().toISOString().replace(/[-:]/g,'').slice(0,15).replace('T','-');
 const ext=['attachments','images'].includes(kind)?'zip':kind;
 const title=kind==='images'?'原始图片':kind==='attachments'?'原始附件':'个人材料';
 const name=`${title}-${stamp}.${ext}`;
 if(kind==='txt')return {name,data:Buffer.from('\ufeff'+records.map(r=>formatRecord(r,version)).join('\n\n──────────\n\n'))};
 if(kind==='json')return {name,data:Buffer.from(JSON.stringify({format:'PersonalArchive-export',version:1,exportedAt:new Date().toISOString(),records},null,2))};
 if(kind==='csv'){
  const keys=[...new Set(records.flatMap(r=>Object.keys(r.fields)))];
  const header=['资料标题','资料分类',...keys,...(options.includeDescriptions===false?[]:[version]),...(options.includeNotes===false?[]:['备注'])];
  const rows=records.map(r=>[r.title,r.category,...keys.map(k=>FormModel.display(k,r.fields[k]||'')),...(options.includeDescriptions===false?[]:[r.versions[version]||'']),...(options.includeNotes===false?[]:[r.notes])]);
  return {name,data:Buffer.from('\ufeff'+[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'))};
 }
 const entries={},index=[];
 for(const record of records){
  for(const info of record.attachments){
   if(kind==='images'&&!info.mime.startsWith('image/'))continue;
   const folder=`${safeName(record.category)}/${safeName(record.title)}_${record.id.slice(0,8)}`;
   const file=`原始附件/${folder}/${info.id.slice(0,8)}_${safeName(displayName(info))}`;
   entries[file]=vault.attachment(info.id).data;
   index.push({资料标题:record.title,资料分类:record.category,原文件名:info.name,附件名称:displayName(info),说明:info.metadata.description||'',附件分类:info.metadata.role||'general',关联证件:info.metadata.documentId||'',页别:info.metadata.pageLabel||'',导出路径:file,类型:info.mime,字节数:info.size});
  }
 }
 if(kind!=='zip'&&!index.length)throw new Error(kind==='images'?'所选范围中没有图片。':'所选范围中没有附件。');
 entries['附件索引.json']=strToU8(JSON.stringify(index,null,2));
 if(kind==='zip'){
  entries['资料汇总.txt']=strToU8('\ufeff'+records.map(r=>formatRecord(r,version)).join('\n\n──────────\n\n'));
  entries['结构化资料.json']=strToU8(JSON.stringify(records,null,2));
 }
 return {name,data:Buffer.from(zipSync(entries)),attachmentCount:index.length};
}
module.exports={Downloads,buildExport};
