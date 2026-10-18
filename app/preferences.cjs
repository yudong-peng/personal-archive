'use strict';
const fs=require('node:fs');
const {atomicWrite}=require('./vault.cjs');
class Preferences{
 constructor(filename){
  this.filename=filename;this.value={theme:'system',detailRatio:0.4};
  if(fs.existsSync(filename))try{const value=JSON.parse(fs.readFileSync(filename,'utf8'));this.value=this.checked(value);}catch{}
 }
 checked(value){
  const result={...this.value};
  if(value.theme!==undefined){if(!['light','dark','system'].includes(value.theme))throw new Error('主题选项无效。');result.theme=value.theme;}
  if(value.detailRatio!==undefined){if(typeof value.detailRatio!=='number'||!Number.isFinite(value.detailRatio)||value.detailRatio<0.2||value.detailRatio>0.7)throw new Error('分栏宽度无效。');result.detailRatio=value.detailRatio;}
  return result;
 }
 update(value){const next=this.checked(value);atomicWrite(this.filename,Buffer.from(JSON.stringify(next,null,2)));this.value=next;return {...next};}
 info(){return {...this.value};}
}
module.exports={Preferences};
