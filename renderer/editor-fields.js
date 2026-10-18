'use strict';
let dateTarget=null,calendar={year:2026,month:1,day:1,precision:'day'};
function options(items,value='',placeholder='请选择'){
 const all=value&&!items.includes(value)?[value,...items]:items;
 return `<option value="">${placeholder}</option>`+all.map(v=>`<option value="${escapeHtml(v)}" ${v===value?'selected':''}>${escapeHtml(v)}</option>`).join('');
}
function control(name,value='',attr=''){
 const escaped=escapeHtml(value),field=attr||`data-field="${escapeHtml(name)}"`;
 if(state.fields.dateFields.includes(name))return `<div class="date-input"><input ${field} readonly value="${escaped}" placeholder="点击选择日期" aria-label="${escapeHtml(name)}"><button type="button" class="date-open" aria-label="选择${escapeHtml(name)}">日历</button></div>`;
 if(name==='邮箱'){
  const at=value.lastIndexOf('@'),local=at<0?value:value.slice(0,at),domain=at<0?'':value.slice(at+1);
  return `<div class="email-input" data-email ${field}><input data-email-local value="${escapeHtml(local)}" placeholder="邮箱用户名" aria-label="邮箱用户名"><span>@</span><input data-email-domain list="choices-邮箱后缀" value="${escapeHtml(domain)}" placeholder="选择或输入域名" aria-label="邮箱后缀"></div>`;
 }
 if(state.fields.selects[name])return `<select ${field}>${options(state.fields.selects[name],value)}</select>`;
 if(state.fields.suggestions[name])return `<input ${field} list="choices-${escapeHtml(name)}" value="${escaped}" placeholder="选择或自行输入">`;
 if(state.fields.longFields.includes(name)||name==='备注')return `<textarea ${field} rows="3">${escaped}</textarea>`;
 return `<input ${field} value="${escaped}" ${/邮政编码/.test(name)?'inputmode="numeric"':/手机|电话/.test(name)?'type="tel"':''}>`;
}
function valueOf(input){
 if(input.matches('[data-email]')){
  const local=input.querySelector('[data-email-local]').value.trim(),domain=input.querySelector('[data-email-domain]').value.trim().replace(/^@/,'');
  return domain?local+'@'+domain:local;
 }
 return input.value;
}
function readEditorFields(){
 const result={...editor.hiddenFields};
 for(const input of $('standard-fields').querySelectorAll('[data-field]'))result[input.dataset.field]=valueOf(input);
 if(editor.category==='就学经历')result['就学阶段']=editor.stage;
 if(editor.category==='个人基本信息')result['证件资料']=JSON.stringify(readDocuments());
 if(editor.category==='家庭信息'){
  result['亲属信息']=JSON.stringify([...$('family-fields').querySelectorAll('.relative-card')].map(card=>Object.fromEntries([...card.querySelectorAll('[data-relative-field]')].map(input=>[input.dataset.relativeField,valueOf(input)]))).filter(row=>Object.values(row).some(Boolean)));
 }
 for(const row of $('custom-fields').querySelectorAll('.custom-row')){
  const key=row.querySelector('.custom-key').value.trim(),value=row.querySelector('.custom-value').value;
  if(!key&&!value)continue;
  if(!key)throw new Error('自定义字段名称不能为空。');
  if(Object.hasOwn(result,key)||(state.fields.categories[editor.category]||[]).includes(key))throw new Error('字段名称不能重复：'+key);
  result[key]=value;
 }
 return result;
}
function drawEditorFields(values){
 const category=editor.category,known=state.fields.categories[category],names=FormModel.names(category,editor.stage,state.fields).filter(n=>n!=='就学阶段'&&n!=='亲属信息'&&n!=='证件资料');
 editor.hiddenFields={};
 if(category==='就学经历')for(const [key,value]of Object.entries(values))if(known.includes(key)&&!names.includes(key)&&key!=='就学阶段')editor.hiddenFields[key]=value;
 $('standard-fields').innerHTML=names.map(name=>`<label class="${state.fields.longFields.includes(name)?'full-width':''}"><span>${escapeHtml(name)}</span>${control(name,values[name]||'')}</label>`).join('');
 $('custom-fields').replaceChildren();
 for(const [key,value]of Object.entries(values))if(!known.includes(key))addCustom(key,value);
 $('family-fields').replaceChildren();
 if(category==='家庭信息'){
  $('family-fields').innerHTML='<div class="custom-heading"><h3>亲属信息</h3><button id="add-relative" type="button" class="text-button">＋ 添加亲属</button></div><p class="form-hint">按需添加家庭成员；工作单位、职位和联系方式均可留空。</p><div id="relative-list"></div>';
  const relatives=FormModel.relatives(values['亲属信息']);
  if(relatives===null)throw new Error('旧亲属信息无法解析，请先保留原资料并检查内容。');
  for(const relative of relatives)addRelative(relative);
  $('add-relative').onclick=()=>{if($('relative-list').children.length>=100){toast('最多可添加 100 位亲属。',true);return;}addRelative();};
 }
 drawDocumentEditors(values);
 renderEditorContext();
}
function addCustom(key='',value=''){
 const div=document.createElement('div');div.className='custom-row';
 div.innerHTML=`<input class="custom-key" placeholder="字段名称" value="${escapeHtml(key)}"><input class="custom-value" placeholder="内容" value="${escapeHtml(value)}"><button type="button" class="icon-button remove-custom" aria-label="删除字段">×</button>`;
 $('custom-fields').append(div);
}
function addRelative(values={}){
 const div=document.createElement('section');div.className='relative-card';
 div.innerHTML=`<div class="relative-heading"><h4>亲属信息</h4><button type="button" class="text-button remove-relative">移除亲属</button></div><div class="fields-grid">${state.fields.relativeFields.map(name=>`<label><span>${escapeHtml(name)}</span>${name==='关系'?`<input data-relative-field="关系" list="choices-亲属关系" placeholder="选择或自行输入" value="${escapeHtml(values[name]||'')}">`:control(name,values[name]||'',`data-relative-field="${escapeHtml(name)}"`)}</label>`).join('')}</div>`;
 div.querySelector('.remove-relative').onclick=()=>div.remove();$('relative-list').append(div);
}
function stashEditor(){
 editor.drafts[editor.category]={values:readEditorFields(),title:$('record-title').value,stage:editor.stage};
}
function renderEditorContext(){
 const category=editor.category,fixed=state.fields.singletons.includes(category)||category==='就学经历';
 $('record-title').readOnly=fixed;
 $('record-title').placeholder=fixed?'由分类或就学阶段自动生成':'给这段经历起一个清晰的名称';
 $('record-title').required=category!=='就学经历';
 if(state.fields.singletons.includes(category))$('record-title').value=category;
 if(category==='就学经历')$('record-title').value=editor.stage||'请选择就学阶段';
 let html='';
 if(category==='就学经历')html=`<label class="stage-label">就学阶段 <span class="required">*</span><select id="education-stage" required>${options(Object.keys(state.fields.educationStages),editor.stage,'请先选择就学阶段')}</select></label><p class="form-hint">资料标题随阶段自动生成；同一阶段可记录不同学校的经历。</p>`;
 if(state.fields.singletons.includes(category))html=`<p class="form-hint fixed-notice">${escapeHtml(category)}仅保存一份，标题固定。${category==='家庭信息'?'亲属可在下方逐位添加。':''}</p>`;
 if(editor.conflict)html+='<div class="editor-notice">此分类已有一份档案。<button id="edit-existing-singleton" type="button" class="text-button">打开已有档案</button></div>';
 const hidden=Object.values(editor.hiddenFields||{}).filter(Boolean).length;
 if(hidden)html+=`<p class="form-hint">已保留 ${hidden} 项其他阶段的历史字段，切回对应阶段可继续编辑。</p>`;
 $('editor-context').innerHTML=html;$('save-record').disabled=!!editor.conflict;
 if($('education-stage'))$('education-stage').onchange=()=>{
  const stage=$('education-stage').value;
  try{const values=readEditorFields();editor.stage=stage;values['就学阶段']=stage;editor.values=values;drawEditorFields(values);}catch(error){$('education-stage').value=editor.stage;toast(error.message,true);}
 };
 if($('edit-existing-singleton'))$('edit-existing-singleton').onclick=()=>attempt(async()=>{
  const record=editor.conflict;
  if(await confirmModal('打开已有档案','当前未保存的编辑内容将被放弃，随后打开已有档案。','打开已有档案')){ $('editor-dialog').close();await openEditor(record);}
 });
}
async function switchEditorCategory(){
 const target=$('record-category').value;
 try{
  stashEditor();editor.category=target;
  const draft=editor.drafts[target]||{values:{},title:'',stage:''};
  editor.values=draft.values;editor.stage=draft.stage||'';$('record-title').value=draft.title;
  editor.conflict=editor.singletons.find(r=>r.category===target&&r.id!==editor.id)||null;
  drawEditorFields(editor.values);
 }catch(error){$('record-category').value=editor.category;throw error;}
}
async function openEditor(record=null){
 const snapshot=await api.snapshot(),singletons=snapshot.records.filter(r=>state.fields.singletons.includes(r.category));
 let category=record?.category||state.category||'个人基本信息';
 if(!record){
  const existing=singletons.find(r=>r.category===category);
  if(existing&&state.category)record=existing;
  else if(existing)category='其他资料';
 }
 editor={id:record?.id||null,category,stage:category==='就学经历'?FormModel.stageOf(record,state.fields):'',values:record?{...record.fields}:{},versions:record?{...record.versions}:{},activeVersion:'完整记录',drafts:{},singletons,conflict:null,hiddenFields:{}};
 // Preserve user-defined old education titles when adopting fixed stage titles.
 if(record&&category==='就学经历'&&record.title!==editor.stage&&!editor.values['原资料标题'])editor.values['原资料标题']=record.title;
 $('editor-title').textContent=record?'编辑资料':'新增资料';$('record-title').value=record?.title||'';
 $('record-category').value=category;
 $('record-tags').value=record?.tags.join('、')||'';$('record-notes').value=record?.notes||'';$('record-pinned').checked=!!record?.pinned;
 $('editor-message').textContent='保存后可添加照片或证明附件。';$('editor-message').classList.remove('error-inline');
 drawEditorFields(editor.values);drawDescriptions();showEditorTab('fields');$('editor-dialog').showModal();
 ($('education-stage')||$('standard-fields').querySelector('input,select,textarea')||$('record-title')).focus();
}
function bindStructuredFields(){
 const lists=document.createElement('div');lists.id='field-choices';
 lists.innerHTML=Object.entries(state.fields.suggestions).map(([name,values])=>`<datalist id="choices-${escapeHtml(name)}">${values.map(value=>`<option value="${escapeHtml(value)}"></option>`).join('')}</datalist>`).join('');document.body.append(lists);
 $('editor-fields').addEventListener('click',event=>{
  const input=event.target.closest('.date-input');if(input)openCalendar(input.querySelector('input'));
 });
 $('date-dialog').addEventListener('close',()=>{dateTarget=null;});
}
function openCalendar(input){
 dateTarget=input;
 const parts=input.value.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/),today=new Date();
 calendar={year:parts?+parts[1]:today.getFullYear(),month:parts?.[2]?+parts[2]:today.getMonth()+1,day:parts?.[3]?+parts[3]:today.getDate(),precision:parts?(parts[3]?'day':parts[2]?'month':'year'):'day'};
 drawCalendar();$('date-dialog').showModal();
}
function drawCalendar(){
 const year=calendar.year,month=calendar.month,days=new Date(year,month,0).getDate(),offset=(new Date(year,month-1,1).getDay()+6)%7;
 calendar.day=Math.min(calendar.day,days);
 const name=dateTarget.dataset.field||dateTarget.dataset.relativeField||dateTarget.dataset.documentField;
 const years=Array.from({length:Math.max(new Date().getFullYear()+100,year)-Math.min(1900,year)+1},(_,i)=>String(Math.min(1900,year)+i));
 $('date-content').innerHTML=`<div class="modal-header"><h3>选择${escapeHtml(name)}</h3><button id="date-close" type="button" class="icon-button" aria-label="关闭日历">×</button></div><div class="calendar-body"><div class="calendar-controls"><select id="date-year" aria-label="年份">${options(years,String(year)).replace('<option value="">请选择</option>','')}</select><select id="date-month" aria-label="月份">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${month===i+1?'selected':''}>${i+1} 月</option>`).join('')}</select><select id="date-precision" aria-label="日期精度"><option value="day" ${calendar.precision==='day'?'selected':''}>精确到日</option><option value="month" ${calendar.precision==='month'?'selected':''}>精确到月</option><option value="year" ${calendar.precision==='year'?'selected':''}>精确到年</option></select></div><div class="calendar-grid">${['一','二','三','四','五','六','日'].map(day=>`<span>${day}</span>`).join('')}${'<span></span>'.repeat(offset)}${Array.from({length:days},(_,i)=>`<button type="button" data-day="${i+1}" class="${calendar.day===i+1?'selected':''}">${i+1}</button>`).join('')}</div><p class="form-hint">${escapeHtml(dateTarget.value?'当前值：'+dateTarget.value:'可只记录年份或年月，无须补写具体日期。')}</p><div class="calendar-actions"><button type="button" class="text-button" id="date-clear">清空</button><button type="button" class="text-button" id="date-today">今天</button>${name==='结束时间'?'<button type="button" class="text-button" id="date-current">至今</button>':''}${['有效期','有效期截止'].includes(name)?'<button type="button" class="text-button" id="date-forever">长期有效</button>':''}<button type="button" id="date-confirm" class="btn primary">确定</button></div></div>`;
 $('date-close').onclick=()=>$('date-dialog').close();
 $('date-year').onchange=()=>{calendar.year=+$('date-year').value;drawCalendar();};
 $('date-month').onchange=()=>{calendar.month=+$('date-month').value;drawCalendar();};
 $('date-precision').onchange=()=>{calendar.precision=$('date-precision').value;};
 $('date-content').onclick=e=>{if(e.target.dataset.day){calendar.day=+e.target.dataset.day;calendar.precision='day';drawCalendar();}};
 const set=value=>{if(dateTarget?.isConnected){dateTarget.value=value;dateTarget.dispatchEvent(new Event('change',{bubbles:true}));}$('date-dialog').close();};
 $('date-clear').onclick=()=>set('');$('date-today').onclick=()=>{const d=new Date();set([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'));};
 if($('date-current'))$('date-current').onclick=()=>set('至今');if($('date-forever'))$('date-forever').onclick=()=>set('长期有效');
 $('date-confirm').onclick=()=>set(String(calendar.year)+(calendar.precision!=='year'?'-'+String(calendar.month).padStart(2,'0'):'')+(calendar.precision==='day'?'-'+String(calendar.day).padStart(2,'0'):''));
}


