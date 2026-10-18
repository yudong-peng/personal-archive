'use strict';
let thumbnailGeneration=0,activeUpload=null;
function attachmentName(file){const name=file.metadata?.displayName?.trim(),ext=file.name.match(/\.[^.]+$/)?.[0]||'';return name?(name.toLowerCase().endsWith(ext.toLowerCase())?name:name+ext):file.name;}
function attachmentGrid(files,record,protectedImages=false){
 return `<div class="attachment-grid">${files.map(file=>{
  const sensitive=protectedImages||file.metadata.role==='document',image=file.mime.startsWith('image/');
  return `<article class="attachment-card ${sensitive?'protected-attachment':''}" data-attachment="${escapeHtml(file.id)}">${sensitive?'<div class="attachment-cover">▣<span>证件附件 · 点击预览</span></div>':image?`<img class="attachment-image" data-thumb="${escapeHtml(file.id)}" alt="${escapeHtml(attachmentName(file))}">`:`<div class="attachment-cover pdf-cover" data-pdf-thumb="${escapeHtml(file.id)}"><span>PDF</span></div>`}<strong title="${escapeHtml(attachmentName(file))}">${escapeHtml(attachmentName(file))}</strong>${file.metadata.pageLabel?`<span class="attachment-page">${escapeHtml(file.metadata.pageLabel)}</span>`:''}<p>${file.metadata.width?`${file.metadata.width} × ${file.metadata.height} px · `:'PDF · '}${(file.size/1024).toFixed(1)} KiB</p>${file.metadata.description?`<p class="attachment-description">${escapeHtml(file.metadata.description)}</p>`:''}<div class="attachment-actions"><button data-preview="${escapeHtml(file.id)}">预览</button><button data-export-attachment="${escapeHtml(file.id)}">导出原件</button>${state.trash?'':`<button data-edit-attachment="${escapeHtml(file.id)}">名称与关联</button><button data-delete-attachment="${escapeHtml(file.id)}">删除</button>`}</div></article>`;
 }).join('')}</div>`;
}
async function loadAttachmentThumbnails(files,recordId){
 const generation=++thumbnailGeneration;
 for(const file of files){
  if(generation!==thumbnailGeneration||state.activeId!==recordId||$('app-screen').hidden)return;
  if(file.metadata.role==='document')continue;
  try{
   if(file.mime.startsWith('image/')){
    const result=await api.attachmentPreview(file.id);
    if(generation!==thumbnailGeneration||state.activeId!==recordId||$('app-screen').hidden)return;
    for(const img of document.querySelectorAll(`[data-thumb="${CSS.escape(file.id)}"]`))if(result.dataURL)img.src=result.dataURL;
   }else{
    const target=document.querySelector(`[data-pdf-thumb="${CSS.escape(file.id)}"]`);if(!target)continue;
    const thumbnail=await pdfThumbnail(file.id);
    if(generation!==thumbnailGeneration||state.activeId!==recordId||$('app-screen').hidden)return;
    if(thumbnail&&target.isConnected){target.replaceChildren();const img=document.createElement('img');img.src=thumbnail;img.alt='PDF 首页预览';target.append(img);}
   }
  }catch{/* Malformed or password-protected PDFs still offer explicit preview/export. */}
 }
}
function relationControls(record,metadata={},prefix=''){
 const personal=record.category==='个人基本信息',documents=recordDocuments(record);
 return `${personal?`<label>附件分类<select class="upload-role"><option value="general" ${!metadata.role||metadata.role==='general'?'selected':''}>普通附件</option><option value="profile-photo" ${metadata.role==='profile-photo'?'selected':''}>个人照片</option><option value="document" ${metadata.role==='document'?'selected':''}>证件图片 / PDF</option></select></label><label class="upload-document-wrap">关联证件<select class="upload-document">${options(documents.map(doc=>doc.id),metadata.documentId||'','请选择证件').replace(/<option value="([^"]+)"[^>]*>[^<]*<\/option>/g,(all,id)=>{const doc=documents.find(doc=>doc.id===id);return doc?all.replace(/>[^<]*</,'>'+escapeHtml(documentLabel(doc))+'<'):all;})}</select></label><label class="upload-page-wrap">页别<input class="upload-page" list="choices-证件页别" placeholder="例如人像面、信息页" value="${escapeHtml(metadata.pageLabel||'')}"></label>`:'<input type="hidden" class="upload-role" value="general">'}`;
}
function updateRelationVisibility(container){
 const document=container.querySelector('.upload-role').value==='document';
 for(const element of container.querySelectorAll('.upload-document-wrap,.upload-page-wrap'))element.hidden=!document;
}
function metadataOf(container){return {displayName:container.querySelector('.upload-name').value,description:container.querySelector('.upload-description').value,role:container.querySelector('.upload-role').value,documentId:container.querySelector('.upload-document')?.value||'',pageLabel:container.querySelector('.upload-page')?.value||''};}
async function startAttachmentUpload(recordId,context={}){
 const result=await api.selectAttachments(recordId);if(result)await showUploadBatch(recordId,result,context);
}
async function showUploadBatch(recordId,batch,context={}){
 if(!batch.token){toast(batch.errors.join('\n')||'未选择可用文件。',true);return;}
 const record=(await api.snapshot()).records.find(record=>record.id===recordId);if(!record){await api.cancelAttachments(batch.token);throw new Error('资料已不可用，请重新选择。');}
 activeUpload={token:batch.token,recordId};
 utility('添加附件',`<p>可在保存前设置名称和说明。文件扩展名自动保留，原始文件内容保持完整。</p>${batch.errors.length?`<p class="error">${escapeHtml(batch.errors.join('\n'))}</p>`:''}<div id="upload-file-list">${batch.files.map(file=>`<section class="upload-item" data-upload-id="${escapeHtml(file.id)}"><div class="upload-file-heading">${file.thumbnail?`<img alt="待上传图片" src="${file.thumbnail}">`:'<span class="pending-pdf">PDF</span>'}<div><strong>${escapeHtml(file.name)}</strong><small>${(file.size/1024).toFixed(1)} KiB</small></div></div><label>附件名称<input class="upload-name" value="${escapeHtml(file.name.replace(/\.[^.]+$/,''))}" maxlength="150"></label><div class="upload-relations">${relationControls(record,context)}</div><label>说明（可选）<textarea rows="2" class="upload-description" maxlength="2000"></textarea></label></section>`).join('')}</div><p id="upload-error" class="error"></p>`,`<button class="btn" id="upload-cancel">取消</button><button class="btn primary" id="upload-save">保存 ${batch.files.length} 个附件</button>`);
 const token=batch.token;
 $('upload-cancel').onclick=()=>$('utility-dialog').close();
 for(const row of document.querySelectorAll('.upload-item')){updateRelationVisibility(row);row.querySelector('.upload-role').onchange=()=>updateRelationVisibility(row);}
 $('upload-save').onclick=async()=>{
  const button=$('upload-save');button.disabled=true;button.textContent='正在加密保存…';
  try{
   const items=[...document.querySelectorAll('[data-upload-id]')].map(row=>({id:row.dataset.uploadId,...metadataOf(row)}));
   const result=await api.commitAttachments(token,items);activeUpload=null;$('utility-dialog').close();
   state.selected=new Set([recordId]);await refresh(recordId);
   toast(`已保存 ${result.added} 个附件。`+(result.errors.length?'\n'+result.errors.join('\n'):''),!!result.errors.length);
  }catch(error){if($('upload-error'))$('upload-error').textContent=error.message;else toast(error.message,true);}
  finally{button.disabled=false;button.textContent='保存附件';}
 };
}
async function editAttachment(id){
 const file=state.attachments.find(file=>file.id===id);if(!file)return;
 const record=currentRecord();
 utility('附件名称与关联',`<div id="attachment-edit"><p>原文件名：${escapeHtml(file.name)}</p><label class="form-label">附件名称<input class="upload-name" maxlength="150" value="${escapeHtml(attachmentName(file).replace(/\.[^.]+$/,''))}"></label><div class="upload-relations">${relationControls(record,file.metadata)}</div><label class="form-label">说明<textarea rows="3" class="upload-description" maxlength="2000">${escapeHtml(file.metadata.description||'')}</textarea></label></div><p id="attachment-edit-error" class="error"></p>`,`<button class="btn primary" id="attachment-edit-save">保存修改</button>`);
 updateRelationVisibility($('attachment-edit'));$('attachment-edit').querySelector('.upload-role').onchange=()=>updateRelationVisibility($('attachment-edit'));
 $('attachment-edit-save').onclick=async()=>{try{await api.updateAttachment(id,metadataOf($('attachment-edit')));$('utility-dialog').close();await refresh(record.id);toast('附件名称与关联已保存。');}catch(error){$('attachment-edit-error').textContent=error.message;}};
}
async function handleAttachmentClick(event){
 const preview=event.target.closest('[data-preview]');if(preview){await openPreview(preview.dataset.preview);return true;}
 const card=event.target.closest('.attachment-card');
 if(card&&(event.target.matches('.attachment-image,.attachment-cover,.attachment-cover *'))){await openPreview(card.dataset.attachment);return true;}
 const edit=event.target.closest('[data-edit-attachment]');if(edit){await editAttachment(edit.dataset.editAttachment);return true;}
 const exportButton=event.target.closest('[data-export-attachment]');if(exportButton){await showAttachmentExport(exportButton.dataset.exportAttachment);return true;}
 const remove=event.target.closest('[data-delete-attachment]');if(remove){if(await confirmModal('删除附件','删除此附件？已有备份仍可能保留旧内容。','删除附件')){await api.deleteAttachment(remove.dataset.deleteAttachment);await refresh();toast('附件已删除。');}return true;}
 return false;
}
function bindAttachmentDrops(){
 $('utility-dialog').addEventListener('close',()=>{
  if($('utility-dialog').open||!activeUpload)return;
  const token=activeUpload.token;activeUpload=null;api.cancelAttachments(token).catch(()=>{});
 });
 let depth=0;
 const files=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
 document.addEventListener('dragenter',event=>{if(!files(event))return;event.preventDefault();depth++;if(!$('app-screen').hidden&&!document.querySelector('dialog[open]'))$('drop-overlay').hidden=false;});
 document.addEventListener('dragover',event=>{if(files(event)){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
 document.addEventListener('dragleave',event=>{if(!files(event))return;if(--depth<=0){depth=0;$('drop-overlay').hidden=true;}});
 document.addEventListener('drop',event=>{
  if(!files(event))return;event.preventDefault();depth=0;$('drop-overlay').hidden=true;
  attempt(async()=>{
   if($('app-screen').hidden)throw new Error('请先解锁档案再添加附件。');
   if(document.querySelector('dialog[open]'))throw new Error('请先保存或关闭当前窗口，再拖入附件。');
   if(state.trash)throw new Error('请先恢复资料再添加附件。');
   const row=event.target.closest('.record-row'),recordId=row?.dataset.id||state.activeId;
   if(!recordId)throw new Error('请先建立并保存一份资料，再添加附件。');
   const doc=event.target.closest('[data-document]'),context=doc?{role:'document',documentId:doc.dataset.document}:{};
   const result=await api.stageDroppedFiles(recordId,Array.from(event.dataTransfer.files));
   await showUploadBatch(recordId,result,context);
  });
 });

}
