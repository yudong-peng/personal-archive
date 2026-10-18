'use strict';
let pdfLibraryPromise,previewEpoch=0;
const pdfJobs=new Set();
let viewer={ids:[],index:0,pdf:null,task:null,renderTask:null,image:null,page:1,pages:1,scale:1,rotation:0,paint:0};
async function pdfLibrary(){
 return pdfLibraryPromise||=(async()=>{const library=await import('./vendor/pdfjs/pdf.mjs');library.GlobalWorkerOptions.workerSrc=new URL('vendor/pdfjs/pdf.worker.mjs',document.baseURI).href;return library;})();
}
function rawBytes(base64){return Uint8Array.from(atob(base64),char=>char.charCodeAt(0));}
async function loadPdf(data,onPassword,expectedEpoch=previewEpoch){
 const library=await pdfLibrary(),base=new URL('vendor/pdfjs/',document.baseURI).href;
 if(expectedEpoch!==previewEpoch){data.fill(0);throw new Error('预览已关闭。');}
 const task=library.getDocument({data,isEvalSupported:false,disableFontFace:true,useSystemFonts:true,useWorkerFetch:false,enableXfa:false,maxImageSize:40000000,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',verbosity:0});
 pdfJobs.add(task);task.onPassword=onPassword||(()=>{task.destroy().catch(()=>{});});return task;
}
async function pdfThumbnail(id){
 const epoch=previewEpoch,content=await api.attachmentContent(id);if(epoch!==previewEpoch)return null;
 const task=await loadPdf(rawBytes(content.data));
 try{
  const pdfDocument=await task.promise;if(epoch!==previewEpoch)return null;
  const page=await pdfDocument.getPage(1),initial=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(220/initial.width,170/initial.height)}),canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  if(epoch!==previewEpoch)return null;
  return canvas.toDataURL('image/png');
 }finally{pdfJobs.delete(task);await task.destroy();}
}
async function destroyViewerDocument(){
 if(viewer.renderTask){try{viewer.renderTask.cancel();}catch{}viewer.renderTask=null;}
 if(viewer.task){const task=viewer.task;viewer.task=null;pdfJobs.delete(task);task.destroy().catch(()=>{});}
 viewer.pdf=null;viewer.image=null;$('viewer-image').removeAttribute('src');$('viewer-image').hidden=true;$('viewer-canvas').hidden=true;$('viewer-canvas').width=0;$('viewer-canvas').height=0;
}
function clearPreview(){
 previewEpoch++;thumbnailGeneration++;destroyViewerDocument();for(const task of pdfJobs)task.destroy().catch(()=>{});pdfJobs.clear();
 viewer.ids=[];$('preview-name').textContent='';$('preview-caption').textContent='';$('preview-message').replaceChildren();$('preview-stage').removeAttribute('style');
}
async function openPreview(id){
 const files=state.attachments;if(!files.some(file=>file.id===id))return;
 viewer.ids=files.map(file=>file.id);viewer.index=viewer.ids.indexOf(id);
 if(!$('preview-dialog').open)$('preview-dialog').showModal();
 await showPreviewFile();
}
async function showPreviewFile(){
 const epoch=++previewEpoch;await destroyViewerDocument();viewer.page=1;viewer.pages=1;viewer.rotation=0;viewer.scale=1;viewer.paint++;
 const id=viewer.ids[viewer.index],file=state.attachments.find(file=>file.id===id);if(!file||!$('preview-dialog').open)return;
 $('preview-name').textContent=attachmentName(file);$('preview-caption').textContent=`${viewer.index+1} / ${viewer.ids.length} 份附件 · ${(file.size/1024).toFixed(1)} KiB`;
 $('preview-prev').disabled=viewer.index===0;$('preview-next').disabled=viewer.index===viewer.ids.length-1;
 $('pdf-page-controls').hidden=file.mime!=='application/pdf';$('preview-message').textContent='正在读取附件…';
 try{
  const content=await api.attachmentContent(id);if(epoch!==previewEpoch||!$('preview-dialog').open)return;
  if(content.mime==='application/pdf'){
   const task=await loadPdf(rawBytes(content.data),(updatePassword,reason)=>{
    if(epoch!==previewEpoch){task.destroy().catch(()=>{});return;}
    $('preview-message').innerHTML=`<label>${reason===2?'密码不正确，请重试':'此 PDF 需要密码'}<input id="pdf-password" type="password" autocomplete="off"><button id="pdf-password-submit" class="btn small">打开</button></label>`;
    $('pdf-password-submit').onclick=()=>{const password=$('pdf-password').value;$('preview-message').replaceChildren();updatePassword(password);};$('pdf-password').focus();
   });
   if(epoch!==previewEpoch){await task.destroy();return;}
   viewer.task=task;viewer.pdf=await task.promise;if(epoch!==previewEpoch)return;viewer.pages=viewer.pdf.numPages;
   $('viewer-canvas').hidden=false;await fitPreview();
  }else{
   const image=$('viewer-image');image.src=`data:${content.mime};base64,${content.data}`;await image.decode();if(epoch!==previewEpoch)return;
   viewer.image={width:image.naturalWidth,height:image.naturalHeight};image.hidden=false;await fitPreview();
  }
  if(epoch===previewEpoch)$('preview-message').textContent='';
 }catch(error){if(epoch===previewEpoch)$('preview-message').textContent='无法预览此附件：'+(error.message||'文件格式不完整')+'。仍可导出原件检查。';}
}
async function previewBaseSize(){
 if(viewer.pdf){const page=await viewer.pdf.getPage(viewer.page),viewport=page.getViewport({scale:1,rotation:(page.rotate+viewer.rotation)%360});return {width:viewport.width,height:viewport.height};}
 if(viewer.image)return viewer.rotation%180?{width:viewer.image.height,height:viewer.image.width}:viewer.image;
 return null;
}
async function fitPreview(){
 const epoch=previewEpoch,size=await previewBaseSize();if(!size||epoch!==previewEpoch)return;
 const viewport=$('preview-viewport');viewer.scale=Math.max(0.05,Math.min(4,(viewport.clientWidth-48)/size.width,(viewport.clientHeight-40)/size.height));await paintPreview();
}
async function paintPreview(){
 const epoch=previewEpoch,paint=++viewer.paint;
 $('preview-zoom').textContent=Math.round(viewer.scale*100)+'%';
 $('pdf-page').value=viewer.page;$('pdf-page').max=viewer.pages;$('pdf-page-count').textContent='/ '+viewer.pages;$('pdf-prev').disabled=viewer.page<=1;$('pdf-next').disabled=viewer.page>=viewer.pages;
 if(viewer.pdf){
  if(viewer.renderTask){viewer.renderTask.cancel();try{await viewer.renderTask.promise;}catch{}viewer.renderTask=null;}
  const page=await viewer.pdf.getPage(viewer.page);if(epoch!==previewEpoch||paint!==viewer.paint)return;
  const base=page.getViewport({scale:1,rotation:(page.rotate+viewer.rotation)%360}),ratio=Math.min(viewer.scale,Math.sqrt(16000000/(base.width*base.height))),viewport=page.getViewport({scale:ratio,rotation:(page.rotate+viewer.rotation)%360});
  const canvas=$('viewer-canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.style.width=base.width*viewer.scale+'px';canvas.style.height=base.height*viewer.scale+'px';
  $('preview-stage').style.width=base.width*viewer.scale+'px';$('preview-stage').style.height=base.height*viewer.scale+'px';
  const task=page.render({canvasContext:canvas.getContext('2d'),viewport});viewer.renderTask=task;try{await task.promise;}catch(error){if(error.name!=='RenderingCancelledException')throw error;}
  if(viewer.renderTask===task)viewer.renderTask=null;
 }else if(viewer.image){
  const size=await previewBaseSize();if(epoch!==previewEpoch||paint!==viewer.paint)return;
  const stage=$('preview-stage'),image=$('viewer-image');stage.style.width=size.width*viewer.scale+'px';stage.style.height=size.height*viewer.scale+'px';
  image.style.width=viewer.image.width*viewer.scale+'px';image.style.height=viewer.image.height*viewer.scale+'px';image.style.transform=`translate(-50%,-50%) rotate(${viewer.rotation}deg)`;
 }
}
function bindPreview(){
 $('preview-close').onclick=()=>$('preview-dialog').close();$('preview-dialog').addEventListener('close',()=>{if(!$('preview-dialog').open)clearPreview();});
 for(const [id,direction]of [['preview-prev',-1],['preview-next',1]])$(id).onclick=()=>attempt(async()=>{viewer.index=Math.max(0,Math.min(viewer.ids.length-1,viewer.index+direction));await showPreviewFile();});
 $('preview-fit').onclick=()=>attempt(fitPreview);
 $('preview-original').onclick=()=>attempt(async()=>{viewer.scale=1;await paintPreview();});
 $('preview-zoom-out').onclick=()=>attempt(async()=>{viewer.scale=Math.max(0.05,viewer.scale/1.25);await paintPreview();});
 $('preview-zoom-in').onclick=()=>attempt(async()=>{viewer.scale=Math.min(4,viewer.scale*1.25);await paintPreview();});
 $('preview-rotate').onclick=()=>attempt(async()=>{viewer.rotation=(viewer.rotation+90)%360;await paintPreview();});
 for(const [id,direction]of [['pdf-prev',-1],['pdf-next',1]])$(id).onclick=()=>attempt(async()=>{viewer.page=Math.max(1,Math.min(viewer.pages,viewer.page+direction));await paintPreview();});
 $('pdf-page').onchange=()=>attempt(async()=>{viewer.page=Math.max(1,Math.min(viewer.pages,Math.floor(Number($('pdf-page').value)||1)));await paintPreview();});
 $('preview-export').onclick=()=>attempt(()=>showAttachmentExport(viewer.ids[viewer.index]));
 $('preview-dialog').onkeydown=event=>{
  if(event.target.matches('input'))return;
  if(event.key==='ArrowLeft'){$('preview-prev').click();event.preventDefault();}if(event.key==='ArrowRight'){$('preview-next').click();event.preventDefault();}
 };
}
