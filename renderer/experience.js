'use strict';
let interfacePreferences={theme:'system',detailRatio:0.4},resizeState=null;
const systemColor=window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){
 document.documentElement.dataset.theme=interfacePreferences.theme==='system'?(systemColor.matches?'dark':'light'):interfacePreferences.theme;
 $('login-theme').value=interfacePreferences.theme;
 if($('settings-theme'))$('settings-theme').value=interfacePreferences.theme;
}
async function setAppearance(input){
 const next=await api.preferences(input);interfacePreferences=next;applyTheme();applyPaneRatio();return next;
}
function applyPaneRatio(){
 const columns=document.querySelector('.archive-columns'),width=columns.clientWidth;
 if(!width)return;
 const max=Math.max(260,width-334),detail=Math.min(max,Math.max(260,width*interfacePreferences.detailRatio));
 $('detail-panel').style.width=detail+'px';
 $('pane-resizer').setAttribute('aria-valuenow',String(Math.round(detail/width*100)));
 $('pane-resizer').setAttribute('aria-valuemin','20');$('pane-resizer').setAttribute('aria-valuemax','70');
}
function initExperience(preferences){
 interfacePreferences={...interfacePreferences,...preferences};applyTheme();
 systemColor.addEventListener('change',applyTheme);
 $('login-theme').onchange=()=>attempt(()=>setAppearance({theme:$('login-theme').value}));
 const separator=$('pane-resizer');
 const finish=()=>{
  if(!resizeState)return;const pointerId=resizeState.pointerId;resizeState=null;document.body.classList.remove('resizing');
  if(separator.hasPointerCapture(pointerId))separator.releasePointerCapture(pointerId);
  attempt(()=>setAppearance({detailRatio:interfacePreferences.detailRatio}));
 };
 separator.onpointerdown=event=>{
  if(event.button!==0)return;event.preventDefault();resizeState={pointerId:event.pointerId};try{separator.setPointerCapture(event.pointerId);}catch{}document.body.classList.add('resizing');
 };
 window.addEventListener('pointermove',event=>{
  if(!resizeState||event.pointerId!==resizeState.pointerId)return;
  if(event.buttons===0){finish();return;}
  const bounds=document.querySelector('.archive-columns').getBoundingClientRect(),width=Math.max(260,Math.min(bounds.width-334,bounds.right-event.clientX));
  interfacePreferences.detailRatio=Math.max(0.2,Math.min(0.7,width/bounds.width));applyPaneRatio();
 },true);
 separator.onpointerup=finish;separator.onlostpointercapture=finish;separator.onpointercancel=finish;
 window.addEventListener('pointerup',finish,true);window.addEventListener('pointercancel',finish,true);window.addEventListener('mouseup',finish,true);window.addEventListener('blur',finish);
 separator.ondblclick=()=>attempt(()=>setAppearance({detailRatio:0.4}));
 separator.onkeydown=event=>{
  if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();
  const next=event.key==='Home'?0.4:Math.max(0.2,Math.min(0.7,interfacePreferences.detailRatio+(event.key==='ArrowLeft'?0.03:-0.03)));
  attempt(()=>setAppearance({detailRatio:next}));
 };
 new ResizeObserver(applyPaneRatio).observe(document.querySelector('.archive-columns'));
}
function addAppearanceSettings(settings){
 const block=document.createElement('div');block.className='appearance-settings';
 block.innerHTML=`<label class="form-label">外观主题<select id="settings-theme"><option value="light">白天</option><option value="dark">夜晚</option><option value="system">跟随系统</option></select></label><button class="text-button" id="reset-columns">恢复默认分栏宽度</button>`;
 $('idle-minutes').closest('label').before(block);$('settings-theme').value=settings.preferences.theme;
 $('settings-theme').onchange=()=>attempt(()=>setAppearance({theme:$('settings-theme').value}));
 $('reset-columns').onclick=()=>attempt(async()=>{await setAppearance({detailRatio:0.4});toast('分栏宽度已重置。');});
}
