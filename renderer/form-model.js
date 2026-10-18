'use strict';
// Shared by the renderer and vault: stage rules and readable structured fields.
const FormModel=(()=>{
 function stageOf(record,config){
  const values=record?.fields||{};
  if(Object.hasOwn(config.educationStages,values['就学阶段']))return values['就学阶段'];
  for(const text of [values['学历'],record?.title]){
   if(!text)continue;
   for(const stage of ['博士','硕士','本科','专科','中专','职高','技校','高中','初中','小学'])if(text.includes(stage))return stage;
  }
  return '';
 }
 function names(category,stage,config){return category==='就学经历'?['就学阶段',...(config.educationStages[stage]||[])]:config.categories[category];}
 function relatives(value){if(!value)return [];try{const rows=JSON.parse(value);if(Array.isArray(rows)&&rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r)))return rows;}catch{}return null;}
 function display(name,value){
  if(name==='证件资料'){
   try{return JSON.parse(value).map(doc=>doc.type+'\n'+Object.entries(doc.fields).filter(([,v])=>v).map(([k,v])=>`${k}：${v}`).join('\n')).join('\n\n');}catch{return value;}
  }
  if(name==='亲属信息'){
   const rows=relatives(value);
   if(rows)return rows.map((r,i)=>`亲属 ${i+1}\n`+Object.entries(r).filter(([,v])=>v).map(([k,v])=>`${k}：${v}`).join('\n')).join('\n\n');
  }
  return value;
 }
 return {stageOf,names,relatives,display};
})();
if(typeof module!=='undefined')module.exports=FormModel;
