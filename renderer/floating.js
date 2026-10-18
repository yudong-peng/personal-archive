'use strict';
const api=window.archive,$=id=>document.getElementById(id),escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let records=[],mode='new',batch=null,savedId=null,busy=false,unlocked=false,generation=0;
const systemColor=window.matchMedia('(prefers-color-scheme: dark)');
function message(text,error=false){$('float-message').textContent=text;$('float-message').classList.toggle('error',error);}
function dirty(){api.floatDirty(!!(batch||$('float-title').value.trim())).catch(()=>{});}
function target(){return mode==='existing'?$('float-target').value||null:null;}
function drawFiles(){$('float-files').innerHTML=batch?.files.map(file=>`<div class="float-file">▱ ${escapeHtml(file.name)}</div>`).join('')||'';$('float-clear').hidden=!batch;dirty();}
function drawTargets(){const selected=$('float-target').value,query=$('float-search').value.toLocaleLowerCase();$('float-target').innerHTML=records.filter(r=>(r.title+' '+r.category).toLocaleLowerCase().includes(query)).map(r=>`<option value="${escapeHtml(r.id)}">${escapeHtml(r.title)} · ${escapeHtml(r.category)}</option>`).join('');if([...$('float-target').options].some(o=>o.value===selected))$('float-target').value=selected;}
function buttonText(){$('float-save').textContent=$('float-ai').checked?'保存并识别…':mode==='new'?'保存到收集箱':'保存附件';}
async function refresh(){
 const expected=generation,status=await api.status();if(expected!==generation)return;unlocked=status.unlocked;if(!unlocked)return;
 const [data,config]=await Promise.all([api.snapshot(),api.advanced()]);if(expected!==generation||!unlocked)return;
 records=data.records;drawTargets();document.documentElement.dataset.theme=status.preferences.theme==='system'?(systemColor.matches?'dark':'light'):status.preferences.theme;document.documentElement.style.setProperty('--float-alpha',String(config.floatingOpacity/100));
 $('float-ai').disabled=!config.aiEnabled;if(!config.aiEnabled)$('float-ai').checked=false;buttonText();
}
async function acceptBatch(result){if(!result)return;if(!result.token){message(result.errors.join('\n')||'没有可用附件。',true);return;}batch={...result,recordId:target()};drawFiles();message('附件待保存。'+(result.errors.length?'\n'+result.errors.join('\n'):''),!!result.errors.length);}
async function selectFiles(){if(busy)return;if(batch){message('请先保存或清空当前附件。',true);return;}if(mode==='existing'&&!target()){message('请先选择已有资料。',true);return;}try{await acceptBatch(await api.quickSelect(target()));}catch(error){message(error.message,true);}}
async function clearBatch(){if(batch)await api.cancelAttachments(batch.token);batch=null;drawFiles();message('待保存附件已清空。');}
for(const [id,next]of [['float-new','new'],['float-existing','existing']])$(id).onclick=()=>{if(batch){message('请先保存或清空附件，再切换目标。',true);return;}mode=next;$('float-new-fields').hidden=mode!=='new';$('float-target-fields').hidden=mode!=='existing';$('float-new').classList.toggle('active',mode==='new');$('float-existing').classList.toggle('active',mode==='existing');buttonText();};
$('float-target').onchange=()=>{if(batch){$('float-target').value=batch.recordId;message('已有待保存附件，请先保存或清空。',true);}};
$('float-search').oninput=()=>{if(batch){message('保存或清空附件后可重新搜索。',true);return;}drawTargets();};
$('float-title').oninput=dirty;$('float-ai').onchange=buttonText;$('float-select').onclick=selectFiles;$('float-clear').onclick=()=>clearBatch().catch(error=>message(error.message,true));
$('float-save').onclick=async()=>{
 if(busy)return;busy=true;$('float-save').disabled=true;
 try{if(mode==='existing'&&!target())throw new Error('请选择已有资料。');if(mode==='existing'&&!batch)throw new Error('请先拖入或选择附件。');const recognize=$('float-ai').checked,result=await api.quickSave({title:$('float-title').value,recordId:target(),token:batch?.token||null});savedId=result.recordId;batch=null;$('float-title').value='';drawFiles();message(`已保存${result.added?' '+result.added+' 个附件':''}。`+(result.errors.length?'\n'+result.errors.join('\n'):''),!!result.errors.length);await refresh();if(recognize)await ArchiveAI.open(savedId,result.ids.length?result.ids:undefined);}
 catch(error){message(error.message,true);}finally{busy=false;$('float-save').disabled=false;}
};
$('float-download').onclick=async()=>{
 try{
  if(batch||mode==='new'&&$('float-title').value.trim())throw new Error('请先保存当前内容，再下载记录。');const id=target()||savedId;if(!id)throw new Error('请先保存新记录，或选择一条已有资料。');
  const settings=await api.settings();let directory=null;const dialog=$('float-download-dialog');dialog.innerHTML=`<div class="advanced-content"><div class="advanced-head"><h2>下载记录</h2><button id="fd-close" class="icon-button">×</button></div><p class="advanced-note">普通导出文件不受档案密码保护。</p><label>格式<select id="fd-kind"><option value="zip">资料与原始附件 ZIP</option><option value="txt">文字 TXT</option><option value="json">结构化 JSON</option></select></label><p id="fd-path" class="path-box">${escapeHtml(settings.downloadDirectory)}</p><button id="fd-choose" class="text-button">选择其他目录…</button><button id="fd-default" class="text-button">使用默认目录</button><p id="fd-message" class="advanced-message"></p><button id="fd-save" class="btn primary">下载</button></div>`;
  $('fd-close').onclick=()=>dialog.close();$('fd-choose').onclick=async()=>{const selected=await api.chooseExportDirectory();if(selected){directory=selected;$('fd-path').textContent=directory;}};$('fd-default').onclick=()=>{directory=null;$('fd-path').textContent=settings.downloadDirectory;};
  $('fd-save').onclick=async()=>{const button=$('fd-save');button.disabled=true;try{const result=await api.exportRecords([id],'完整记录',$('fd-kind').value,{useDefault:true,directory:directory||undefined});$('fd-message').textContent='已保存：'+result.path;}catch(error){$('fd-message').textContent=error.message;}finally{button.disabled=false;}};dialog.showModal();
 }catch(error){message(error.message,true);}
};
$('float-main').onclick=()=>api.showMain();$('float-collapse').onclick=async()=>{try{const collapsed=await api.floatCollapse();$('float-body').hidden=collapsed;}catch(error){message(error.message,true);}};$('float-close').onclick=()=>api.floatClose().catch(error=>message(error.message,true));
for(const type of ['pointerdown','keydown','wheel'])document.addEventListener(type,()=>{if(unlocked)api.activity();},{passive:true});
document.addEventListener('keydown',event=>{if(event.ctrlKey&&event.key==='Enter'){$('float-save').click();event.preventDefault();}});
document.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';$('float-select').classList.add('dragover');});document.addEventListener('dragleave',()=>$('float-select').classList.remove('dragover'));
document.addEventListener('drop',async event=>{event.preventDefault();$('float-select').classList.remove('dragover');if(busy||batch){message('请先保存或清空当前附件。',true);return;}if(mode==='existing'&&!target()){message('请先选择已有资料。',true);return;}try{const recordId=target(),result=await api.stageDroppedFiles(recordId,Array.from(event.dataTransfer.files));await acceptBatch(result);if(batch)batch.recordId=recordId;}catch(error){message(error.message,true);}});
api.onChanged(()=>{refresh().catch(()=>{});});api.onLocked(()=>{generation++;unlocked=false;batch=null;records=[];savedId=null;$('float-title').value='';$('float-target').replaceChildren();$('float-files').replaceChildren();$('float-search').value='';$('float-ai').checked=false;for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();$('float-download-dialog').replaceChildren();ArchiveAI.clear();message('档案已锁定，请在主程序解锁。');});systemColor.addEventListener('change',()=>refresh().catch(()=>{}));
refresh().catch(error=>message(error.message,true));
