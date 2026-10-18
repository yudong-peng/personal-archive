'use strict';
// The bootstrap file contains only a directory, never archive contents or keys.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {atomicWrite}=require('./vault.cjs');
const FILE='archive.pav';
function samePath(a,b){
 const normalize=input=>{let result=path.resolve(input);try{result=fs.realpathSync.native(result);}catch{}return process.platform==='win32'?result.toLowerCase():result;};
 return normalize(a)===normalize(b);
}
function digest(filename){
 const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(filename,'r');
 try{let size;while((size=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,size));return hash.digest('hex');}
 finally{fs.closeSync(fd);}
}
function fileExists(filename){try{return fs.statSync(filename).isFile();}catch{return false;}}
function reserveLock(filename){
 const lock=filename+'.lock';
 if(fs.existsSync(lock)){
  const pid=Number(fs.readFileSync(lock,'utf8').split('\n')[0]);let alive=Number.isInteger(pid)&&pid>0;
  if(alive){try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}}
  if(alive){const error=new Error('此资料目录正在被另一个程序使用，请先关闭对应程序。');error.code='ARCHIVE_BUSY';throw error;}
  fs.unlinkSync(lock);
 }
 const fd=fs.openSync(lock,'wx',0o600);
 try{fs.writeFileSync(fd,`${process.pid}\nPersonalArchive\n${os.hostname()}\n\n\n`);}catch(error){try{fs.unlinkSync(lock);}catch{}throw error;}finally{fs.closeSync(fd);}
 return lock;
}
function unlock(filename){if(filename){try{const pid=Number(fs.readFileSync(filename,'utf8').split('\n')[0]);if(pid===process.pid)fs.unlinkSync(filename);}catch{}}}
function copyExclusive(source,target,onCreated){
 const input=fs.openSync(source,'r');let output;
 try{
  output=fs.openSync(target,'wx',0o600);onCreated();
  const buffer=Buffer.alloc(1024*1024);let length;
  while((length=fs.readSync(input,buffer,0,buffer.length,null))){let offset=0;while(offset<length){const written=fs.writeSync(output,buffer,offset,length-offset);if(!written)throw new Error('目标磁盘写入中断。');offset+=written;}}
  fs.fsyncSync(output);
 }finally{fs.closeSync(input);if(output!==undefined)fs.closeSync(output);}
}

class Location {
 constructor(defaultDirectory,{configFile}={}){
  this.defaultDirectory=path.resolve(defaultDirectory);
  this.configFile=configFile||path.join(this.defaultDirectory,'location.json');
  this.directory=this.defaultDirectory;this.expectedArchive=false;this.custom=false;this.lockFile=null;this.error=null;
  if(fs.existsSync(this.configFile)){
   try{
    const c=JSON.parse(fs.readFileSync(this.configFile,'utf8'));
    if(c.version!==1||typeof c.directory!=='string'||!path.isAbsolute(c.directory)||typeof c.hasArchive!=='boolean')throw new Error('配置格式不正确');
    this.directory=path.resolve(c.directory);this.expectedArchive=c.hasArchive;this.custom=true;
   }catch{this.error='保存位置配置无法读取。请重新选择原资料文件夹，程序不会自动创建空档案。';}
  }
 }
 get filename(){return path.join(this.directory,FILE);}
 check(){
  if(this.error)throw new Error(this.error);
  if(this.custom&&!fs.existsSync(this.directory))throw new Error('记住的资料文件夹当前不可用。请连接原磁盘，或重新选择包含 archive.pav 的文件夹。');
  if(this.expectedArchive&&!fileExists(this.filename))throw new Error('当前资料文件夹中未找到 archive.pav。为避免误建空库，请连接原磁盘或重新选择资料位置。');
 }
 initialize(){
  this.check();
  if(!this.custom)fs.mkdirSync(this.directory,{recursive:true});
  this.lockFile=reserveLock(this.filename);
 }
 info(){
  let error=this.error;
  if(!error){try{this.check();if(!this.lockFile)throw new Error('资料目录尚未成功打开。请重新选择一个可用位置。');}catch(e){error=e.message;}}
  return {dataPath:this.filename,directory:this.directory,available:!error,error:error||null,exists:fileExists(this.filename)};
 }
 ensureReady(){const info=this.info();if(!info.available)throw new Error(info.error);}
 writeConfig(directory,hasArchive){
  atomicWrite(this.configFile,Buffer.from(JSON.stringify({version:1,directory:path.resolve(directory),hasArchive},null,2)));
 }
 markCreated(){
  this.expectedArchive=true;
  // If a first-run config write fails, the actual archive remains discoverable
  // at the already selected path; do not turn successful creation into a retry.
  try{this.writeConfig(this.directory,true);}catch{}
 }
 plan(directory){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('请选择有效的绝对文件夹路径。');
  directory=fs.realpathSync.native(directory);
  if(!fs.statSync(directory).isDirectory())throw new Error('请选择文件夹。');
  const destination=path.join(directory,FILE);
  if(samePath(this.directory,directory)&&!this.error&&this.lockFile){this.ensureReady();return {mode:'same',directory,destination};}
  const sourceExists=fileExists(this.filename),targetExists=fileExists(destination);
  if(targetExists)return {mode:'existing',directory,destination,source:this.filename};
  if(fs.existsSync(destination))throw new Error('目标目录的 archive.pav 不是普通文件，不能使用。');
  const mode=sourceExists&&!this.error?'migrate':this.expectedArchive||this.error?'missing':'empty';
  const entries=[];
  if(mode==='migrate'){
   entries.push({source:this.filename,relative:FILE});
   const backups=path.join(this.directory,'backups');
   if(fs.existsSync(backups)){
    if(!fs.lstatSync(backups).isDirectory()||fs.lstatSync(backups).isSymbolicLink())throw new Error('原备份目录不是普通文件夹，未迁移任何资料。');
    for(const item of fs.readdirSync(backups,{withFileTypes:true})){
     if(item.isFile()&&item.name.endsWith('.pav'))entries.push({source:path.join(backups,item.name),relative:path.join('backups',item.name)});
    }
   }
   const backupTarget=path.join(directory,'backups');
   if(fs.existsSync(backupTarget)&&(!fs.lstatSync(backupTarget).isDirectory()||fs.lstatSync(backupTarget).isSymbolicLink()))throw new Error('目标 backups 不是普通文件夹，请选择其他目录。');
   for(const item of entries)if(fs.existsSync(path.join(directory,item.relative)))throw new Error('目标目录已有同名档案或备份，请选择空文件夹，原资料没有改动。');
  }
  return {mode,directory,destination,source:this.filename,entries};
 }
 apply(plan,{unlocked=false,allowMissing=false}={}){
  // Re-evaluate after any native confirmation dialog, rather than trusting
  // the earlier state of a removable disk or a destination folder.
  const current=this.plan(plan.directory);
  if(current.mode!==plan.mode)throw new Error('目录内容在确认期间发生变化，请重新选择。');
  plan=current;
  if(plan.mode==='same')return {changed:false,dataPath:this.filename,migrated:false};
  if(plan.mode==='existing'&&unlocked)throw new Error('目标已有档案，不会覆盖。若要切换到该档案，请先锁定，再从登录页选择该目录。');
  if(plan.mode==='missing'&&!allowMissing)throw new Error('原资料位置不可用，不能迁移。请选择原资料目录，或确认在新位置从备份恢复。');
  let targetLock=null,stage=null,committed=[],createdBackupDirectory=false;
  try{
   targetLock=reserveLock(plan.destination);
   if(plan.mode==='migrate'){
    stage=fs.mkdtempSync(path.join(plan.directory,'.archive-migrate-'));
    for(const item of plan.entries){
     const temporary=path.join(stage,item.relative);fs.mkdirSync(path.dirname(temporary),{recursive:true});
     fs.copyFileSync(item.source,temporary,fs.constants.COPYFILE_EXCL);
     const fd=fs.openSync(temporary,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
     if(digest(item.source)!==digest(temporary))throw new Error('复制校验失败，仍继续使用原资料位置。');
    }
    // COPYFILE_EXCL closes the check/use gap and refuses collisions.
    for(const item of plan.entries){
     const target=path.join(plan.directory,item.relative);
     if(item.relative.startsWith('backups'+path.sep)&&!fs.existsSync(path.dirname(target))){fs.mkdirSync(path.dirname(target));createdBackupDirectory=true;}
     copyExclusive(path.join(stage,item.relative),target,()=>committed.push(target));
     if(digest(path.join(stage,item.relative))!==digest(target))throw new Error('目标文件校验失败，仍继续使用原资料位置。');
    }
   }
   // Commit the pointer only after the encrypted archive and all backups are
   // durable. A failed pointer write removes only files created by this call.
   const hasArchive=plan.mode==='migrate'||plan.mode==='existing';
   this.writeConfig(plan.directory,hasArchive);
   const previousLock=this.lockFile;
   this.directory=plan.directory;this.expectedArchive=hasArchive;this.custom=true;this.error=null;this.lockFile=targetLock;targetLock=null;
   unlock(previousLock);
   return {changed:true,migrated:plan.mode==='migrate',switched:plan.mode==='existing',dataPath:this.filename,backupCount:(plan.entries?.length||1)-1,retainedSource:plan.mode==='migrate'?plan.source:null};
  }catch(error){
   for(const filename of committed.reverse()){try{fs.unlinkSync(filename);}catch{}}
   if(createdBackupDirectory){try{fs.rmdirSync(path.join(plan.directory,'backups'));}catch{}}
   throw error;
  }finally{
   unlock(targetLock);
   if(stage){try{fs.rmSync(stage,{recursive:true,force:true});}catch{}}
  }
 }
 close(){unlock(this.lockFile);this.lockFile=null;}
}
module.exports={Location,samePath,digest};
