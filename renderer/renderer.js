'use strict';
const api=window.archive;
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons=['◉','♙','⌂','◇','▣','♧','▤','⌘','✧','⌁','▱','♧','▧','▤'];
let state={status:null,fields:null,records:[],collections:[],stats:{},category:null,collection:null,trash:false,selected:new Set(),activeId:null,version:'完整记录',attachments:[],detailTab:'info',sensitive:false};
let editor={id:null,values:{},versions:{},activeVersion:'完整记录'};
let toastTimer,searchTimer,loadVersion=0;
function toast(text,error=false){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').classList.toggle('error-toast',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?7000:4000);}
async function attempt(callback){try{return await callback();}catch(error){toast(error.message,true);return null;}}
function closeDialogs(){for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();}
function utility(title,body,actions=''){
 $('utility-dialog').oncancel=null;
 $('utility-content').innerHTML=`<div class="modal-header"><div><span class="eyebrow">PERSONAL ARCHIVE</span><h2>${escapeHtml(title)}</h2></div><button class="icon-button" id="utility-close" aria-label="关闭">×</button></div><div class="utility-body">${body}${actions?`<div class="utility-actions">${actions}</div>`:''}</div>`;
 $('utility-close').onclick=()=>$('utility-dialog').close();
 if(!$('utility-dialog').open)$('utility-dialog').showModal();
}
function confirmModal(title,text,actionLabel='确认'){
 return new Promise(resolve=>{
  utility(title,`<p>${escapeHtml(text).replace(/\n/g,'<br>')}</p>`,`<button class="btn" id="confirm-cancel">取消</button><button class="btn primary" id="confirm-ok">${escapeHtml(actionLabel)}</button>`);
  let resolved=false;const finish=value=>{if(resolved)return;resolved=true;$('utility-dialog').close();resolve(value);};
  $('confirm-cancel').onclick=()=>finish(false);$('confirm-ok').onclick=()=>finish(true);
  $('utility-dialog').addEventListener('close',()=>{if(!resolved){resolved=true;resolve(false);}},{once:true});
 });
}
async function init(){
 if(!api){$('login-error').textContent='请通过 PersonalArchive.exe 启动应用；直接打开 HTML 无法读取档案。';$('login-submit').disabled=true;return;}
 state.status=await api.status();state.fields=state.status.fields;
 $('login-version').textContent='v'+state.status.version;
 renderLogin();
 $('version-select').innerHTML=state.fields.versions.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
 $('record-category').innerHTML=Object.keys(state.fields.categories).map(c=>`<option>${escapeHtml(c)}</option>`).join('');
 bindEvents();
 initExperience(state.status.preferences);
 bindPreview();
 bindAttachmentDrops();
 bindProfileEvents();bindAdvanced();
 api.onLocked(()=>{
  loadVersion++;closeDialogs();
  editor={id:null,values:{},versions:{},activeVersion:'完整记录'};
  $('document-fields').replaceChildren();$('profile-page').replaceChildren();clearPreview();$('drop-overlay').hidden=true;
  $('standard-fields').replaceChildren();$('editor-context').replaceChildren();$('family-fields').replaceChildren();$('date-content').replaceChildren();dateTarget=null;$('custom-fields').replaceChildren();$('description-editors').replaceChildren();
  $('record-title').value='';$('record-tags').value='';$('record-notes').value='';$('search').value='';
  $('utility-content').replaceChildren();$('full-image').removeAttribute('src');
  state.records=[];state.collections=[];state.attachments=[];state.activeId=null;state.selected.clear();
  $('record-list').replaceChildren();$('detail-panel').replaceChildren();$('collection-nav').replaceChildren();
  $('app-screen').hidden=true;$('login-screen').hidden=false;state.status.exists=true;renderLogin();
  attempt(async()=>{state.status=await api.status();renderLogin();});
 });
 let lastPing=0;
 for(const type of ['pointerdown','keydown','wheel'])document.addEventListener(type,()=>{if(Date.now()-lastPing>3000){lastPing=Date.now();api.activity();}},{passive:true});
}
function renderLogin(){
 const fresh=!state.status.exists;
 $('login-title').textContent=fresh?'创建你的个人档案':'欢迎回来';
 $('login-subtitle').textContent=fresh?'设置一个密码，开始积累自己的经历与材料。':'解锁你的个人资料与成长记录。';
 $('login-submit').innerHTML=(fresh?'创建个人档案':'解锁档案库')+' <span>→</span>';
 $('repeat-wrap').hidden=!fresh;$('initial-restore').hidden=!fresh;
 $('use-recovery').closest('label').hidden=fresh;
 $('use-recovery').checked=false;$('show-password').checked=false;
 $('login-password').type='password';$('login-repeat').type='password';$('login-password').value='';$('login-repeat').value='';
 $('password-label').textContent=fresh?'设置密码（至少 12 个字符）':'登录密码';
 $('login-error').textContent='';$('login-password').focus();
 $('login-location-path').textContent=state.status.dataPath||'';
 const unavailable=state.status.available===false;
 $('login-submit').disabled=unavailable;
 $('initial-restore').disabled=unavailable;
 if(unavailable){$('login-title').textContent='资料位置暂时不可用';$('login-error').textContent=state.status.error||'请重新选择资料文件夹。';}
 $('hello-login').hidden=fresh||!state.status.hello?.enabled;
 $('hello-login').disabled=unavailable;
}
async function enterApp(data){
 state.status.exists=true;state.records=data.records||[];state.collections=data.collections||[];state.stats=data.stats||{};
 state.category=null;state.collection=null;state.trash=false;state.activeId=null;state.selected.clear();state.detailTab='info';state.sensitive=false;
 $('login-password').value='';$('login-repeat').value='';$('login-screen').hidden=true;$('app-screen').hidden=false;
 await refresh();
}
async function login(event){
 event.preventDefault();const submit=$('login-submit');if(submit.disabled)return;
 $('login-error').textContent='';const password=$('login-password').value;
 try{
  if(!state.status.exists&&password!==$('login-repeat').value)throw new Error('两次输入的密码不一致。');
  submit.disabled=true;submit.textContent=state.status.exists?'正在解锁…':'正在创建…';
  const fresh=!state.status.exists;
  const result=fresh?await api.create(password):await api.unlock(password,$('use-recovery').checked);
  await enterApp(result);
  if(fresh)showRecovery(result.recovery);
 }catch(error){$('login-error').textContent=error.message;}
 finally{submit.disabled=false;submit.innerHTML=(state.status.exists?'解锁档案库':'创建个人档案')+' <span>→</span>';}
}
function showRecovery(key){
 utility('请妥善保存恢复密钥',`<p>恢复密钥能够独立解锁档案。请保存在另一处安全位置；密码和恢复密钥同时丢失后，资料无法找回。</p><div class="recovery-text">${escapeHtml(key)}</div><button class="btn full" id="save-recovery">另存密钥文本到安全位置…</button><label class="check-label"><input id="recovery-saved" type="checkbox">我已妥善保存恢复密钥</label>`,`<button class="btn primary" id="recovery-done" disabled>开始使用</button>`);
 $('utility-close').hidden=true;$('utility-dialog').oncancel=e=>e.preventDefault();
 $('recovery-saved').onchange=()=>$('recovery-done').disabled=!$('recovery-saved').checked;
 $('save-recovery').onclick=()=>attempt(async()=>{if(await api.saveRecovery()){$('recovery-saved').checked=true;$('recovery-done').disabled=false;toast('恢复密钥已保存，请妥善保管。');}});
 $('recovery-done').onclick=()=>{$('utility-dialog').oncancel=null;$('utility-dialog').close();};
}
function currentRecord(){return state.records.find(r=>r.id===state.activeId)||null;}
function selectedIds(){return [...state.selected].filter(id=>state.records.some(r=>r.id===id));}
async function refresh(chooseId=null){
 const request=++loadVersion;
 const data=await api.snapshot({category:state.category,collection:state.collection,deleted:state.trash,query:$('search').value});
 if(request!==loadVersion)return;
 state.records=$('missing-filter').checked?data.records.filter(r=>!r.attachment_count):data.records;
 state.stats=data.stats;state.collections=data.collections;
 state.selected=new Set([...state.selected].filter(id=>state.records.some(r=>r.id===id)));
 if(chooseId&&state.records.some(r=>r.id===chooseId))state.activeId=chooseId;
 if(!state.records.some(r=>r.id===state.activeId))state.activeId=state.records[0]?.id||null;
 if(!state.selected.size&&state.activeId)state.selected.add(state.activeId);
 renderNav();renderStats();renderList();renderHeading();await updateReminderBadge();
 applyPageLayout();if(isProfilePage())await renderProfile();else await renderDetail();
}
function renderNav(){
 const categories=Object.keys(state.fields.categories);
 $('category-nav').innerHTML=[null,...categories].map((category,i)=>{
  const active=!state.trash&&!state.collection&&state.category===category;
  return `<button class="nav-item ${active?'active':''}" data-category="${escapeHtml(category||'')}"><span class="nav-icon">${icons[i]||'▣'}</span>${escapeHtml(category||'全部资料')}${category===null?`<span class="nav-count">${state.stats.records||0}</span>`:''}</button>`;
 }).join('');
 $('collection-nav').innerHTML=state.collections.length?state.collections.map(c=>`<button class="nav-item ${state.collection===c.id?'active':''}" data-collection="${escapeHtml(c.id)}"><span class="nav-icon">☷</span><span>${escapeHtml(c.title)}</span></button>`).join(''):'<div class="empty-collection">为升学或求职准备一份清单</div>';
 $('trash-nav').classList.toggle('active',state.trash);
}
function renderStats(){for(const [id,key]of [['stat-records','records'],['stat-photos','photos'],['stat-attachments','attachments'],['stat-collections','collections']])$(id).textContent=state.stats[key]||0;}
function renderHeading(){
 const title=state.trash?'回收站':state.collection?(state.collections.find(c=>c.id===state.collection)?.title||'材料清单'):(state.category||'全部资料');
 $('page-title').textContent=title;$('breadcrumb').textContent=title;
 $('page-subtitle').textContent=state.trash?'误删的资料可以在这里恢复，彻底删除后无法撤回。':state.collection?'从已有档案中选择材料，让每一次申请准备有序。':'把每一段经历，整理成随时可用的资料。';
 $('add-record').hidden=state.trash;
 if($('inbox-organize'))$('inbox-organize').hidden=state.trash||currentRecord()?.category!=='收集箱';
 $('add-record').textContent=isProfilePage()?(currentRecord()?'编辑'+state.category:state.category==='家庭信息'?'建立家庭信息':'完善个人信息'):'＋ 新增资料';
 $('edit-record').hidden=state.trash;$('add-to-collection').hidden=state.trash;$('export-records').hidden=state.trash;
 $('remove-from-collection').hidden=!state.collection;$('restore-record').hidden=!state.trash;
 $('delete-record').textContent=state.trash?'彻底删除':'移入回收站';
 const count=selectedIds().length;
 $('result-count').textContent=state.records.length+' 条资料';$('selection-count').textContent=count?'已选择 '+count+' 条':'';
 for(const id of ['edit-record','add-to-collection','remove-from-collection','restore-record','delete-record','export-records'])$(id).disabled=!count;
 $('select-all').checked=!!state.records.length&&count===state.records.length;
 $('select-all').indeterminate=count>0&&count<state.records.length;
}
function renderList(){
 $('record-list').innerHTML=state.records.length?state.records.map(r=>`<div class="record-row ${r.id===state.activeId?'active':''}" data-id="${escapeHtml(r.id)}"><input class="row-check" type="checkbox" ${state.selected.has(r.id)?'checked':''} aria-label="选择资料"><div class="row-main"><span class="row-name" title="${escapeHtml(r.title)}">${r.pinned?'☆ ':''}${escapeHtml(r.title)}</span><div class="row-tags">${r.tags.slice(0,3).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}${r.attachment_count?`<span class="row-attachment">▱ ${r.attachment_count} 份附件</span>`:''}</div></div><span class="category-badge">${escapeHtml(r.category)}</span><span class="row-date">${escapeHtml(r.updated.slice(0,10))}</span></div>`).join(''):`<div class="empty-state"><div class="empty-symbol">▱</div><strong>${state.trash?'回收站是空的':$('search').value?'没有找到匹配的资料':'从一段经历开始记录'}</strong><span>${state.trash?'被删除的资料会先保存在这里。':'添加经历、证书或照片，让你的资料慢慢完整。'}</span></div>`;
}
function isSensitive(name){return state.fields.sensitiveFields.includes(name)||/证件|身份证|学号/.test(name);}
async function renderDetail(){
 if(isProfilePage())return renderProfile();
 const record=currentRecord(),id=record?.id;
 if(!record){$('detail-panel').innerHTML='<div class="empty-state"><div class="empty-symbol">☷</div><strong>你的经历，值得好好记录</strong><span>选择一条资料查看详情，<br>或新建属于自己的第一份档案。</span></div>';return;}
 const html=`<div class="detail-heading"><div class="detail-eyebrow"><span class="dot"></span>${escapeHtml(record.category)}<span> / </span>资料详情</div><h2>${escapeHtml(record.title)}</h2></div><div class="detail-tabs"><button class="detail-tab ${state.detailTab==='info'?'active':''}" data-detail-tab="info">基本资料</button><button class="detail-tab ${state.detailTab==='attachments'?'active':''}" data-detail-tab="attachments">证明与照片 <small>${record.attachment_count||0}</small></button></div><div id="detail-scroll" class="detail-scroll"></div><div class="detail-footer">${state.trash?'<span class="muted">恢复资料后即可继续编辑和调用。</span>':'<button class="btn" id="copy-description">复制当前描述</button><button class="btn" id="copy-full">复制整条资料</button>'}</div>`;
 $('detail-panel').innerHTML=html;
 if(state.detailTab==='info')renderInfo(record);
 else{
  $('detail-scroll').innerHTML='<div class="empty-state"><span>正在读取附件…</span></div>';
  const data=await api.snapshot({selectedId:id});
  if(state.activeId!==id||state.detailTab!=='attachments')return;
  state.attachments=data.attachments||[];await renderAttachments(record);
 }
}
function renderInfo(record){
 const entries=Object.entries(record.fields).filter(([,v])=>v);
 const description=record.versions[state.version]||'';
 $('detail-scroll').innerHTML=`${entries.some(([k])=>isSensitive(k))?`<label class="sensitive-toggle"><input id="show-sensitive" type="checkbox" ${state.sensitive?'checked':''}>显示证件号码等敏感字段</label>`:''}${entries.map(([key,value])=>`<div class="field-row"><div class="field-key"><span>${escapeHtml(key)}</span>${!state.trash?`<button class="copy-mini" data-copy-field="${escapeHtml(key)}" title="复制字段">复制</button>`:''}</div><div class="field-value">${escapeHtml(!state.sensitive&&isSensitive(key)?'••••••••':FormModel.display(key,value))}</div></div>`).join('')}<div class="description-block"><h3>${escapeHtml(state.version)}</h3><p>${escapeHtml(description||'暂无此版本描述。点击编辑，可以为填表或简历补充不同字数的文字。')}</p></div>${record.notes?`<div class="description-block"><h3>备注</h3><p>${escapeHtml(record.notes)}</p></div>`:''}<div class="record-dates">创建 ${escapeHtml(record.created.slice(0,16).replace('T',' '))}<br>最近修改 ${escapeHtml(record.updated.slice(0,16).replace('T',' '))}</div>`;
}
async function renderAttachments(record){
 $('detail-scroll').innerHTML=attachmentGrid(state.attachments,record)+(!state.trash?'<button id="import-attachments" class="add-attachment">＋ 添加照片或证明（也可拖入）</button>':'');
 await loadAttachmentThumbnails(state.attachments,record.id);
}

function navigate(category=null,collection=null,trash=false){state.category=category;state.collection=collection;state.trash=trash;state.activeId=null;state.selected.clear();state.detailTab='info';state.sensitive=false;$('search').value='';attempt(()=>refresh());}
function showEditorTab(name){
 for(const item of ['fields','versions','meta'])$('editor-'+item).hidden=item!==name;
 for(const button of document.querySelectorAll('[data-editor-tab]'))button.classList.toggle('active',button.dataset.editorTab===name);
}
function drawDescriptions(){
 $('description-tabs').innerHTML=state.fields.versions.map(v=>`<button type="button" class="${v===editor.activeVersion?'active':''}" data-description-tab="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('');
 $('description-editors').innerHTML=state.fields.versions.map(v=>`<div class="description-editor" data-description-editor="${escapeHtml(v)}" ${v===editor.activeVersion?'':'hidden'}><textarea data-version="${escapeHtml(v)}" placeholder="记录过程、贡献与成果，或保存适合不同表格字数要求的文字。">${escapeHtml(editor.versions[v]||'')}</textarea><div class="character-count">字符数（含空白）：<span>${[...(editor.versions[v]||'')].length}</span></div></div>`).join('');
}
async function saveRecord(event){
 event.preventDefault();const submit=$('save-record');if(submit.disabled)return;
 try{
  const values=readEditorFields(),versions={};
  if($('record-category').value==='就学经历'&&!values['就学阶段'])throw new Error('请先选择就学阶段。');for(const input of $('description-editors').querySelectorAll('textarea'))versions[input.dataset.version]=input.value;
  submit.disabled=true;submit.textContent='正在保存…';
  const record={id:editor.id||undefined,title:$('record-title').value,category:$('record-category').value,fields:values,versions,tags:$('record-tags').value.split(/[,，、;；\n]/),notes:$('record-notes').value,pinned:$('record-pinned').checked};
  const id=await api.saveRecord(record,state.collection);$('editor-dialog').close();
  if(state.category&&state.category!==record.category)state.category=record.category;
  state.selected=new Set([id]);state.detailTab='info';await refresh(id);toast('资料已加密保存。');
 }catch(error){$('editor-message').textContent=error.message;$('editor-message').classList.add('error-inline');}
 finally{submit.disabled=false;submit.textContent='保存资料';}
}
async function copyValue(kind,value){
 const record=currentRecord();if(!record)return;
 if(kind==='record'&&!state.sensitive&&Object.entries(record.fields).some(([k,v])=>v&&isSensitive(k)))
  if(!await confirmModal('复制完整资料','复制内容将包含界面隐藏的证件号码等字段。是否继续？','继续复制'))return;
 toast(await api.copy(record.id,kind,value)?'已复制，60 秒后清理本应用复制的内容。':'这个字段或描述版本暂时没有内容。');
}
async function newCollection(){
 utility('新建材料清单','<p>为一次申请或一个用途整理相关资料，同一条经历可用于多个清单。</p><label class="form-label">清单名称<input id="collection-title" placeholder="例如：2027 年夏令营申请"></label>','<button class="btn primary" id="create-collection">创建清单</button>');
 $('collection-title').focus();
 $('create-collection').onclick=()=>attempt(async()=>{const id=await api.createCollection($('collection-title').value);$('utility-dialog').close();state.category=null;state.collection=id;state.trash=false;state.selected.clear();await refresh();toast('材料清单已创建。');});
}
async function addToCollection(){
 const ids=selectedIds();if(!ids.length)return;
 if(!state.collections.length){toast('请先在左侧创建一个材料清单。');return;}
 utility('加入材料清单',`<p>将所选 ${ids.length} 条资料加入清单。清单会引用原始记录，后续修改会保持一致。</p><select id="target-collection">${state.collections.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join('')}</select>`,'<button class="btn primary" id="add-collection-confirm">加入清单</button>');
 $('add-collection-confirm').onclick=()=>attempt(async()=>{await api.addToCollection($('target-collection').value,ids);$('utility-dialog').close();await refresh();toast('已加入材料清单。');});
}
async function deleteRecords(){
 const ids=selectedIds();if(!ids.length)return;
 if(state.trash){if(await api.purge(ids)){state.selected.clear();await refresh();toast('已彻底删除。');}}
 else if(await confirmModal('移入回收站',`将所选 ${ids.length} 条资料移入回收站？资料和附件可以在回收站一起恢复。`,'移入回收站')){await api.trash(ids,true);state.selected.clear();await refresh();toast('已移入回收站。');}
}
function credentialDialog(title,description,callback){
 utility(title,`<p>${escapeHtml(description).replace(/\n/g,'<br>')}</p><label class="form-label">备份密码或恢复密钥<input id="backup-credential" type="password" autocomplete="off"></label><label class="check-label"><input id="backup-recovery" type="checkbox">使用恢复密钥</label><p id="credential-error" class="error"></p>`,'<button class="btn primary" id="credential-confirm">选择备份并恢复</button>');
 $('backup-credential').focus();
 $('credential-confirm').onclick=async()=>{
  const btn=$('credential-confirm');btn.disabled=true;
  try{const result=await callback($('backup-credential').value,$('backup-recovery').checked);if(result){$('backup-credential').value='';$('utility-dialog').close();}}
  catch(error){$('credential-error').textContent=error.message;}
  finally{btn.disabled=false;}
 };
}
async function showSettings(){
 const settings=await api.settings();
 utility('设置与备份',`<p>本地档案 · 网页界面桌面版 v${escapeHtml(settings.version)}</p><label>当前档案位置</label><div class="path-box">${escapeHtml(settings.dataPath)}</div><label class="form-label">闲置自动锁定（本次会话）<select id="idle-minutes">${[1,5,15,30].map(n=>`<option value="${n}" ${settings.idleMinutes===n?'selected':''}>${n} 分钟</option>`).join('')}</select></label><button class="btn full" id="change-password">修改登录密码 <span>→</span></button><button class="btn full" id="create-backup">创建完整加密备份 <span>↗</span></button><button class="btn full" id="restore-backup">从加密备份恢复 <span>↗</span></button>${state.collection?'<button class="btn full danger-text" id="delete-current-collection">删除当前材料清单</button>':''}<p class="note">每天首次修改前自动保留快照，保留最近 7 个备份日。<br>旧备份仍使用当时的密码；建议定期另存到独立存储设备。<br>自动锁定会丢弃未保存的编辑，请及时点击保存。</p>`);
 const locationButton=document.createElement('button');locationButton.className='btn full';locationButton.id='choose-data-location';locationButton.textContent='更换资料保存位置…';
 $('idle-minutes').closest('label').before(locationButton);
 locationButton.onclick=()=>attempt(async()=>{const result=await api.chooseLocation();if(result){await refresh();await showSettings();toast(result.migrated?'资料和备份已迁移，新位置已记住；原位置保留副本。':result.changed?'资料保存位置已更新。':'当前已经使用此目录。');}});
 const helloButton=document.createElement('button');helloButton.className='btn full';helloButton.id='hello-settings';helloButton.textContent=settings.hello?.enabled?'关闭 Windows Hello 快捷登录…':'启用 Windows Hello（指纹 / 人脸 / PIN）…';
 helloButton.disabled=!settings.hello?.supported;$('change-password').before(helloButton);
 helloButton.onclick=()=>attempt(async()=>{
  if(settings.hello.enabled){if(await confirmModal('关闭 Windows Hello','关闭后仍可使用主密码或恢复密钥登录。','关闭快捷登录')){await api.disableHello();await showSettings();toast('Windows Hello 已关闭。');}return;}
  utility('启用 Windows Hello','<p>先验证当前档案的主密码，再按 Windows 系统窗口完成验证。支持本机已配置的指纹、面部识别或 PIN。启用过程可能需要多次验证。</p><label class="form-label">当前主密码<input id="hello-master-password" type="password" autocomplete="off"></label><p id="hello-enable-error" class="error"></p>','<button class="btn primary" id="hello-enable-confirm">验证并启用</button>');
  $('hello-enable-confirm').onclick=async()=>{const btn=$('hello-enable-confirm');btn.disabled=true;btn.textContent='请完成 Windows 系统验证…';try{const password=$('hello-master-password').value;$('hello-master-password').value='';await api.enableHello(password);$('utility-dialog').close();await showSettings();toast('Windows Hello 已启用，锁定后可使用。');}catch(error){if($('hello-enable-error'))$('hello-enable-error').textContent=error.message;}finally{btn.disabled=false;btn.textContent='验证并启用';}};
 });
 addAppearanceSettings(settings);
 const advancedButton=document.createElement('button');advancedButton.className='btn full';advancedButton.id='advanced-settings-button';advancedButton.textContent='提醒、悬浮窗与 AI…';$('idle-minutes').closest('label').before(advancedButton);advancedButton.onclick=()=>attempt(async()=>{$('utility-dialog').close();await showAdvancedSettings();});
 const downloadBlock=document.createElement('div');
 downloadBlock.innerHTML=`<label>默认下载目录</label><div class="path-box" id="download-location-path">${escapeHtml(settings.downloadDirectory)}</div><p class="error">${escapeHtml(settings.downloadError||'')}</p><button id="choose-download-location" class="btn full">更改默认下载目录…</button><button id="settings-export" class="btn full">导出资料与原始附件 ↗</button>`;
 $('idle-minutes').closest('label').before(downloadBlock);
 $('choose-download-location').onclick=()=>attempt(async()=>{if(await api.chooseDownloadDirectory()){await showSettings();toast('默认下载目录已保存。');}});
 $('settings-export').onclick=()=>attempt(showExport);
 $('idle-minutes').onchange=()=>attempt(async()=>{await api.settings({idleMinutes:Number($('idle-minutes').value)});toast('本次会话的锁定时间已更新。');});
 $('change-password').onclick=()=>{
  utility('修改登录密码','<p>当前档案使用新密码，恢复密钥保持有效。已有备份仍使用备份时的密码。</p><label class="form-label">新密码（至少 12 个字符）<input id="new-password" type="password" autocomplete="off"></label><label class="form-label">再次输入新密码<input id="repeat-password" type="password" autocomplete="off"></label><p id="password-error" class="error"></p>','<button class="btn primary" id="change-password-confirm">保存新密码</button>');
  $('change-password-confirm').onclick=async()=>{const btn=$('change-password-confirm');try{if($('new-password').value!==$('repeat-password').value)throw new Error('两次密码不一致。');btn.disabled=true;await api.changePassword($('new-password').value);$('new-password').value='';$('repeat-password').value='';$('utility-dialog').close();toast('密码已修改，旧备份的密码保持不变。');}catch(error){$('password-error').textContent=error.message;}finally{btn.disabled=false;}};
 };
 $('create-backup').onclick=()=>attempt(async()=>{if(await api.backup())toast('完整加密备份已保存。');});
 $('restore-backup').onclick=()=>credentialDialog('恢复加密备份','备份内容将替换当前资料。恢复前自动另存当前完整档案，当前登录密码和恢复密钥保持有效。',async(credential,recovery)=>{const result=await api.restore(credential,recovery);if(result){state.activeId=null;state.selected.clear();state.collection=null;state.category=null;state.trash=false;await refresh();toast('已恢复备份，并保留恢复前的完整档案。');}return result;});
 if($('delete-current-collection'))$('delete-current-collection').onclick=()=>attempt(async()=>{if(await confirmModal('删除材料清单','只删除当前清单，保留全部原始资料和附件。','删除清单')){await api.deleteCollection(state.collection);navigate();toast('清单已删除，原始资料保留。');}});
}
async function showExport(){
 const [data,settings]=await Promise.all([api.snapshot(),api.settings()]);
 const all=data.records,selected=new Set(selectedIds());let directory=null;
 const scopeOptions=`<option value="selected" ${selected.size?'':'disabled'}>所选资料（${selected.size} 条）</option>${state.category?'<option value="category">当前分类</option>':''}${state.collection?'<option value="collection">当前材料清单</option>':''}<option value="all">全部有效资料</option>`;
 const collectionIds=state.collection?new Set((await api.snapshot({collection:state.collection})).records.map(r=>r.id)):new Set();
 utility('导出资料与附件',`<p>原始图片保留导入时的尺寸和文件内容。普通导出文件不受档案密码保护，请妥善保存。</p><label class="form-label">导出范围<select id="export-scope">${scopeOptions}</select></label><label class="form-label">导出内容<select id="export-kind"><option value="zip">资料＋全部证明附件（ZIP）</option><option value="images">仅原始图片（ZIP，不含 PDF）</option><option value="attachments">仅原始附件（ZIP，含图片和 PDF）</option><option value="csv">表格（CSV，可用 Excel 打开）</option><option value="txt">文字汇总（TXT）</option><option value="json">结构化资料（JSON）</option></select></label><label class="form-label">附件范围<select id="export-attachment-group"><option value="all">全部附件</option><option value="general">仅普通附件</option><option value="document">仅证件图片 / PDF</option><option value="profile-photo">仅个人照片</option></select></label><div id="export-format-options"><label class="check-label"><input type="checkbox" id="export-descriptions" checked> 包含描述版本</label><label class="check-label"><input type="checkbox" id="export-notes" checked> 包含资料备注</label><details class="export-details"><summary>选择导出字段</summary><div id="export-field-list" class="export-field-list"></div></details></div><label class="form-label">本次保存位置</label><div class="path-box" id="export-directory"></div><div class="export-path-actions"><button type="button" class="text-button" id="export-choose-directory">选择其他文件夹…</button><button type="button" class="text-button" id="export-default-directory">使用默认下载目录</button></div><p class="note">不另选位置时直接保存至默认下载目录；同名文件自动编号。TXT 和 CSV 使用“${escapeHtml(state.version)}”描述。</p><p class="error" id="export-error"></p>`,`<button type="button" class="btn primary" id="export-confirm">导出</button>`);
 $('export-scope').value=selected.size?'selected':'all';
 const records=()=>all.filter(r=>{const scope=$('export-scope').value;return scope==='all'||scope==='selected'&&selected.has(r.id)||scope==='category'&&r.category===state.category||scope==='collection'&&collectionIds.has(r.id);});
 const drawFields=()=>{$('export-field-list').innerHTML=[...new Set(records().flatMap(r=>Object.keys(r.fields)))].map(name=>`<label class="check-label"><input type="checkbox" checked data-export-field="${escapeHtml(name)}"> ${escapeHtml(name)}</label>`).join('');};drawFields();
 $('export-scope').onchange=drawFields;
 const drawPath=()=>{$('export-directory').textContent=directory||settings.downloadDirectory;$('export-error').textContent=!directory?(settings.downloadError||''):'';};drawPath();
 $('export-choose-directory').onclick=()=>attempt(async()=>{const selected=await api.chooseExportDirectory();if(selected){directory=selected;drawPath();}});
 $('export-default-directory').onclick=()=>{directory=null;drawPath();};
 $('export-kind').onchange=()=>$('export-format-options').hidden=['images','attachments'].includes($('export-kind').value);
 $('export-confirm').onclick=async()=>{
  const button=$('export-confirm');button.disabled=true;button.textContent='正在导出…';$('export-error').textContent='';
  try{
   const result=await api.exportRecords(records().map(r=>r.id),state.version,$('export-kind').value,{useDefault:true,directory:directory||undefined,fields:[...document.querySelectorAll('[data-export-field]:checked')].map(input=>input.dataset.exportField),includeDescriptions:$('export-descriptions').checked,includeNotes:$('export-notes').checked,attachmentGroup:$('export-attachment-group').value});
   if(result){utility('导出完成',`<p>已保存至：</p><div class="path-box">${escapeHtml(result.path)}</div><p>共 ${records().length} 条资料${result.attachmentCount!==undefined?'，'+result.attachmentCount+' 个附件':''}。</p>`);toast('导出完成。');}
  }catch(error){if($('export-error'))$('export-error').textContent=error.message;else toast(error.message,true);}
  finally{button.disabled=false;button.textContent='导出';}
 };
}
async function showAttachmentExport(id){
 const settings=await api.settings();
 utility('导出原始附件',`<p>保留原文件格式、尺寸与内容。</p><label>默认下载目录</label><div class="path-box">${escapeHtml(settings.downloadDirectory)}</div><p class="error" id="attachment-export-error"></p>`,`<button class="btn" id="attachment-save-as">选择位置另存…</button><button class="btn primary" id="attachment-default">保存到默认目录</button>`);
 for(const [button,options]of [['attachment-save-as',undefined],['attachment-default',{useDefault:true}]])$(button).onclick=async()=>{try{const result=await api.exportAttachment(id,options);if(result){utility('导出完成',`<p>原始附件已保存至：</p><div class="path-box">${escapeHtml(result.path)}</div>`);}}catch(error){$('attachment-export-error').textContent=error.message;}};
}
function bindEvents(){
 $('login-form').onsubmit=login;
 $('hello-login').onclick=async()=>{const button=$('hello-login');button.disabled=true;button.textContent='请完成 Windows Hello 验证…';$('login-error').textContent='';try{await enterApp(await api.helloUnlock());}catch(error){$('login-error').textContent=error.message;}finally{button.disabled=false;button.textContent='使用 Windows Hello 登录';}};
 $('show-password').onchange=()=>{for(const id of ['login-password','login-repeat'])$(id).type=$('show-password').checked?'text':'password';};
 $('use-recovery').onchange=()=>$('password-label').textContent=$('use-recovery').checked?'恢复密钥':'登录密码';
 $('initial-restore').onclick=()=>credentialDialog('从已有备份开始','输入备份的密码或恢复密钥，再选择加密备份。恢复后沿用此备份的登录密码和恢复密钥。',async(credential,recovery)=>{const data=await api.initialRestore(credential,recovery);if(data)await enterApp(data);return data;});
 $('login-choose-location').onclick=()=>attempt(async()=>{const result=await api.chooseLocation();if(result){state.status=await api.status();renderLogin();toast(result.migrated?'资料和备份已迁移，请用原密码解锁。':result.changed?'位置已记住，请继续创建或解锁档案。':'当前已经使用此目录。');}});
 $('category-nav').onclick=e=>{const item=e.target.closest('[data-category]');if(item)navigate(item.dataset.category||null);};
 $('collection-nav').onclick=e=>{const item=e.target.closest('[data-collection]');if(item)navigate(null,item.dataset.collection);};
 $('trash-nav').onclick=()=>navigate(null,null,true);
 $('new-collection').onclick=()=>attempt(newCollection);
 $('settings-button').onclick=()=>attempt(showSettings);
 $('lock-button').onclick=()=>attempt(()=>api.lock());
 $('add-record').onclick=()=>attempt(()=>openEditor());$('edit-record').onclick=()=>{if(currentRecord())attempt(()=>openEditor(currentRecord()));};
 $('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>attempt(()=>refresh()),180);};
 $('missing-filter').onchange=()=>attempt(()=>refresh());
 $('version-select').onchange=()=>{state.version=$('version-select').value;attempt(renderDetail);};
 $('record-list').onclick=e=>{
  const row=e.target.closest('.record-row');if(!row)return;
  const id=row.dataset.id;
  if(e.target.classList.contains('row-check')){if(e.target.checked)state.selected.add(id);else state.selected.delete(id);state.activeId=id;}
  else{state.selected=new Set([id]);state.activeId=id;}
  state.sensitive=false;renderList();renderHeading();attempt(renderDetail);
 };
 $('record-list').ondblclick=e=>{if(!state.trash&&e.target.closest('.record-row'))attempt(()=>openEditor(currentRecord()));};
 $('select-all').onchange=()=>{state.selected=new Set($('select-all').checked?state.records.map(r=>r.id):[]);renderList();renderHeading();};
 $('detail-panel').onclick=e=>attempt(async()=>{
  const tab=e.target.closest('[data-detail-tab]');if(tab){state.detailTab=tab.dataset.detailTab;await renderDetail();return;}
  const field=e.target.closest('[data-copy-field]');if(field){await copyValue('field',field.dataset.copyField);return;}
  if(e.target.id==='copy-description')return copyValue('description',state.version);
  if(e.target.id==='copy-full')return copyValue('record',state.version);
  if(e.target.id==='import-attachments'){
   await startAttachmentUpload(state.activeId);return;
  }
  if(await handleAttachmentClick(e))return;
  const exp=e.target.closest('[data-export-attachment]');if(exp){await showAttachmentExport(exp.dataset.exportAttachment);return;}
  const del=e.target.closest('[data-delete-attachment]');if(del&&await confirmModal('删除附件','从此条资料中删除附件？已有备份仍可能保留此附件。','删除附件')){await api.deleteAttachment(del.dataset.deleteAttachment);await refresh();toast('附件已删除。');}
 });
 $('detail-panel').onchange=e=>{if(e.target.id==='show-sensitive'){state.sensitive=e.target.checked;renderInfo(currentRecord());}};
 $('add-to-collection').onclick=()=>attempt(addToCollection);
 $('remove-from-collection').onclick=()=>attempt(async()=>{await api.removeFromCollection(state.collection,selectedIds());state.selected.clear();await refresh();toast('已移出清单，原始资料保留。');});
 $('delete-record').onclick=()=>attempt(deleteRecords);
 $('restore-record').onclick=()=>attempt(async()=>{await api.trash(selectedIds(),false);state.selected.clear();await refresh();toast('已恢复资料与附件。');});
 $('export-records').onclick=()=>attempt(showExport);
 $('editor-form').onsubmit=saveRecord;
 $('record-category').onchange=()=>attempt(switchEditorCategory);
 bindStructuredFields();
 for(const button of document.querySelectorAll('[data-editor-tab]'))button.onclick=()=>showEditorTab(button.dataset.editorTab);
 $('add-custom').onclick=()=>addCustom();
 $('custom-fields').onclick=e=>{if(e.target.closest('.remove-custom'))e.target.closest('.custom-row').remove();};
 $('description-tabs').onclick=e=>{const button=e.target.closest('[data-description-tab]');if(!button)return;for(const input of $('description-editors').querySelectorAll('textarea'))editor.versions[input.dataset.version]=input.value;editor.activeVersion=button.dataset.descriptionTab;drawDescriptions();};
 $('description-editors').oninput=e=>{if(e.target.matches('textarea'))e.target.closest('.description-editor').querySelector('.character-count span').textContent=[...e.target.value].length;};
 for(const button of document.querySelectorAll('.close-dialog'))button.onclick=()=>$(button.dataset.dialog).close();
 $('image-dialog').addEventListener('close',()=>$('full-image').removeAttribute('src'));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')&&state.status?.unlocked)e.preventDefault();});
}

