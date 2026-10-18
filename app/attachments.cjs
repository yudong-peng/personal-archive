'use strict';
const path=require('node:path');
const fields=require('./fields.json');
function documents(record){
 const text=record.fields['证件资料'];if(!text)return [];
 try{const result=JSON.parse(text);if(Array.isArray(result))return result;}catch{}
 throw new Error('证件资料格式不正确。');
}
function validateDocuments(value){
 if(!value)return;
 let rows;try{rows=JSON.parse(value);}catch{throw new Error('证件资料格式不正确。');}
 if(!Array.isArray(rows)||rows.length>50)throw new Error('证件资料最多可保存 50 组。');
 const ids=new Set();
 for(const row of rows){
  if(!row||typeof row.id!=='string'||!row.id||row.id.length>100||ids.has(row.id)||!Object.hasOwn(fields.documentTypes,row.type)||!row.fields||typeof row.fields!=='object'||Array.isArray(row.fields)||Object.entries(row.fields).some(([k,v])=>!fields.documentTypes[row.type].includes(k)||typeof v!=='string'))throw new Error('证件字段、类型或标识无效。');
  ids.add(row.id);
 }
}
function displayName(attachment){
 const value=attachment.metadata?.displayName?.trim();if(!value)return attachment.name;
 const extension=path.extname(attachment.name);
 return value.toLowerCase().endsWith(extension.toLowerCase())?value:value+extension;
}
function userMetadata(record,input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('附件信息格式无效。');
 const result={};
 for(const [key,max]of [['displayName',150],['description',2000],['pageLabel',100]]){
  if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>max)throw new Error('附件名称或说明过长。');result[key]=input[key].trim();}
 }
 if(result.displayName&&/[\x00-\x1f<>:"/\\|?*]/.test(result.displayName))throw new Error('附件名称不能包含路径或文件名禁用字符。');
 result.role=input.role||'general';result.documentId=input.documentId||'';
 if(!['general','profile-photo','document'].includes(result.role))throw new Error('请选择有效的附件分类。');
 if(result.role!=='general'&&record.category!=='个人基本信息')throw new Error('个人照片和证件图片只能关联个人基本信息。');
 if(result.role==='document'){
  if(typeof result.documentId!=='string'||!documents(record).some(doc=>doc.id===result.documentId))throw new Error('请先选择本份个人档案中的证件。');
 }else{result.documentId='';result.pageLabel='';}
 return result;
}
module.exports={documents,validateDocuments,displayName,userMetadata};
