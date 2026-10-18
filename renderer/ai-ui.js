'use strict';
const ArchiveAI=(()=>{
 const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let epoch=0,activeJob=null,pdfModule=null;const pdfTasks=new Set();
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function clear(){epoch++;if(activeJob){api.aiCancel(activeJob).catch(()=>{});activeJob=null;}for(const task of pdfTasks)task.destroy().catch(()=>{});pdfTasks.clear();const dialog=$('ai-dialog');if(dialog){dialog.onclose=null;if(dialog.open)dialog.close();dialog.replaceChildren();}}
 function ranges(text,max){
  const result=new Set();for(const part of text.split(',')){const m=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw new Error('页码格式示例：1-3,5');const first=Number(m[1]),last=Number(m[2]||m[1]);if(first<1||last<first||last>10000||last-first>=max)throw new Error('页码超出范围或超过单次上限。');for(let p=first;p<=last;p++)result.add(p);if(result.size>max)throw new Error('选择页数超过单次上限。');}return [...result].sort((a,b)=>a-b);
 }
 async function readPdf(id,pages,mode,password,expected){
  const content=await api.attachmentContent(id);if(epoch!==expected)throw new Error('识别已取消。');
  pdfModule||=await import('./vendor/pdfjs/pdf.mjs');pdfModule.GlobalWorkerOptions.workerSrc=new URL('vendor/pdfjs/pdf.worker.mjs',document.baseURI).href;
  const base=new URL('vendor/pdfjs/',document.baseURI).href,bytes=Uint8Array.from(atob(content.data),c=>c.charCodeAt(0));
  const task=pdfModule.getDocument({data:bytes,password:password||undefined,isEvalSupported:false,disableFontFace:true,useSystemFonts:true,useWorkerFetch:false,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',enableXfa:false,maxImageSize:40000000,verbosity:0});pdfTasks.add(task);
  try{
   const pdf=await task.promise,result=[];
   for(const number of pages){if(epoch!==expected)throw new Error('识别已取消。');if(number>pdf.numPages)throw new Error(`所选页码 ${number} 超出 PDF 的 ${pdf.numPages} 页。`);const page=await pdf.getPage(number);
    if(mode==='text'){const text=await page.getTextContent();result.push({page:number,text:text.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('')});}
    else{const initial=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,1600/Math.max(initial.width,initial.height))}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:context,viewport,background:'white'}).promise;result.push({page:number,image:canvas.toDataURL('image/jpeg',0.88)});canvas.width=canvas.height=0;}
    page.cleanup();
   }return result;
  }catch(error){if(error.name==='PasswordException')throw new Error('PDF 密码缺失或不正确，请填写本地打开密码。');throw error;}finally{pdfTasks.delete(task);await task.destroy();}
 }
 async function wait(id,onTick=()=>{},valid=()=>true){
  while(valid()){const status=await api.aiStatus(id);if(status.state==='done')return status;if(status.state==='error')throw new Error(status.error||'识别失败。');onTick('正在等待模型返回，可取消。原始附件已保存在本地。');await sleep(650);}throw new Error('识别已取消。');
 }
 async function open(recordId,onlyIds){
  clear();const expected=epoch,[config,data]=await Promise.all([api.advanced(),api.snapshot({selectedId:recordId})]);if(epoch!==expected)return;
  const record=data.records.find(r=>r.id===recordId);if(!record)throw new Error('资料不存在，请重新选择。');const files=data.attachments||[],f=data.fields,docs=JSON.parse(record.fields['证件资料']||'[]');
  let dialog=$('ai-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='ai-dialog';dialog.className='advanced-dialog';document.body.append(dialog);}
  dialog.innerHTML=`<div class="advanced-content"><div class="advanced-head"><h2>AI 辅助录入</h2><button id="ai-close" class="icon-button" aria-label="关闭">×</button></div><p><strong>${esc(record.title)}</strong></p><p class="advanced-note">所选材料将发送至 ${esc(config.baseURL)}，模型 ${esc(config.model||'未设置')}。不发送其他资料或现有字段值。识别建议需核对后应用。</p>${!config.aiEnabled?'<p class="error">AI 总开关尚未开启，请先在主程序“设置与备份 → 提醒、悬浮窗与 AI”中配置。</p>':''}<div class="advanced-grid"><label>识别目标分类<select id="ai-category" ${record.category!=='收集箱'?'disabled':''}>${Object.keys(f.categories).filter(c=>c!=='收集箱').map(c=>`<option ${c===record.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label id="ai-stage-wrap">就学阶段<select id="ai-stage">${Object.keys(f.educationStages).map(s=>`<option ${s===record.fields['就学阶段']?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label id="ai-document-wrap">个人信息／证件<select id="ai-document"><option value="">个人基础字段</option>${docs.map(doc=>`<option value="id:${esc(doc.id)}">${esc(doc.type)}${doc.fields['证件名称']?' · '+esc(doc.fields['证件名称']):''}</option>`).join('')}${Object.keys(f.documentTypes).map(type=>`<option value="new:${esc(type)}">新建${esc(type)}</option>`).join('')}</select></label><label id="ai-associate-wrap"><span><input id="ai-associate" type="checkbox" checked> 将所选附件关联至该证件</span></label></div><p class="advanced-note">选定图片会压缩至适合识别的尺寸，保留本地原件。PDF 可选页码，并选择页面图像或本地提取文字。一次最多 ${config.maxPages} 个附件／页面。</p><div class="ai-attachments">${files.map(file=>`<section class="ai-file" data-ai-file="${esc(file.id)}"><label><input type="checkbox" class="ai-file-check" ${!onlyIds||onlyIds.includes(file.id)?'checked':''}><strong>${esc(file.metadata?.displayName||file.name)}</strong></label>${file.mime==='application/pdf'?'<div class="ai-page-controls"><label>页码<input class="ai-pages" value="1" placeholder="1-3,5"></label><select class="ai-pdf-mode" aria-label="PDF 识别方式"><option value="image">页面图像（视觉模型）</option><option value="text">仅提取文字（文字模型）</option></select></div><label class="advanced-note">PDF 打开密码（只在本地使用，可选）<input type="password" class="ai-pdf-password" autocomplete="off"></label>':'<p class="advanced-note">图片 · 需要视觉模型</p>'}</section>`).join('')||'<p class="advanced-note">这条资料没有附件，请先添加图片或 PDF。</p>'}</div><p id="ai-message" class="advanced-message" role="status"></p><div class="advanced-actions"><button id="ai-start" class="btn primary" ${!config.aiEnabled||!files.length?'disabled':''}>发送所选材料并识别</button><button id="ai-cancel" class="btn" hidden>取消识别</button>${record.aiUndoAvailable?'<button id="ai-undo" class="btn">撤销上次 AI 填写</button>':''}</div><div id="ai-results"></div></div>`;
  $('ai-close').onclick=()=>dialog.close();
  const targetVisibility=()=>{$('ai-document-wrap').hidden=$('ai-category').value!=='个人基本信息';$('ai-stage-wrap').hidden=$('ai-category').value!=='就学经历';$('ai-associate-wrap').hidden=$('ai-category').value!=='个人基本信息'||!$('ai-document').value;};$('ai-category').onchange=targetVisibility;$('ai-document').onchange=targetVisibility;targetVisibility();
  if(record.category==='收集箱'){$('ai-category').value='其他资料';targetVisibility();}
  $('ai-cancel').onclick=()=>{clear();};
  if($('ai-undo'))$('ai-undo').onclick=async()=>{try{await api.aiUndo(recordId);dialog.close();if(typeof refresh==='function')await refresh(recordId);}catch(error){$('ai-message').textContent=error.message;}};
  let running=false;
  const lockSelection=disabled=>{for(const input of dialog.querySelectorAll('.ai-attachments input,.ai-attachments select,#ai-category,#ai-document,#ai-stage,#ai-associate'))input.disabled=disabled||(input.id==='ai-category'&&record.category!=='收集箱');};
  dialog.onchange=event=>{if(!running&&activeJob&&event.target.matches('.ai-attachments input,.ai-attachments select,#ai-category,#ai-document,#ai-stage,#ai-associate')){api.aiCancel(activeJob).catch(()=>{});activeJob=null;$('ai-results').replaceChildren();$('ai-message').textContent='选择已改变，请重新识别。';}};
  $('ai-start').onclick=async()=>{running=true;lockSelection(true);
   const button=$('ai-start');button.disabled=true;$('ai-cancel').hidden=false;$('ai-results').replaceChildren();
   try{
    const rows=[...dialog.querySelectorAll('[data-ai-file]')].filter(row=>row.querySelector('.ai-file-check').checked);if(!rows.length)throw new Error('请选择至少一个附件。');
    let count=0;for(const row of rows){const file=files.find(file=>file.id===row.dataset.aiFile);count+=file.mime==='application/pdf'?ranges(row.querySelector('.ai-pages').value,config.maxPages).length:1;}if(count>config.maxPages)throw new Error('本次附件／页数超过设置上限，请分批识别。');
    const category=$('ai-category').value,doc=$('ai-document').value,stage=$('ai-stage').value,parts=[];
    for(const row of rows){if(epoch!==expected)throw new Error('识别已取消。');const file=files.find(file=>file.id===row.dataset.aiFile),part={id:file.id};if(file.mime==='application/pdf'){$('ai-message').textContent='正在本地处理 '+file.name+'…';part.pages=await readPdf(file.id,ranges(row.querySelector('.ai-pages').value,config.maxPages),row.querySelector('.ai-pdf-mode').value,row.querySelector('.ai-pdf-password').value,expected);}parts.push(part);}
    if(epoch!==expected)return;const job=await api.aiStart({recordId,category,stage,associate:$('ai-associate').checked,documentId:category==='个人基本信息'&&doc.startsWith('id:')?doc.slice(3):'',documentType:category==='个人基本信息'&&doc.startsWith('new:')?doc.slice(4):'',parts});if(epoch!==expected){await api.aiCancel(job.id);return;}activeJob=job.id;
    const result=await wait(job.id,text=>{if(epoch===expected)$('ai-message').textContent=text;},()=>epoch===expected);if(epoch!==expected)return;
    $('ai-cancel').hidden=true;$('ai-message').textContent='识别完成。请核对来源、模糊文字与日期；已存在内容默认不替换。'+(result.usage?' 本次接口已返回用量信息。':'');
    const currentDocument=doc.startsWith('id:')?docs.find(d=>d.id===doc.slice(3)):null,currentValues=category==='个人基本信息'&&doc?currentDocument?.fields||{}:record.fields;
    const drawCandidates=()=>{
     $('ai-results').innerHTML=`<div class="advanced-actions"><button id="ai-select-empty" class="btn small">仅选空白且明确的字段</button><button id="ai-select-none" class="btn small">全部取消</button></div><div class="ai-result">${result.result.map((item,i)=>`<article class="ai-candidate"><label><input type="checkbox" data-ai-candidate="${i}" ${!currentValues[item.name]&&!item.uncertain?'checked':''}><strong>${esc(item.name)}</strong></label><div class="ai-compare"><div><small>现有内容</small><p>${esc(currentValues[item.name]||'空白')}</p></div><div><small>识别建议</small><p>${esc(item.value)}</p></div></div>${item.uncertain?'<p class="ai-warning">需要核对：内容可能模糊或缺少明确来源。</p>':''}<div class="ai-source">${item.source?esc(item.source.name)+' · 第 '+item.source.page+' 页':'来源未明确，请人工检查'}</div></article>`).join('')}</div>${result.usage?`<details><summary>接口返回的用量</summary><pre>${esc(JSON.stringify(result.usage,null,2))}</pre></details>`:''}<div class="advanced-actions"><button id="ai-apply" class="btn primary">应用选中的字段</button><button id="ai-source-record" class="btn">打开原始资料</button></div>`;
     $('ai-select-empty').onclick=()=>{for(const input of dialog.querySelectorAll('[data-ai-candidate]')){const item=result.result[Number(input.dataset.aiCandidate)];input.checked=!currentValues[item.name]&&!item.uncertain;}};
     $('ai-select-none').onclick=()=>{for(const input of dialog.querySelectorAll('[data-ai-candidate]'))input.checked=false;};
     $('ai-source-record').onclick=()=>api.openRecord(recordId).catch(error=>{$('ai-message').textContent=error.message;});
     $('ai-apply').onclick=async()=>{const apply=$('ai-apply');apply.disabled=true;try{const names=[...dialog.querySelectorAll('[data-ai-candidate]:checked')].map(input=>result.result[Number(input.dataset.aiCandidate)].name);await api.aiApply(job.id,names);activeJob=null;dialog.close();if(typeof jumpToRecord==='function')await jumpToRecord(recordId);if(typeof toast==='function')toast('已应用识别结果，可在 AI 辅助录入中撤销。');}catch(error){if($('ai-message'))$('ai-message').textContent=error.message;}finally{apply.disabled=false;}};
    };drawCandidates();
   }catch(error){if(epoch===expected)$('ai-message').textContent=error.message;}
   finally{running=false;if(epoch===expected){lockSelection(false);button.disabled=false;$('ai-cancel').hidden=true;}}
  };
  dialog.onclose=()=>{if(!dialog.open&&epoch===expected)clear();};dialog.showModal();
 }
 return {open,clear,wait};
})();
