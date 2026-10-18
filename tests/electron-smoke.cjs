'use strict';
// Run with Electron, not node. Synthetic data only; no real profile is opened.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'archive-electron-qa-'));
process.env.PERSONAL_ARCHIVE_HOME=directory;
// The headless CI container forbids Unix-domain socket creation. Only this QA
// entry point bypasses the native single-instance socket; production keeps it.
app.requestSingleInstanceLock=()=>true;
app.disableHardwareAcceleration();
app.getVersion=()=> '0.2.0';
const pdf=path.join(directory,'项目证明.pdf');fs.writeFileSync(pdf,'%PDF-1.4\n%%EOF');
let openFiles=[pdf],saveName='export.zip';
dialog.showOpenDialog=async()=>({canceled:false,filePaths:openFiles});
dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(directory,saveName)});
dialog.showMessageBox=async()=>({response:1});
require(process.env.ARCHIVE_QA_APP || '../app/main.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let checks=0;
function check(value,message){assert.ok(value,message);checks++;console.log('PASS',message);}
app.whenReady().then(async()=>{
 try{
  const window=BrowserWindow.getAllWindows()[0];
  window.setSize(1480,960);
  if(window.webContents.isLoading())await new Promise(resolve=>window.webContents.once('did-finish-load',resolve));
  const js=source=>window.webContents.executeJavaScript(source);
  const wait=async source=>{for(let i=0;i<100;i++){if(await js(source))return;await delay(50);}throw new Error('Timed out: '+source);};
  await wait('!!window.archive && !!document.getElementById("login-submit") && !document.getElementById("login-error").textContent');
  check(await js('document.getElementById("login-title").textContent.includes("创建")'),'first-run screen via real preload');
  await js(`document.getElementById('login-password').value='Desktop test password!';document.getElementById('login-repeat').value='Desktop test password!';document.getElementById('login-form').requestSubmit();`);
  await wait('!document.getElementById("app-screen").hidden && document.getElementById("recovery-done")');
  check(await js('document.querySelector(".recovery-text").textContent.length>50'),'creation returns recovery key');
  await js(`document.getElementById('recovery-saved').checked=true;document.getElementById('recovery-saved').dispatchEvent(new Event('change'));document.getElementById('recovery-done').click();document.getElementById('add-record').click();`);
  await wait('document.getElementById("editor-dialog").open');
  check(await js('document.getElementById("editor-dialog").open'),'record editor opens');
  await js(`document.getElementById('record-category').value='项目经历';document.getElementById('record-category').dispatchEvent(new Event('change'));document.getElementById('record-title').value='校园二手交易平台（示例）';document.querySelector('[data-field="个人角色"]').value='项目负责人';document.querySelector('[data-field="个人贡献"]').value='负责需求分析、数据库设计与核心功能开发。';document.querySelector('[data-field="起始时间"]').value='2026-03';document.querySelector('[data-field="结束时间"]').value='2026-06';document.querySelector('[data-version="完整记录"]').value='围绕校园二手交易需求，完成需求分析、数据库设计与系统实现。';document.getElementById('record-tags').value='升学、求职';document.getElementById('editor-form').requestSubmit();`);
  await wait('!document.getElementById("editor-dialog").open && document.querySelector(".row-name")');
  check(await js('document.querySelector(".row-name").textContent.includes("校园二手")'),'save and list record');
  check(await js('document.getElementById("detail-panel").textContent.includes("项目负责人")'),'record fields shown');
  const id=await js('window.archive.snapshot().then(s=>s.records[0].id)');
  const imported=await js(`window.archive.importAttachments(${JSON.stringify(id)})`);check(imported.added===1,'native file import through IPC');
  await js(`document.querySelector('[data-detail-tab="attachments"]').click();`);await wait('!!document.querySelector(".attachment-card")');
  check(await js('document.querySelector(".attachment-card").textContent.includes("项目证明.pdf")'),'attachment panel shows imported proof');
  const collection=await js(`window.archive.createCollection('夏令营申请（示例）')`);
  await js(`window.archive.addToCollection(${JSON.stringify(collection)},[${JSON.stringify(id)}])`);
  check(await js(`window.archive.snapshot({collection:${JSON.stringify(collection)}}).then(s=>s.records.length===1)`),'collection references existing records');
  saveName='材料导出.zip';await js(`window.archive.exportRecords([${JSON.stringify(id)}],'完整记录','zip')`);check(fs.statSync(path.join(directory,saveName)).size>100,'ZIP export includes selected records');
  saveName='完整备份.pav';await js('window.archive.backup()');check(fs.existsSync(path.join(directory,saveName)),'full encrypted backup saved');
  await js(`document.getElementById('search').value='不存在的经历';document.getElementById('search').dispatchEvent(new Event('input'));`);
  await wait('document.querySelector(".record-list .empty-state")');check(await js('document.querySelectorAll(".record-row").length===0'),'search empty state');
  await js(`document.getElementById('search').value='';document.getElementById('search').dispatchEvent(new Event('input'));`);await wait('!!document.querySelector(".record-row")');
  await js('document.getElementById("lock-button").click()');await wait('!document.getElementById("login-screen").hidden');
  check(await js('document.querySelectorAll(".record-row").length===0'),'locking clears rendered personal data');
  await js(`document.getElementById('login-password').value='Desktop test password!';document.getElementById('login-form').requestSubmit();`);await wait('!document.getElementById("app-screen").hidden && !!document.querySelector(".record-row")');
  check(await js('document.querySelector(".row-name").textContent.includes("校园二手")'),'unlock reopens encrypted archive');
  await js('document.getElementById("edit-record").click()');await wait('document.getElementById("editor-dialog").open');
  check(await js('document.querySelector("[data-field=个人角色]").value==="项目负责人"'),'editor reloads saved fields');
  await js(`document.querySelector('[data-dialog="editor-dialog"]').click()`);
  await js(`(async()=>{await window.archive.trash([${JSON.stringify(id)}],true);document.getElementById('trash-nav').click();})()`);
  await wait('document.getElementById("page-title").textContent==="回收站" && !!document.querySelector(".record-row")');
  check(await js('document.getElementById("restore-record").hidden===false'),'trash restore action visible');
  await js('document.getElementById("restore-record").click()');await wait('document.querySelectorAll(".record-row").length===0');
  check(await js('window.archive.snapshot().then(s=>s.records.length===1)'),'trash record restored');
  // Populate additional synthetic entries to visually inspect a realistic list.
  await js(`(async()=>{
   for(const r of [
    {category:'就学经历',title:'本科教育经历（示例）',fields:{就学阶段:'本科',学校:'示例大学',专业:'信息管理与信息系统',起始时间:'2023-09',结束时间:'至今'},tags:['升学']},
    {category:'获奖经历',title:'校级学术竞赛一等奖（示例）',fields:{颁发单位:'示例大学',等级:'一等奖',获奖日期:'2026-05'},tags:['评奖']},
    {category:'实践经历',title:'暑期社会实践（示例）',fields:{组织单位:'示例学院',担任角色:'组员'},tags:['社会实践']},
    {category:'证书资质',title:'英语能力证书（示例）',fields:{取得日期:'2025-12'},tags:['求职']},
    {category:'技能与特长',title:'数据分析与编程（示例）',fields:{技能名称:'Python / SQL',熟练程度:'熟悉'},tags:['技能']},
    {category:'个人基本信息',title:'常用个人基本资料（示例）',fields:{姓名:'示例用户',邮箱:'example@example.com'},tags:['常用资料']}
   ])await window.archive.saveRecord(r);
   document.querySelector('[data-category=""]').click();
  })()`);await wait('document.querySelectorAll(".record-row").length===7');
  await js(`document.querySelectorAll('.record-row').forEach(r=>{if(r.textContent.includes('校园二手'))r.click()})`);await delay(200);
  const screenshotDir=process.env.ARCHIVE_QA_SCREENSHOTS;
  if(screenshotDir){fs.mkdirSync(screenshotDir,{recursive:true});fs.writeFileSync(path.join(screenshotDir,'main.png'),(await window.webContents.capturePage()).toPNG());}
  check(await js('typeof window.require==="undefined" && typeof window.process==="undefined"'),'renderer has no Node.js access');
  check(await js('document.querySelectorAll("script[src^=http],link[href^=http]").length===0'),'all page resources are local');
  console.log(`ELECTRON_SMOKE_OK ${checks} checks`);
  app.quit();
 }catch(error){console.error(error.stack);app.exit(2);}
});
app.on('will-quit',()=>{try{fs.rmSync(directory,{recursive:true,force:true});}catch{}});
