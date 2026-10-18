'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {unzipSync,strFromU8}=require('fflate');
const {Vault}=require('../app/vault.cjs');const {Downloads,buildExport}=require('../app/exports.cjs');
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archive-exports-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('download location persists independently, supports temporary override, and never overwrites files',t=>{
 const root=directory(t),config=path.join(root,'settings.json'),a=path.join(root,'默认'),b=path.join(root,'临时');fs.mkdirSync(a);fs.mkdirSync(b);
 const d=new Downloads(config,a);d.set(a);const restart=new Downloads(config,b);assert.equal(restart.directory,a);
 const first=restart.write('原始照片.png',Buffer.from('original')),second=restart.write('原始照片.png',Buffer.from('second'));
 assert.notEqual(first.path,second.path);assert.equal(fs.readFileSync(first.path,'utf8'),'original');
 assert.equal(path.dirname(restart.write('临时.txt',Buffer.from('temp'),b).path),b);assert.equal(new Downloads(config,b).directory,a);
 fs.rmSync(a,{recursive:true});assert.throws(()=>restart.write('test.txt',Buffer.from('fail'),a),/目录暂时不可用/);
});
test('invalid or unavailable configured download paths fail visibly without falling back',t=>{
 const root=directory(t),config=path.join(root,'settings.json');fs.writeFileSync(config,'invalid json');
 const d=new Downloads(config,root);assert.ok(d.info().downloadError);assert.throws(()=>d.write('test',Buffer.from('x')),/配置无法读取/);
 const recovered=path.join(root,'recovered');fs.mkdirSync(recovered);d.set(recovered);assert.equal(d.info().downloadError,null);
 fs.rmdirSync(recovered);assert.throws(()=>d.write('test',Buffer.from('x')),/目录暂时不可用/);
});
test('original attachment bytes and filenames are retained; image-only ZIP excludes PDFs',async t=>{
 const root=directory(t),{vault}=await Vault.create(path.join(root,'archive.pav'),'Export test password!');t.after(()=>vault.close());
 const id=vault.saveRecord({category:'个人照片',title:'原始证件照'}),png=Buffer.from('original image bytes'),pdf=Buffer.from('%PDF-1.4 original proof');
 vault.addAttachment(id,'蓝底证件照.png',png);vault.addAttachment(id,'证明.pdf',pdf);
 for(const kind of ['images','attachments','zip']){
  const result=buildExport(vault,[id],'完整记录',kind),zip=unzipSync(result.data),paths=Object.keys(zip);
  assert.deepEqual(Buffer.from(zip[paths.find(p=>p.endsWith('蓝底证件照.png'))]),png);
  assert.equal(paths.some(p=>p.endsWith('.pdf')),kind!=='images');
  const index=JSON.parse(strFromU8(zip['附件索引.json']));assert.equal(index.length,kind==='images'?1:2);
  assert.equal(paths.includes('结构化资料.json'),kind==='zip');
 }
});
test('formatted exports respect selected fields, descriptions and notes; CSV handles newlines and formulas',async t=>{
 const root=directory(t),{vault}=await Vault.create(path.join(root,'archive.pav'),'Export test password!');t.after(()=>vault.close());
 const id=vault.saveRecord({category:'个人基本信息',fields:{姓名:'=TEST()',邮政编码:'000001',通讯地址:'第一行\n第二行,"引号"'},versions:{简短描述:'短描述',完整记录:'完整描述'},notes:'内部备注'});
 const result=buildExport(vault,[id],'简短描述','csv',{fields:['姓名','通讯地址'],includeNotes:false});
 const csv=result.data.toString();assert.match(csv,/'=TEST\(\)/);assert.match(csv,/第一行\n第二行,""引号""/);assert.match(csv,/短描述/);assert.doesNotMatch(csv,/邮政编码|000001|内部备注|完整描述/);
 const json=JSON.parse(buildExport(vault,[id],'完整记录','json',{fields:['邮政编码'],includeDescriptions:false,includeNotes:false}).data.toString());
 assert.deepEqual(json.records[0].fields,{邮政编码:'000001'});assert.deepEqual(json.records[0].versions,{});assert.equal(json.records[0].notes,'');
 assert.throws(()=>buildExport(vault,[id],'完整记录','images'),/没有图片/);
});
