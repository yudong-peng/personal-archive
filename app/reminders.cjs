'use strict';
const DAY=86400000;
function localDay(now=new Date()){return Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());}
function endDate(value){
 if(typeof value!=='string'||!/^(\d{4})(-\d{2})?(-\d{2})?$/.test(value))return null;
 const [y,m,d]=value.split('-').map(Number);if(y<1900||y>9999||m!==undefined&&(m<1||m>12))return null;
 const date=new Date(Date.UTC(y,m===undefined?11:m-1,d===undefined?1:d));
 if(d===undefined)date.setUTCMonth(date.getUTCMonth()+1,0);
 if(d!==undefined&&(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d))return null;
 return date.getTime();
}
function listReminders(records,settings,now=new Date()){
 const today=localDay(now),items=[];
 for(const record of records){
  if(record.deleted)continue;
  const add=(key,label,value)=>{
   const config=record.reminders?.[key]||{},date=endDate(value),long=/长期|永久|无期限/.test(value||'');
   const days=date===null?null:Math.round((date-today)/DAY),advance=config.days??settings.reminderDays;
   const status=long?'long':days===null?'missing':days<0?'expired':days===0?'today':days<=advance?'soon':'normal';
   const snoozed=endDate(config.snoozeUntil)!==null&&endDate(config.snoozeUntil)>=today;
   items.push({recordId:record.id,key,label,title:record.title,category:record.category,value:value||'',days,status,enabled:config.enabled!==false,advance,snoozed,actionable:settings.remindersEnabled&&config.enabled!==false&&!snoozed&&['expired','today','soon'].includes(status)});
  };
  if(record.category==='证书资质')add('record',record.fields['证书名称']||record.title,record.fields['有效期截止']||record.fields['有效期']);
  let documents=[];try{documents=JSON.parse(record.fields['证件资料']||'[]');}catch{}
  for(const doc of documents)add(doc.id,doc.fields['证件名称']||doc.type,doc.fields['有效期截止']);
 }
 return items.sort((a,b)=>(a.days??Infinity)-(b.days??Infinity));
}
module.exports={DAY,localDay,endDate,listReminders};
