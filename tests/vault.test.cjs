'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Vault,formatRecord,encodeRecovery,decodeRecovery}=require('../app/vault.cjs');
const PASSWORD='Archive test password 2026!';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'personal-archive-test-')),filename=path.join(dir,'archive.pav');
 const {vault,recovery}=await Vault.create(filename,PASSWORD);
 t.after(()=>{vault.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,filename,vault,recovery};
}
function record(vault,title='项目经历测试') {return vault.saveRecord({category:'项目经历',title,fields:{个人角色:'负责人',个人贡献:'数据库设计与系统实现'},versions:{完整记录:'完整记录正文',简短描述:'简短项目描述'},tags:['升学','科研']});}
const PDF=Buffer.from('%PDF-1.4\n%%EOF');
test('password, encrypted text/attachment storage and reopening',async t=>{
 const {vault,filename}=await fixture(t);const id=record(vault,'敏感测试经历');const aid=vault.addAttachment(id,'证明.pdf',PDF);
 assert.equal(vault.attachment(aid).data.toString(),PDF.toString());
 const raw=fs.readFileSync(filename);assert.equal(raw.includes(Buffer.from('敏感测试经历')),false);assert.equal(raw.includes(PDF),false);assert.equal(raw.includes(Buffer.from('SQLite format')),false);
 const reopened=await Vault.open(filename,PASSWORD);try{assert.equal(reopened.record(id).title,'敏感测试经历');assert.equal(reopened.attachment(aid).data.toString(),PDF.toString());}finally{reopened.close();}
});
test('wrong password and tampering preserve original file',async t=>{
 const {filename,dir}=await fixture(t);const original=fs.readFileSync(filename);
 await assert.rejects(Vault.open(filename,'incorrect password'));assert.deepEqual(fs.readFileSync(filename),original);
 const tampered=Buffer.from(original);tampered[tampered.length-1]^=1;const target=path.join(dir,'tampered.pav');fs.writeFileSync(target,tampered);
 await assert.rejects(Vault.open(target,PASSWORD));
});
test('recovery key is base32 compatible and survives password change',async t=>{
 const {vault,filename,recovery}=await fixture(t);assert.equal(encodeRecovery(decodeRecovery(recovery)),recovery);
 record(vault);await vault.changePassword('Changed test password 2027!');await assert.rejects(Vault.open(filename,PASSWORD));
 const reopened=await Vault.open(filename,'Changed test password 2027!');reopened.close();
 const recovered=await Vault.open(filename,recovery,true);assert.equal(recovered.records().length,1);recovered.close();
});
test('CRUD, custom fields, Unicode, multi-term search and tags',async t=>{
 const {vault}=await fixture(t),id=record(vault);
 const r=vault.record(id);r.fields['自定义字段']='院级成果';r.title='修改后的项目';vault.saveRecord(r);
 assert.equal(vault.record(id).fields['自定义字段'],'院级成果');assert.equal(vault.records({query:'科研 系统实现'}).length,1);
 assert.equal(vault.records({query:'不存在'}).length,0);assert.equal(vault.records({category:'获奖经历'}).length,0);
 vault.trash([id],true);assert.equal(vault.records().length,0);assert.equal(vault.records({deleted:true}).length,1);
 vault.trash([id],false);assert.equal(vault.records().length,1);
});
test('attachment duplicate detection and records do not rely on source paths',async t=>{
 const {vault}=await fixture(t),id=record(vault);const a=vault.addAttachment(id,'证明.pdf',PDF);
 assert.throws(()=>vault.addAttachment(id,'另一个名字.pdf',PDF),/相同附件/);
 assert.deepEqual(vault.attachment(a).data,PDF);assert.equal(vault.attachments(id)[0].size,PDF.length);
 vault.deleteAttachment(a);assert.equal(vault.attachments(id).length,0);
});
test('collection references, trash visibility, restore and cascade deletion',async t=>{
 const {vault}=await fixture(t),id=record(vault);vault.addAttachment(id,'证明.pdf',PDF);
 const c=vault.createCollection('夏令营申请');vault.addToCollection(c,[id,id]);assert.equal(vault.records({collection:c}).length,1);
 vault.trash([id],true);assert.equal(vault.records({collection:c}).length,0);vault.trash([id],false);assert.equal(vault.records({collection:c}).length,1);
 vault.trash([id],true);vault.purge([id]);assert.equal(vault.attachments(id).length,0);assert.equal(vault.records({collection:c}).length,0);
});
test('deleting a collection preserves original records and attachments',async t=>{
 const {vault}=await fixture(t),id=record(vault);vault.addAttachment(id,'证明.pdf',PDF);const c=vault.createCollection('求职');vault.addToCollection(c,[id]);vault.deleteCollection(c);
 assert.equal(vault.records().length,1);assert.equal(vault.attachments(id).length,1);
});
test('complete backup restores attachments and collections, preserves current password',async t=>{
 const {vault,filename,dir}=await fixture(t),id=record(vault);vault.addAttachment(id,'证明.pdf',PDF);const c=vault.createCollection('申请');vault.addToCollection(c,[id]);
 const backup=path.join(dir,'backup.pav');vault.backup(backup);record(vault,'后来添加');await vault.changePassword('Current password 2027!');
 const before=await vault.restore(backup,PASSWORD);assert.equal(vault.records().length,1);assert.equal(vault.attachments(id).length,1);assert.equal(vault.records({collection:c}).length,1);
 const current=await Vault.open(filename,'Current password 2027!');current.close();
 const original=await Vault.open(before,'Current password 2027!');assert.equal(original.records().length,2);original.close();
});
test('backup restoration accepts recovery key',async t=>{
 const {vault,dir,recovery}=await fixture(t);record(vault);const backup=path.join(dir,'backup.pav');vault.backup(backup);record(vault,'后来添加');await vault.restore(backup,recovery,true);assert.equal(vault.records().length,1);
});
test('invalid restore credentials do not modify active content',async t=>{
 const {vault,filename,dir}=await fixture(t);record(vault);const backup=path.join(dir,'backup.pav');vault.backup(backup);const previous=fs.readFileSync(filename);
 await assert.rejects(vault.restore(backup,'incorrect credential'));assert.deepEqual(fs.readFileSync(filename),previous);assert.equal(vault.records().length,1);
});
test('failed disk write rolls back in-memory and on-disk state',async t=>{
 const {vault,filename}=await fixture(t);record(vault);const previous=fs.readFileSync(filename),rename=fs.renameSync;
 fs.renameSync=(from,to)=>{if(to===filename)throw new Error('simulated disk full');return rename(from,to);};
 try{assert.throws(()=>record(vault,'不能提交'),/disk full/);}finally{fs.renameSync=rename;}
 assert.equal(vault.records().length,1);assert.deepEqual(fs.readFileSync(filename),previous);
 record(vault,'之后正常写入');assert.equal(vault.records().length,2);
});
test('failed password change keeps old credentials',async t=>{
 const {vault,filename}=await fixture(t),rename=fs.renameSync;
 fs.renameSync=(from,to)=>{if(to===filename)throw new Error('simulated disk full');return rename(from,to);};
 try{await assert.rejects(vault.changePassword('Unsaved new password!'));}finally{fs.renameSync=rename;}
 record(vault);const reopened=await Vault.open(filename,PASSWORD);reopened.close();
});
test('daily snapshot preserves pre-edit content without same-day overwrites',async t=>{
 const {vault,dir}=await fixture(t);record(vault);const files=fs.readdirSync(path.join(dir,'backups'));assert.equal(files.length,1);
 const backup=await Vault.open(path.join(dir,'backups',files[0]),PASSWORD);assert.equal(backup.records().length,0);backup.close();record(vault,'第二次修改');assert.equal(fs.readdirSync(path.join(dir,'backups')).length,1);
});
test('creation and backups cannot overwrite an active archive',async t=>{
 const {vault,filename}=await fixture(t);const original=fs.readFileSync(filename);await assert.rejects(Vault.create(filename,PASSWORD));assert.throws(()=>vault.backup(filename));assert.deepEqual(original,fs.readFileSync(filename));
});
test('formatting uses the selected description version',async t=>{
 const {vault}=await fixture(t),id=record(vault),text=formatRecord(vault.record(id),'简短描述');assert.match(text,/简短项目描述/);assert.doesNotMatch(text,/完整记录正文/);
});
test('recent ordering handles legacy timezone offsets and UTC together',async t=>{
 const {vault}=await fixture(t),older=record(vault,'旧版时间'),newer=record(vault,'新版时间');
 vault.db.run('UPDATE records SET updated=? WHERE id=?',['2026-10-18T09:00:00+08:00',older]);
 vault.db.run('UPDATE records SET updated=? WHERE id=?',['2026-10-18T02:00:00Z',newer]);
 assert.equal(vault.records()[0].id,newer);
});
