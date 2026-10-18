'use strict';
const {BrowserWindow,dialog,screen}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {atomicWrite}=require('./vault.cjs');
class Floating{
 constructor(root,localSession,getSettings,isUnlocked,positionFile){Object.assign(this,{root,localSession,getSettings,isUnlocked,positionFile});this.window=null;this.dirty=false;this.collapsed=false;this.url=pathToFileURL(path.join(root,'renderer','floating.html')).href;this.position=null;
  try{this.position=JSON.parse(fs.readFileSync(positionFile,'utf8'));}catch{}
 }
 apply(){
  const config=this.getSettings();
  if(!this.isUnlocked()||!config.floatingEnabled){this.hide();return;}
  if(!this.window){
   let x,y;const p=this.position;if(p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&screen.getAllDisplays().some(d=>p.x>=d.workArea.x&&p.x+200<=d.workArea.x+d.workArea.width&&p.y>=d.workArea.y&&p.y+60<=d.workArea.y+d.workArea.height)){x=p.x;y=p.y;}
   const win=this.window=new BrowserWindow({width:360,height:510,minWidth:320,minHeight:58,x,y,frame:false,transparent:true,resizable:true,show:false,skipTaskbar:true,alwaysOnTop:config.floatingTopmost,title:'个人档案库 · 快速收集',webPreferences:{session:this.localSession,preload:path.join(this.root,'app','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,spellcheck:false}});
   win.setMenu(null);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(url!==this.url)e.preventDefault();});
   win.webContents.on('render-process-gone',()=>{this.dirty=false;this.hide();});
   win.on('move',()=>{const [x,y]=win.getPosition();this.position={x,y};try{atomicWrite(this.positionFile,Buffer.from(JSON.stringify(this.position)));}catch{}});
   win.on('closed',()=>{this.window=null;this.dirty=false;});win.once('ready-to-show',()=>{if(this.isUnlocked()&&this.getSettings().floatingEnabled)win.showInactive();});win.loadFile(path.join(this.root,'renderer','floating.html'));
  }
  this.window.setAlwaysOnTop(config.floatingTopmost);this.window.webContents.send('archive:changed');if(!this.window.webContents.isLoading())this.window.showInactive();
 }
 hide(){if(this.window&&!this.window.isDestroyed())this.window.hide();}
 locked(){this.dirty=false;this.hide();if(this.window&&!this.window.isDestroyed())this.window.webContents.send('archive:locked');}
 async confirmDiscard(){if(!this.dirty)return true;const result=await dialog.showMessageBox(this.window,{type:'question',title:'尚未保存',message:'悬浮窗内容尚未保存，放弃这些内容？',detail:'可取消并点击“保存”。自动锁定仍会清空未保存的内容。',buttons:['继续编辑','放弃'],defaultId:0,cancelId:0});return result.response===1;}
 collapse(){if(!this.window)return;this.collapsed=!this.collapsed;this.window.setSize(360,this.collapsed?58:510);return this.collapsed;}
 close(){if(this.window){this.window.destroy();this.window=null;}this.dirty=false;}
}
module.exports={Floating};
