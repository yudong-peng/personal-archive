'use strict';
function isProfilePage(){return !state.trash&&!state.collection&&state.fields.singletons.includes(state.category);}
function applyPageLayout(){
 const profile=isProfilePage();$('profile-page').hidden=!profile;document.querySelector('.archive-section').hidden=profile;document.querySelector('.stats-grid').hidden=profile;
 if(profile){$('detail-panel').replaceChildren();$('record-list').replaceChildren();}
 else{$('profile-page').replaceChildren();applyPaneRatio();}
}
function recordDocuments(record){try{return JSON.parse(record?.fields['证件资料']||'[]');}catch{return [];}}
function documentLabel(doc){return doc.type+(doc.fields['学校']?' · '+doc.fields['学校']:doc.fields['证件名称']?' · '+doc.fields['证件名称']:'');}
function profileFields(entries,context={}){
 if(!entries.length)return '<p class="profile-placeholder">暂无内容，可点击编辑补充。</p>';
 return `<div class="profile-fields">${entries.map(([key,value])=>`<div class="profile-field"><div class="field-key"><span>${escapeHtml(key)}</span><button class="copy-mini" data-copy-field="${escapeHtml(key)}" ${context.documentId?`data-copy-document="${escapeHtml(context.documentId)}"`:context.relativeIndex!==undefined?`data-copy-relative="${context.relativeIndex}"`:""}>复制</button></div><div class="field-value">${escapeHtml(value&&!state.sensitive&&isSensitive(key)?'••••••••':value||'—')}</div></div>`).join('')}</div>`;
}
function readDocuments(){
 return [...$('document-fields').querySelectorAll('.document-editor')].map(card=>({id:card.dataset.documentId,type:card.dataset.documentType,fields:Object.fromEntries([...card.querySelectorAll('[data-document-field]')].map(input=>[input.dataset.documentField,valueOf(input)]))}));
}
function drawDocumentEditors(values){
 $('document-fields').replaceChildren();if(editor.category!=='个人基本信息')return;
 $('document-fields').innerHTML=`<div class="custom-heading"><h3>证件资料（可选）</h3><div class="add-document-bar"><select id="new-document-type" aria-label="新增证件类型">${Object.keys(state.fields.documentTypes).map(type=>`<option>${escapeHtml(type)}</option>`).join('')}</select><button id="add-document" type="button" class="text-button">＋ 添加证件</button></div></div><p class="form-hint">可保存身份证、不同就学阶段的学生证及其他证件。保存后，可在证件卡片中添加或关联图片、PDF。</p><div id="document-editor-list"></div>`;
 let documents;try{documents=JSON.parse(values['证件资料']||'[]');}catch{throw new Error('证件资料无法解析，请保留原始档案并检查。');}
 for(const doc of documents)addDocumentEditor(doc);
 $('add-document').onclick=()=>{
  if($('document-editor-list').children.length>=50){toast('最多保存 50 组证件。',true);return;}
  const type=$('new-document-type').value,fields={};
  if(type==='身份证'){fields['姓名']=document.querySelector('[data-field="姓名"]')?.value||'';const number=document.querySelector('[data-field="证件号码"]')?.value||'';if(/^[0-9]{17}[0-9Xx]$/.test(number))fields['身份证号码']=number;}
  addDocumentEditor({id:crypto.randomUUID(),type,fields});
 };
}
function addDocumentEditor(doc){
 const card=document.createElement('section');card.className='relative-card document-editor';card.dataset.documentId=doc.id;card.dataset.documentType=doc.type;
 card.innerHTML=`<div class="relative-heading"><h4>${escapeHtml(doc.type)}</h4><button type="button" class="text-button remove-document">移除这组证件</button></div><div class="fields-grid">${state.fields.documentTypes[doc.type].map(name=>`<label><span>${escapeHtml(name)}</span>${name==='就学阶段'?`<select data-document-field="${escapeHtml(name)}">${options(Object.keys(state.fields.educationStages),doc.fields[name]||'')}</select>`:control(name,doc.fields[name]||'',`data-document-field="${escapeHtml(name)}"`)}</label>`).join('')}</div>`;
 card.querySelector('.remove-document').onclick=()=>{card.remove();toast('保存后移除此组证件；关联附件将保留为普通附件。');};$('document-editor-list').append(card);
}
async function renderProfile(){
 const category=state.category,record=currentRecord(),generation=loadVersion;
 if(!record){$('profile-page').innerHTML=`<div class="profile-empty"><span class="profile-monogram">${category==='家庭信息'?'家':'我'}</span><h2>${category==='家庭信息'?'建立你的家庭档案':'完善你的个人信息'}</h2><p>基础信息与关联材料在这里完整展示，需要时直接复制或导出。</p><button id="profile-create" class="btn primary">${category==='家庭信息'?'建立家庭信息':'完善个人信息'}</button></div>`;return;}
 const data=await api.snapshot({selectedId:record.id});if(!isProfilePage()||state.activeId!==record.id||generation!==loadVersion)return;
 state.attachments=data.attachments||[];
 const documents=recordDocuments(record),personal=category==='个人基本信息';
 const ordinary=state.attachments.filter(a=>a.metadata.role!=='document'),portrait=state.attachments.find(a=>a.metadata.role==='profile-photo');
 const fields=Object.entries(record.fields).filter(([k])=>!['证件资料','亲属信息'].includes(k));
 const addresses=fields.filter(([key])=>/地址|住址|邮政编码|现居地|籍贯/.test(key)),basic=fields.filter(entry=>!addresses.includes(entry));
 let relatives=[];if(!personal)relatives=FormModel.relatives(record.fields['亲属信息'])||[];
 $('profile-page').innerHTML=`<div class="profile-hero"><div class="profile-avatar">${portrait?`<img data-thumb="${escapeHtml(portrait.id)}" alt="个人照片"><button data-preview="${escapeHtml(portrait.id)}" aria-label="预览个人照片"></button>`:`<span>${personal?escapeHtml(record.fields['姓名']?.slice(0,1)||'我'):'家'}</span>`}</div><div class="profile-intro"><span class="eyebrow">${personal?'PERSONAL PROFILE':'FAMILY PROFILE'}</span><h2>${personal?escapeHtml(record.fields['姓名']||'个人基本信息'):'家庭信息'}</h2><p>${escapeHtml(personal?[record.fields['手机'],record.fields['邮箱']].filter(Boolean).join(' · '):record.fields['家庭住址']||'让家庭资料清晰、有序，随时可用。')}</p><div class="profile-tags">${record.tags.map(tag=>`<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div><span class="profile-updated">最近修改 ${escapeHtml(record.updated.slice(0,10))}</span></div><div class="profile-actions"><button class="btn primary" id="profile-edit">编辑资料</button><button class="btn" id="profile-copy">复制整份</button><button class="btn" id="profile-export">导出</button></div></div><label class="sensitive-toggle"><input id="profile-show-sensitive" type="checkbox" ${state.sensitive?'checked':''}> 显示证件号码等敏感内容</label><div class="profile-sections"><section class="profile-section"><div class="section-title"><h3>${personal?'基础信息':'家庭联系方式'}</h3></div>${profileFields(basic)}</section><section class="profile-section"><div class="section-title"><h3>地址信息</h3></div>${profileFields(addresses)}</section>${personal?`<section class="profile-section full-section"><div class="section-title"><div><h3>证件资料</h3><p>身份证、学生证及其他证件，均为可选资料。</p></div><button class="text-button" id="profile-edit-documents">＋ 管理证件</button></div><div class="document-grid">${documents.map(doc=>`<article class="identity-card" data-document="${escapeHtml(doc.id)}"><div class="section-title"><h4>${escapeHtml(documentLabel(doc))}</h4><button class="text-button" data-upload-document="${escapeHtml(doc.id)}">＋ 添加图片</button></div>${profileFields(Object.entries(doc.fields).filter(([,v])=>v),{documentId:doc.id})}<div class="document-attachments">${attachmentGrid(state.attachments.filter(a=>a.metadata.role==='document'&&a.metadata.documentId===doc.id),record,true)}</div><p class="form-hint">可拖入文件，或将已有附件关联到本证件。</p></article>`).join('')||'<div class="profile-placeholder">尚未添加证件。点击“管理证件”，按需填写身份证或学生证信息。</div>'}</div></section>`:`<section class="profile-section full-section"><div class="section-title"><h3>亲属信息 · ${relatives.length} 位</h3><button class="text-button" id="profile-edit-relatives">管理亲属</button></div><div class="relative-grid">${relatives.map((relative,i)=>`<article class="family-member"><div class="member-heading"><span class="member-avatar">${escapeHtml(relative['关系']?.slice(0,1)||'亲')}</span><div><h4>${escapeHtml(relative['姓名']||'亲属 '+(i+1))}</h4><span>${escapeHtml(relative['关系']||'关系待填写')}</span></div></div>${profileFields(Object.entries(relative).filter(([k,v])=>v&&!['姓名','关系'].includes(k)),{relativeIndex:i})}</article>`).join('')||'<p class="profile-placeholder">还没有亲属记录，点击“管理亲属”添加。</p>'}</div></section>`}<section class="profile-section full-section"><div class="section-title"><div><h3>${personal?'个人照片与普通附件':'家庭资料附件'}</h3><p>可拖入图片或 PDF，支持命名、预览和导出。</p></div><button id="profile-upload" class="btn small">＋ 添加附件</button></div><div class="profile-attachment-grid">${attachmentGrid(ordinary,record)}</div><div class="drop-zone" data-drop-record="${escapeHtml(record.id)}">将文件拖到此处，或点击“添加附件”</div></section>${record.notes?`<section class="profile-section full-section"><h3>备注</h3><p class="profile-note">${escapeHtml(record.notes)}</p></section>`:''}${Object.values(record.versions).some(Boolean)?`<section class="profile-section full-section"><div class="section-title"><h3>描述版本</h3><select id="profile-description-version" aria-label="描述版本">${state.fields.versions.map(version=>`<option ${version===state.version?'selected':''}>${escapeHtml(version)}</option>`).join('')}</select></div><p class="profile-note">${escapeHtml(record.versions[state.version]||'此版本暂未填写。')}</p></section>`:''}</div>`;
 await loadAttachmentThumbnails(ordinary,record.id);
}
function bindProfileEvents(){
 $('profile-page').onclick=e=>attempt(async()=>{
  if(['profile-create','profile-edit','profile-edit-documents','profile-edit-relatives'].includes(e.target.id)){await openEditor(currentRecord());if(e.target.id==='profile-edit-documents')$('document-fields').scrollIntoView({block:'start'});if(e.target.id==='profile-edit-relatives')$('family-fields').scrollIntoView({block:'start'});return;}
  if(e.target.id==='profile-copy')return copyValue('record',state.version);
  if(e.target.id==='profile-export')return showExport();
  if(e.target.id==='profile-upload')return startAttachmentUpload(state.activeId);
  const upload=e.target.closest('[data-upload-document]');if(upload)return startAttachmentUpload(state.activeId,{role:'document',documentId:upload.dataset.uploadDocument});
  const copy=e.target.closest('[data-copy-field]');if(copy){if(copy.dataset.copyDocument)return copyValue('document',{documentId:copy.dataset.copyDocument,key:copy.dataset.copyField});if(copy.dataset.copyRelative!==undefined)return copyValue('relative',{index:Number(copy.dataset.copyRelative),key:copy.dataset.copyField});return copyValue('field',copy.dataset.copyField);}
  await handleAttachmentClick(e);
 });
 $('profile-page').onchange=e=>{if(e.target.id==='profile-description-version'){state.version=e.target.value;$('version-select').value=state.version;attempt(renderProfile);return;}if(e.target.id==='profile-show-sensitive'){state.sensitive=e.target.checked;attempt(renderProfile);}};
}
