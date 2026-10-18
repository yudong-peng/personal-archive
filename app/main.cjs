'use strict';
const {app,BrowserWindow,ipcMain,dialog,clipboard,nativeImage,session,powerMonitor,nativeTheme,safeStorage,Notification,Tray,Menu}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {Vault,fields,MAX_FILE,atomicWrite,formatRecord}=require('./vault.cjs');
const {Location}=require('./location.cjs');
const FormModel=require('../renderer/form-model.js');
const {Hello}=require('./hello.cjs');
const {Downloads,buildExport}=require('./exports.cjs');
const {Uploads}=require('./uploads.cjs');
const {Preferences}=require('./preferences.cjs');
const {displayName}=require('./attachments.cjs');
const {AdvancedSettings}=require('./advanced-settings.cjs');
const {AiService}=require('./ai.cjs');
const {listReminders,localDay}=require('./reminders.cjs');
const {Floating}=require('./floating.cjs');
let window,vault,pendingRecovery=null,lastActivity=Date.now(),idleMinutes=5,clipboardValue=null,failures=0,retryAt=0;
let queue=Promise.resolve();
let storage,downloads,uploads,preferences,advanced,ai,floating,tray;
let quitting=false;const notified=new Map();
let hello,sessionEpoch=0;
const root=path.join(__dirname,'..');
const rendererFile=path.join(root,'renderer','index.html');
const rendererURL=pathToFileURL(rendererFile).href;
function acquireDataLock(){
 const directory=defaultDirectory();
 storage=new Location(directory,{configFile:process.env.PERSONAL_ARCHIVE_HOME?path.join(directory,'location.json'):path.join(app.getPath('userData'),'storage-location.json')});
 storage.initialize();
}
function releaseDataLock(){if(storage)storage.close();}
function defaultDirectory(){
 if(process.env.PERSONAL_ARCHIVE_HOME)return process.env.PERSONAL_ARCHIVE_HOME;
 let base=process.platform==='win32'?(process.env.LOCALAPPDATA||path.join(app.getPath('home'),'AppData','Local')):
   process.platform==='darwin'?path.join(app.getPath('home'),'Library','Application Support'):(process.env.XDG_DATA_HOME||path.join(app.getPath('home'),'.local','share'));
 return path.join(base,'PersonalArchive');
}
function dataFilename(){return storage?storage.filename:path.join(defaultDirectory(),'archive.pav');}
function locationStatus(){return storage.info();}
function requireVault(){if(!vault)throw new Error('档案已锁定，请先解锁。');storage.ensureReady();return vault;}
function assertSender(event){const main=window&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===rendererURL;const float=floating?.window&&event.sender===floating.window.webContents&&event.senderFrame===floating.window.webContents.mainFrame&&event.senderFrame.url===floating.url;if(!main&&!float)throw new Error('请求来源不受支持。');}
function broadcast(){for(const win of [window,floating?.window])if(win&&!win.isDestroyed())win.webContents.send('archive:changed');}
function showMain(){if(window){if(window.isMinimized())window.restore();window.show();window.focus();}}
function reminderCheck(){if(!vault||!advanced)return;const config=advanced.info();if(!config.remindersEnabled||!config.systemNotifications||!Notification.isSupported())return;const day=localDay(),items=listReminders(vault.records(),config).filter(item=>item.actionable&&notified.get(dataFilename()+item.recordId+item.key)!==day);if(items.length){const notification=new Notification({title:'个人档案库 · 有效期提醒',body:`有 ${items.length} 份证件或证书即将到期或已过期，解锁后查看。`});notification.on('click',showMain);notification.show();for(const item of items)notified.set(dataFilename()+item.recordId+item.key,day);}}
function applyAdvanced(){const config=advanced.info();if(!config.aiEnabled)ai.clear();floating.apply();if(process.platform==='win32')app.setLoginItemSettings({openAtLogin:config.autoStart});if(config.closeToTray&&!tray){try{const icon=nativeImage.createFromPath(path.join(__dirname,'resources','tray.png'));tray=new Tray(icon);tray.setToolTip('个人档案库');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开个人档案库',click:showMain},{label:'锁定档案',click:lock},{type:'separator'},{label:'完全退出',click:()=>{quitting=true;app.quit();}}]));tray.on('double-click',showMain);}catch{tray=null;}}else if(!config.closeToTray&&tray){tray.destroy();tray=null;}broadcast();}

function enqueue(task){const result=queue.then(task);queue=result.catch(()=>{});return result;}
function clearClipboard(){if(clipboardValue!==null&&clipboard.readText()===clipboardValue)clipboard.clear();clipboardValue=null;}
function lock(){
 sessionEpoch++;if(uploads)uploads.clear();if(ai)ai.clear();if(advanced)advanced.lock();if(floating)floating.locked();
 clearClipboard();pendingRecovery=null;if(vault)vault.close();vault=null;
 if(window&&!window.isDestroyed())window.webContents.send('archive:locked');
}
function safeName(text){return path.basename(text).replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/[ .]+$/,'').slice(0,100)||'附件';}
function protectTarget(filename){if(path.resolve(filename).toLowerCase()===path.resolve(dataFilename()).toLowerCase())throw new Error('不能覆盖当前使用的档案库。');}
async function saveDialog(title,defaultPath,filters){return dialog.showSaveDialog(window,{title,defaultPath:path.join(downloads.directory,path.basename(defaultPath)),filters});}
function snapshot(filter={}){
 const v=requireVault();
 v.upgradeForms();v.upgradeAdvanced();
 if(floating&&advanced.info().floatingEnabled&&(!floating.window||!floating.window.isVisible()))floating.apply();reminderCheck();
 return {records:v.records(filter),collections:v.collections(),stats:v.stats(),fields,idleMinutes};
}
async function credentialsCheck(credential,recovery){
 if(Date.now()<retryAt)throw new Error('请稍等 3 秒后重试。');
 try{const result=await Vault.open(dataFilename(),credential,recovery);failures=0;return result;}
 catch(error){if(++failures>=3)retryAt=Date.now()+3000;throw error;}
}
async function exportDirectory(title,current){
 const result=await dialog.showOpenDialog(window,{title,defaultPath:current,properties:['openDirectory','createDirectory']});
 return result.canceled?false:result.filePaths[0];
}
async function writeExport(payload,options,title){
 if(options?.useDefault||options?.directory){return {...downloads.write(payload.name,payload.data,options.directory),attachmentCount:payload.attachmentCount};}
 const result=await saveDialog(title,payload.name,[]);
 if(result.canceled)return false;protectTarget(result.filePath);atomicWrite(result.filePath,payload.data);return {saved:true,path:result.filePath,attachmentCount:payload.attachmentCount};
}
const handlers={
 advanced:input=>{requireVault();if(input){if(input.floatingEnabled===false&&floating.dirty)throw new Error('请先在悬浮窗保存或放弃未保存的内容。');const result=advanced.update(input);applyAdvanced();return result;}return advanced.info();},
 reminders:()=>{const v=requireVault();return {enabled:advanced.info().remindersEnabled,items:listReminders(v.records(),advanced.info())};},
 setReminder:(id,key,input)=>{requireVault().setReminder(id,key,input);return true;},
 aiStart:input=>{requireVault();return ai.start(input);},
 aiStatus:id=>{requireVault();return ai.status(id);},
 aiCancel:id=>{requireVault();return ai.cancel(id);},
 aiTest:vision=>{requireVault();return ai.test(!!vision);},
 aiApply:(id,names)=>{requireVault();return ai.apply(id,names);},
 aiUndo:id=>{requireVault();return ai.undo(id);},
 quickSelect:async recordId=>{requireVault();const result=await dialog.showOpenDialog(floating.window||window,{title:'选择快速收集附件',properties:['openFile','multiSelections'],filters:[{name:'图片与PDF',extensions:['jpg','jpeg','png','webp','bmp','pdf']}]});return result.canceled?false:uploads.stage(recordId||null,result.filePaths);},
 quickSave:input=>{const v=requireVault();if(!input||typeof input.title!=='string'||input.title.length>500)throw new Error('请填写 1～500 字的标题。');if(!input.recordId&&!input.title.trim())throw new Error('请填写标题。');if(input.token){const batch=uploads.pending.get(input.token);if(!batch||batch.recordId&&batch.recordId!==input.recordId||Date.now()-batch.created>10*60000)throw new Error('附件已过期或目标已变更，请重新选择。');}const id=input.recordId||v.saveRecord({category:'收集箱',title:input.title.trim()});if(v.record(id).deleted)throw new Error('资料已删除，请重新选择。');const result=input.token?uploads.commitTo(input.token,id):{added:0,errors:[],ids:[]};floating.dirty=false;return {recordId:id,...result};},
 floatDirty:value=>{requireVault();floating.dirty=!!value;return true;},
 floatCollapse:()=>{requireVault();return floating.collapse();},
 floatClose:async()=>{requireVault();if(!await floating.confirmDiscard())return false;floating.dirty=false;for(const [token,batch]of uploads.pending)if(batch.owner==='floating')uploads.cancel(token);advanced.update({floatingEnabled:false});floating.close();return true;},
 showMain:()=>{showMain();return true;},
 openRecord:(id,recognize=false)=>{requireVault().record(id);showMain();window.webContents.send('archive:openRecord',{id,recognize:!!recognize});return true;},
 quit:async()=>{if(!await floating.confirmDiscard())return false;quitting=true;app.quit();return true;},

 preferences:input=>{const value=input?preferences.update(input):preferences.info();if(input?.theme!==undefined){nativeTheme.themeSource=value.theme;broadcast();}return value;},
 selectAttachments:async recordId=>{
  requireVault().record(recordId);
  const result=await dialog.showOpenDialog(window,{title:'选择附件（可多选）',properties:['openFile','multiSelections'],filters:[{name:'图片与 PDF',extensions:['jpg','jpeg','png','webp','bmp','pdf']}]});
  return result.canceled?false:uploads.stage(recordId,result.filePaths);
 },
 stageAttachments:(recordId,paths)=>uploads.stage(recordId,paths),
 commitAttachments:(token,items)=>uploads.commit(token,items),
 cancelAttachments:token=>uploads.cancel(token),
 updateAttachment:(id,input)=>requireVault().updateAttachment(id,input),
 attachmentContent:id=>{const file=requireVault().attachment(id);try{return {data:file.data.toString('base64'),mime:file.mime,name:displayName(file)};}finally{file.data.fill(0);}},
 chooseDownloadDirectory:async()=>{requireVault();const directory=await exportDirectory('选择默认下载目录',downloads.directory);return directory?downloads.set(directory):false;},
 chooseExportDirectory:async()=>{requireVault();return exportDirectory('选择本次导出位置（不会更改默认下载目录）',downloads.directory);},
 status:()=>({...locationStatus(),preferences:preferences.info(),hello:hello.status(dataFilename()),unlocked:!!vault,version:app.getVersion(),fields}),
 helloUnlock:async()=>{
  if(vault)throw new Error('档案已经解锁。');storage.ensureReady();
  const epoch=sessionEpoch,result=await hello.unlock(dataFilename(),ownerHandle());
  if(epoch!==sessionEpoch){result.close();throw new Error('本次验证已因锁定失效，请重新验证。');}
  vault=result;return snapshot();
 },
 enableHello:async password=>{
  const current=requireVault(),epoch=sessionEpoch;
  await hello.enable(current,password,ownerHandle(),()=>{if(vault!==current||sessionEpoch!==epoch)throw new Error('本次操作已因锁定失效。');});
  return hello.status(dataFilename());
 },
 disableHello:async()=>{requireVault();await hello.disable(dataFilename());return hello.status(dataFilename());},
 chooseLocation:async()=>{
  const result=await dialog.showOpenDialog(window,{title:vault?'选择新的资料保存文件夹':'选择资料保存文件夹（或选择含 archive.pav 的已有目录）',defaultPath:storage.directory,properties:['openDirectory','createDirectory']});
  if(result.canceled)return false;
  const plan=storage.plan(result.filePaths[0]);
  if(plan.mode==='same')return {changed:false,...locationStatus()};
  if(vault&&!['same','migrate'].includes(plan.mode))throw new Error(plan.mode==='existing'?'目标目录已有档案，不会覆盖。若要打开该档案，请先锁定，再从登录页选择。':'原资料文件当前不可读取，未迁移。请先连接原设备后重试。');
  let message,detail,action;
  if(plan.mode==='migrate'){
   message='将档案和自动备份迁移到所选目录？';
   detail=`新位置：${plan.directory}\n将复制完整加密档案及 ${plan.entries.length-1} 个备份，完成后校验并记住新位置。\n原位置保留副本供回退；今后只更新新位置，两个副本不会自动同步。`;
   action='迁移并使用新位置';
  }else if(plan.mode==='existing'){
   message='此目录包含已有档案，是否切换到该档案？';detail=`档案位置：${plan.destination}\n不会覆盖或合并任何资料，切换后需输入该档案的密码或恢复密钥。`;action='使用已有档案';
  }else if(plan.mode==='missing'){
   message='原资料暂时不可用，是否改用这个空文件夹？';detail='此操作不会找回原资料。切换后可从加密备份恢复，或重新创建档案。\n若只是磁盘未连接，建议取消并连接原磁盘。';action='改用空文件夹';
  }else{message='将个人资料保存在这个文件夹？';detail=`保存位置：${plan.directory}\n之后的文字、照片、证明和自动备份将统一保存在这里。`;action='使用此位置';}
  const confirmed=await dialog.showMessageBox(window,{type:'question',title:'资料保存位置',message,detail,buttons:['取消',action],defaultId:0,cancelId:0});
  if(confirmed.response!==1)return false;
  const applied=storage.apply(plan,{unlocked:!!vault,allowMissing:plan.mode==='missing'});
  if(vault)vault.filename=storage.filename;
  failures=0;retryAt=0;
  return {...applied,...locationStatus()};
 },
 create:async(password)=>{
  if(vault)throw new Error('档案已解锁。');
  storage.ensureReady();
  const result=await Vault.create(dataFilename(),password);vault=result.vault;pendingRecovery=result.recovery;
  storage.markCreated();
  return {recovery:result.recovery,...snapshot()};
 },
 unlock:async(credential,recovery=false)=>{if(vault)throw new Error('档案已解锁。');storage.ensureReady();vault=await credentialsCheck(credential,!!recovery);storage.markCreated();return snapshot();},
 lock:()=>{lock();return true;},
 snapshot:filter=>snapshot(filter),
 copyInbox:(source,target)=>requireVault().copyInbox(source,target),
 saveRecord:(record,collection)=>{const v=requireVault(),id=v.saveRecord(record);if(collection)v.addToCollection(collection,[id]);return id;},
 trash:(ids,deleted)=>{requireVault().trash(ids,!!deleted);return true;},
 purge:async(ids)=>{
  const result=await dialog.showMessageBox(window,{type:'warning',buttons:['取消','彻底删除'],defaultId:0,cancelId:0,title:'彻底删除',message:`彻底删除选中的 ${ids.length} 条资料及其附件？`,detail:'无法从回收站撤销，已有备份仍可能保留旧资料。'});
  if(result.response!==1)return false;requireVault().purge(ids);return true;
 },
 createCollection:title=>requireVault().createCollection(title),
 deleteCollection:id=>{requireVault().deleteCollection(id);return true;},
 addToCollection:(id,ids)=>{requireVault().addToCollection(id,ids);return true;},
 removeFromCollection:(id,ids)=>{requireVault().removeFromCollection(id,ids);return true;},
 importAttachments:async recordId=>{
  requireVault().record(recordId);
  const result=await dialog.showOpenDialog(window,{title:'添加照片或证明（单个最多 20 MiB）',properties:['openFile','multiSelections'],filters:[{name:'图片与PDF',extensions:['jpg','jpeg','png','webp','bmp','pdf']}]});
  if(result.canceled)return {added:0,errors:[]};
  const batch=uploads.stage(recordId,result.filePaths);
  if(!batch.token)return {added:0,errors:batch.errors};
  const saved=uploads.commit(batch.token,batch.files.map(file=>({id:file.id})));
  return {...saved,errors:[...batch.errors,...saved.errors]};
 },
 attachmentPreview:id=>{
  const a=requireVault().attachment(id);const image=a.mime.startsWith('image/');
  if(image){const native=nativeImage.createFromBuffer(a.data);if(!native.isEmpty()){const sz=native.getSize(),ratio=Math.min(1,320/sz.width,240/sz.height);return {dataURL:native.resize({width:Math.max(1,Math.round(sz.width*ratio)),height:Math.max(1,Math.round(sz.height*ratio))}).toDataURL(),name:displayName(a)};}}
  return {dataURL:null,name:displayName(a)};
 },
 deleteAttachment:id=>{requireVault().deleteAttachment(id);return true;},
 exportAttachment:async(id,options)=>{
  const attachment=requireVault().attachment(id);
  return writeExport({name:safeName(displayName(attachment)),data:attachment.data},options,'导出普通附件');
 },
 copy:(id,kind,value)=>{
  const r=requireVault().record(id);let text='';
  if(kind==='field')text=FormModel.display(value,r.fields[value]||'');
  else if(kind==='document'){const document=JSON.parse(r.fields['证件资料']||'[]').find(doc=>doc.id===value?.documentId);text=document?.fields[value?.key]||'';}
  else if(kind==='relative'){text=(FormModel.relatives(r.fields['亲属信息'])||[])[value?.index]?.[value?.key]||'';}
  else if(kind==='description')text=r.versions[value]||'';
  else if(kind==='record')text=formatRecord(r,value);
  else throw new Error('复制类型无效。');
  if(text){clipboard.writeText(text);clipboardValue=text;setTimeout(()=>{if(clipboardValue===text)clearClipboard();},60000).unref();}
  return !!text;
 },
 exportRecords:async(ids,version,kind,options={})=>{
  const payload=buildExport(requireVault(),ids,version,kind,options);
  return writeExport(payload,options,'导出普通材料');
 },
 backup:async()=>{
  const v=requireVault(),result=await saveDialog('保存完整加密备份','个人档案备份.pav',[{name:'加密档案',extensions:['pav']}]);
  if(result.canceled)return false;v.backup(result.filePath);return true;
 },
 restore:async(credential,recovery=false)=>{
  const v=requireVault(),result=await dialog.showOpenDialog(window,{title:'选择要恢复的加密备份',properties:['openFile'],filters:[{name:'加密档案',extensions:['pav']}]});
  if(result.canceled)return false;
  const before=await v.restore(result.filePaths[0],credential,!!recovery);ai.clear();uploads.clear();await hello.disable(dataFilename());return {before};
 },
 initialRestore:async(credential,recovery=false)=>{
  storage.ensureReady();
  if(fs.existsSync(dataFilename())||vault)throw new Error('已有资料库，请在解锁后的设置中恢复。');
  const result=await dialog.showOpenDialog(window,{title:'选择已有加密备份',properties:['openFile'],filters:[{name:'加密档案',extensions:['pav']}]});
  if(result.canceled)return false;
  const candidate=await Vault.open(result.filePaths[0],credential,!!recovery);candidate.close();
  atomicWrite(dataFilename(),fs.readFileSync(result.filePaths[0]));vault=await Vault.open(dataFilename(),credential,!!recovery);storage.markCreated();return snapshot();
 },
 changePassword:async password=>{const v=requireVault();await hello.disable(dataFilename());await v.changePassword(password);return true;},
 saveRecovery:async()=>{
  if(!vault||!pendingRecovery)throw new Error('恢复密钥仅在创建时显示，请在首次创建时保存。');
  const result=await saveDialog('恢复密钥为明文，请保存到安全位置','个人档案库-恢复密钥.txt',[{name:'文本',extensions:['txt']}]);
  if(result.canceled)return false;protectTarget(result.filePath);
  atomicWrite(result.filePath,Buffer.from('\ufeff个人档案库恢复密钥（可解锁所有资料，请保密）\n'+pendingRecovery+'\n'));return true;
 },
 settings:input=>{requireVault();if(input&&[1,5,15,30].includes(input.idleMinutes))idleMinutes=input.idleMinutes;return {idleMinutes,preferences:preferences.info(),...locationStatus(),...downloads.info(),hello:hello.status(dataFilename()),version:app.getVersion()};},
};
function ownerHandle(){if(process.platform!=='win32')return 0;const buffer=window.getNativeWindowHandle();return buffer.length===8?buffer.readBigUInt64LE():BigInt(buffer.readUInt32LE());}
// Attachments are read lazily, never included in search/list responses.
const originalSnapshot=handlers.snapshot;
handlers.snapshot=filter=>{
 const result=originalSnapshot(filter);
 if(filter?.selectedId){const v=requireVault();result.attachments=v.attachments(filter.selectedId);}
 return result;
};
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
 app.whenReady().then(()=>{
  app.setAppUserModelId('local.personalarchive.desktop');
  try{acquireDataLock();}catch(error){if(error.code==='ARCHIVE_BUSY'){dialog.showErrorBox('档案库正在使用',error.message);app.quit();return;}storage.error=error.message;}
  hello=new Hello(path.join(path.dirname(storage.configFile),'device-credentials'));
  downloads=new Downloads(path.join(path.dirname(storage.configFile),'download-settings.json'),app.getPath('downloads'));
  advanced=new AdvancedSettings(path.join(path.dirname(storage.configFile),'advanced-settings.json'),safeStorage);
  ai=new AiService(advanced,requireVault,nativeImage);
  preferences=new Preferences(path.join(path.dirname(storage.configFile),'interface-settings.json'));
  nativeTheme.themeSource=preferences.info().theme;
  uploads=new Uploads(requireVault,nativeImage);
  const localSession=session.fromPartition('personal-archive-memory');
  localSession.webRequest.onBeforeRequest((details,callback)=>{
   const protocol=new URL(details.url).protocol;
   const allow=protocol==='file:'||protocol==='data:'||protocol==='devtools:';
   callback({cancel:!allow});
  });
  localSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  localSession.setPermissionCheckHandler(()=>false);
  floating=new Floating(root,localSession,()=>advanced.info(),()=>!!vault,path.join(path.dirname(storage.configFile),'floating-position.json'));
  window=new BrowserWindow({width:1480,height:960,minWidth:1060,minHeight:700,title:'个人档案库',backgroundColor:nativeTheme.shouldUseDarkColors?'#111923':'#f5f7fa',autoHideMenuBar:true,
   webPreferences:{session:localSession,preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,spellcheck:false}});
  window.setMenu(null);
  nativeTheme.on('updated',()=>{if(window&&!window.isDestroyed())window.setBackgroundColor(nativeTheme.shouldUseDarkColors?'#111923':'#f5f7fa');});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==rendererURL)event.preventDefault();});
  window.webContents.on('render-process-gone',()=>lock());
  window.webContents.on('did-fail-load',()=>lock());
  for(const [name,handler]of Object.entries(handlers))ipcMain.handle('archive:'+name,async(event,...args)=>{
   try{assertSender(event);if(name==='lock'){lock();return {ok:true,data:true};}return await enqueue(async()=>{
    const epoch=sessionEpoch;
    try{const data=await handler(...args);if(data?.token&&event.sender===floating?.window?.webContents&&uploads.pending.has(data.token))uploads.pending.get(data.token).owner='floating';if(epoch!==sessionEpoch&&!['status','chooseLocation'].includes(name))throw new Error('操作已因锁定失效，请重新登录。');if(!['status','snapshot','preferences','settings','advanced','reminders','aiStatus','floatDirty'].includes(name))lastActivity=Date.now();if(['copyInbox','saveRecord','trash','purge','commitAttachments','quickSave','updateAttachment','deleteAttachment','aiApply','aiUndo','setReminder','restore'].includes(name))broadcast();return {ok:true,data:data??null};}
    catch(error){return {ok:false,error:error.message||'操作未完成，未提交的资料保持原状。'};}
   });}catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.on('archive:activity',event=>{try{assertSender(event);lastActivity=Date.now();}catch{}});
  powerMonitor.on('lock-screen',()=>lock());
  const watchdog=setInterval(()=>{if(vault&&Date.now()-lastActivity>idleMinutes*60000)lock();},1000);
  watchdog.unref();const remindersTimer=setInterval(()=>{try{reminderCheck();broadcast();}catch{}},60000);remindersTimer.unref();
  applyAdvanced();
  window.on('close',event=>{if(!quitting&&advanced.info().closeToTray&&tray){event.preventDefault();window.hide();return;}if(!quitting&&floating.dirty){event.preventDefault();floating.confirmDiscard().then(ok=>{if(ok){floating.dirty=false;quitting=true;app.quit();}});}});
  window.on('closed',()=>{window=null;lock();if(floating)floating.close();});
  window.loadFile(rendererFile);
 });
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{quitting=true;lock();if(floating)floating.close();if(tray)tray.destroy();releaseDataLock();});
}
