'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Vault,fields,formatRecord}=require('../app/vault.cjs');
const model=require('../renderer/form-model.js');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archive-forms-'));
 const {vault}=await Vault.create(path.join(dir,'archive.pav'),'Forms test password!');
 t.after(()=>{vault.close();fs.rmSync(dir,{recursive:true,force:true});});return {vault,dir};
}
test('personal and family titles are fixed and active records are singletons',async t=>{
 const {vault}=await fixture(t);
 for(const category of fields.singletons){
  const id=vault.saveRecord({category,title:'任意标题',fields:{邮政编码:'010020'}});
  assert.equal(vault.record(id).title,category);
  assert.throws(()=>vault.saveRecord({category,title:'第二份'}),/只能保存一份/);
  vault.saveRecord({...vault.record(id),title:'改名',fields:{邮政编码:'000001'}});
  assert.equal(vault.record(id).title,category);assert.equal(vault.record(id).fields.邮政编码,'000001');
 }
});
test('restore and reclassification cannot bypass singleton constraint',async t=>{
 const {vault}=await fixture(t),category='个人基本信息';
 const a=vault.saveRecord({category});vault.trash([a],true);
 const b=vault.saveRecord({category});
 assert.throws(()=>vault.trash([a],false),/已有一份/);assert.equal(vault.record(a).deleted,1);
 const c=vault.saveRecord({category:'其他资料',title:'其他资料'});
 assert.throws(()=>vault.saveRecord({...vault.record(c),category}),/只能保存一份/);
 vault.trash([b],true);vault.trash([a],false);assert.equal(vault.records({category}).length,1);
 vault.trash([a],true);
 assert.throws(()=>vault.trash([a,b],false),/已有一份/);assert.equal(vault.records({category}).length,0);
});
test('legacy duplicate migration is backed up, idempotent, and retains attachments and collections',async t=>{
 const {vault,dir}=await fixture(t);
 const a=vault.saveRecord({category:'个人基本信息',fields:{姓名:'旧档案'}});
 const b=vault.saveRecord({category:'其他资料',title:'旧标题',fields:{姓名:'新档案'}});
 vault.db.run('UPDATE records SET category=?,updated=? WHERE id=?',['个人基本信息','2099-01-01T00:00:00Z',b]);
 const attachment=vault.addAttachment(a,'证明.pdf',Buffer.from('%PDF-1.4\n%%EOF'));
 const collection=vault.createCollection('历史清单');vault.addToCollection(collection,[a,b]);
 assert.equal(vault.upgradeForms(),true);assert.equal(vault.upgradeForms(),false);
 assert.equal(vault.records({category:'个人基本信息'}).length,1);assert.equal(vault.record(b).title,'个人基本信息');
 assert.equal(vault.record(b).fields.原资料标题,'旧标题');assert.equal(vault.record(a).deleted,1);
 assert.equal(vault.attachment(attachment).record_id,a);assert.equal(vault.records({collection,deleted:true}).length,1);
 const backups=fs.readdirSync(path.join(dir,'backups')).filter(n=>n.startsWith('before-forms-'));assert.equal(backups.length,1);
 const old=await Vault.open(path.join(dir,'backups',backups[0]),'Forms test password!');
 try{assert.equal(old.records({category:'个人基本信息'}).length,2);}finally{old.close();}
});
test('education stage must be chosen, controls title, and permits multiple schools',async t=>{
 const {vault}=await fixture(t);
 assert.throws(()=>vault.saveRecord({category:'就学经历',title:'自拟标题'}),/先选择就学阶段/);
 for(const school of ['甲大学','乙大学']){
  const id=vault.saveRecord({category:'就学经历',title:'自拟标题',fields:{就学阶段:'本科',学校:school}});
  assert.equal(vault.record(id).title,'本科');
 }
 assert.equal(vault.records({category:'就学经历'}).length,2);
});
test('stage fields distinguish school, undergraduate and postgraduate education',()=>{
 for(const stage of ['小学','初中','高中','中专','职高','技校']){
  const names=model.names('就学经历',stage,fields);
  for(const name of ['成绩或GPA','排名','研究方向'])assert.ok(!names.includes(name));
  assert.ok(names.includes('班级干部'));
 }
 assert.ok(model.names('就学经历','本科',fields).includes('学院干部'));
 assert.ok(!model.names('就学经历','本科',fields).includes('研究方向'));
 assert.ok(model.names('就学经历','硕士',fields).includes('导师'));
 assert.equal(model.stageOf({title:'硕士学习经历',fields:{}},fields),'硕士');
});
test('all ethnicity entries and requested dropdowns are provided',()=>{
 assert.equal(fields.suggestions.民族.length,57);assert.equal(new Set(fields.suggestions.民族).size,57);
 assert.equal(fields.suggestions.民族[0],'汉族');assert.equal(fields.suggestions.民族.at(-1),'其他');
 assert.deepEqual(fields.selects.性别,['男','女','其他']);assert.equal(fields.selects.政治面貌.length,6);
});
test('structured relatives, custom email domains and partial dates survive encryption and export',async t=>{
 const {vault,dir}=await fixture(t);
 const relatives=[{关系:'父亲',姓名:'测试甲',工作单位:'测试公司',职位:'工程师',联系电话:'01012345678',邮箱:'parent@example.edu',出生日期:'1965-03'},
 {关系:'自填关系',姓名:'测试乙',备注:'<script>内容保持原样</script>'}];
 const id=vault.saveRecord({category:'家庭信息',fields:{家庭住址:'测试地址',邮政编码:'010000',亲属信息:JSON.stringify(relatives)}});
 const p=vault.saveRecord({category:'个人基本信息',fields:{邮箱:'user@school.example.edu',出生日期:'1999',民族:'自填民族'}});
 const backup=path.join(dir,'test.pav');vault.backup(backup);const reopened=await Vault.open(backup,'Forms test password!');
 try{assert.deepEqual(JSON.parse(reopened.record(id).fields.亲属信息),relatives);assert.equal(reopened.record(p).fields.邮箱,'user@school.example.edu');}finally{reopened.close();}
 const text=formatRecord(vault.record(id));assert.match(text,/父亲/);assert.match(text,/职位：工程师/);assert.doesNotMatch(text,/\{"关系"/);
 assert.throws(()=>vault.saveRecord({category:'家庭信息',fields:{亲属信息:'not-json'}}),/亲属信息格式/);
});
