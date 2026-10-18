'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
const names=['copyInbox','advanced','reminders','setReminder','aiStart','aiStatus','aiCancel','aiTest','aiApply','aiUndo','quickSelect','quickSave','floatDirty','floatCollapse','floatClose','showMain','openRecord','quit','preferences','selectAttachments','commitAttachments','cancelAttachments','updateAttachment','attachmentContent','status','chooseLocation','chooseDownloadDirectory','chooseExportDirectory','helloUnlock','enableHello','disableHello','create','unlock','lock','snapshot','saveRecord','trash','purge',
 'createCollection','deleteCollection','addToCollection','removeFromCollection',
 'importAttachments','attachmentPreview','deleteAttachment','exportAttachment',
 'copy','exportRecords','backup','restore','initialRestore','changePassword','saveRecovery','settings'];
const api={};
for(const name of names)api[name]=async(...args)=>{
 const result=await ipcRenderer.invoke('archive:'+name,...args);
 if(!result.ok)throw new Error(result.error);
 return result.data;
};
api.stageDroppedFiles=async(recordId,files)=>{
 const paths=files.map(file=>webUtils.getPathForFile(file));
 if(paths.some(value=>!value))throw new Error('请从电脑文件夹拖入实际文件。');
 const result=await ipcRenderer.invoke('archive:stageAttachments',recordId,paths);
 if(!result.ok)throw new Error(result.error);return result.data;
};
api.onChanged=callback=>{const listener=()=>callback();ipcRenderer.on('archive:changed',listener);return()=>ipcRenderer.removeListener('archive:changed',listener);};
api.onOpenRecord=callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('archive:openRecord',listener);return()=>ipcRenderer.removeListener('archive:openRecord',listener);};
api.activity=()=>ipcRenderer.send('archive:activity');
api.onLocked=callback=>{const listener=()=>callback();ipcRenderer.on('archive:locked',listener);return()=>ipcRenderer.removeListener('archive:locked',listener);};
contextBridge.exposeInMainWorld('archive',Object.freeze(api));
