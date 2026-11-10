import './part-workspace.css';
import {bodyManipulator} from './body-manipulator.js';
import {sketchAxisCorrection} from './part-placement.js';
import {initPartChat} from './part-chat.js';

const paths={
 parts:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
 cursor:'<path d="m5 3 14 10-7 1-3.5 6z"/>',pen:'<path d="m4 16 12-12 4 4L8 20H4zM14 6l4 4"/>',
 erase:'<path d="m4 14 10-11 7 7-10 11H9zM8 10l7 7M11 21h10"/>',
 undo:'<path d="m9 5-6 6 6 6M4 11h10a6 6 0 0 1 6 6"/>',redo:'<path d="m15 5 6 6-6 6m5-6H10a6 6 0 0 0-6 6"/>',
 mic:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-4 0h8"/>',
 check:'<path d="m5 12 4.5 4.5L19 7"/>',fit:'<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/>'
};
function icon(name){
 const el=document.createElementNS('http://www.w3.org/2000/svg','svg');
 for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))el.setAttribute(key,value);
 el.innerHTML=paths[name];return el;
}
function menu(label,id){
 const root=document.createElement('details');root.className='part-menu';if(id)root.id=id;
 const head=document.createElement('summary');head.textContent=label;
 const content=document.createElement('div');content.className='part-menu-content';root.append(head,content);
 return {root,head,content};
}
export function initPartWorkspace({studio,store,card}){
 const $=s=>document.querySelector(s),left=$('.left-panel'),right=$('.right-panel'),header=$('header'),toolbar=$('#desktop-cad-toolbar');
 document.body.classList.add('part-workspace');
 const toggle=document.createElement('button');toggle.id='part-browser-toggle';toggle.type='button';toggle.append(icon('parts'),'Parts');
 left.id='part-browser';toggle.setAttribute('aria-controls',left.id);
 function browserOpen(open){document.body.classList.toggle('part-browser-open',open);toggle.setAttribute('aria-expanded',String(open));studio.resize();}
 toggle.onclick=()=>browserOpen(!document.body.classList.contains('part-browser-open'));
 header.querySelector('.brand').after(toggle);browserOpen(innerWidth>=1050);
 // Keep the original controls and their event handlers, including native input focus.
 const files=menu('File','part-files'),settings=menu('Settings','part-settings');
 header.querySelector('.brand').href=location.href;
 $('.header-actions').append(files.root,settings.root);files.content.append($('#save-status'),$('#new-session'),$('#export'),$('#desktop-svg'),$('#decision-agent'));
 $('#decision-agent').textContent='Open CAD workspace';
 const narrow=matchMedia('(max-width:620px)'),modes=$('#workspace-modes');
 function placeModes(){if(narrow.matches)files.content.prepend(modes);else files.root.before(modes);}
 placeModes();narrow.addEventListener('change',placeModes);
 const library=document.createElement('div');library.className='part-library';
 const title=document.createElement('h2');title.textContent='Parts';const partList=document.createElement('div');partList.id='part-list';
 const features=menu('Features & history'),sketches=menu('Sketches'),planes=menu('Planes'),properties=menu('Dimensions & constraints');
 features.content.append($('#cad-model-history'));sketches.content.append($('#cad-sketch-library'));
 planes.content.append($('#cad-plane-editor'));properties.content.append($('#cad-properties'),$('#cad-sketch-constraints'));
 library.append(title,partList,sketches.root,planes.root,properties.root,features.root);left.prepend(library);
 const pose=document.createElement('form');pose.id='part-pose';pose.hidden=true;
 const heading=document.createElement('h3');heading.textContent='Move / rotate';pose.append(heading);
 const inputs={};
 for(const [key,label] of [['translation','Move (mm)'],['rotation','Rotate (°)']]){
  const field=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=label;field.append(legend);
  inputs[key]=['X','Y','Z'].map(axis=>{const l=document.createElement('label'),n=document.createElement('input');n.type='number';n.step='any';n.value='0';n.required=true;l.append(axis,n);field.append(l);return n;});
  pose.append(field);
 }
 const gizmo=bodyManipulator(studio,inputs,()=>place(false,true));
 const apply=document.createElement('button');apply.textContent='Apply';const align=document.createElement('button');align.type='button';align.textContent='Align to origin';
 const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>{pose.hidden=true;gizmo.clear();};
 pose.append(apply,align,close);library.insertBefore(pose,sketches.root);let bodyId;
 function editBody(id,numeric=false){
  if(!id||studio.desktopDrawing.working||studio.decisionLab?.busy||studio.aiDraftReview?.active)return;
  heading.textContent='Move / rotate';bodyId=id;if(numeric)browserOpen(true);pose.hidden=!numeric;gizmo.select(id);
  for(const input of Object.values(inputs).flat())input.value='0';
 }
 async function place(center,fromHandle=false){
  if(apply.disabled||!bodyId||studio.decisionLab?.busy||studio.aiDraftReview?.active)return;
  const movingId=bodyId,manipulator=studio.activePlacement;apply.disabled=align.disabled=true;
  const source=(store.session.desktopSolids||[]).find(s=>s.bodyId===bodyId);
  try{await studio.desktopDrawing.placeBody(bodyId,{center,translation:inputs.translation.map(i=>i.valueAsNumber),rotation:center?sketchAxisCorrection(studio.desktopDrawing.summary().filter(f=>source?.figureIds.includes(f.id))):inputs.rotation.map(i=>i.valueAsNumber)});
   if(fromHandle&&studio.activePlacement===manipulator&&manipulator?.object&&bodyId===movingId){gizmo.select(movingId);for(const field of Object.values(inputs).flat())field.value='0';}
   else{pose.hidden=true;gizmo.clear();}}
  catch(e){heading.textContent=e.message;}finally{apply.disabled=align.disabled=false;}
 }
 pose.onsubmit=e=>{e.preventDefault();void place(false);};align.onclick=()=>void place(true);
 const selection=studio.desktopSelectionChanged;studio.desktopSelectionChanged=s=>{selection?.(s);if(s?.nativeBodyId)editBody(s.nativeBodyId);};
 let lastParts;
 function renderParts(){
  const solids=store.session.desktopSolids||[],native=(studio.surfaceModels?.()||[]).filter(m=>!m.hidden&&!solids.some(s=>s.bodyId===m.nativeId||s.id===m.id)),locked=!!studio.aiDraftReview?.active||!!studio.decisionLab?.busy,signature=JSON.stringify([locked,solids.map(s=>[s.id,s.version,s.name,s.figureIds]),native.map(m=>[m.id,m.version,m.name])]);
  if(signature===lastParts)return;lastParts=signature;partList.replaceChildren();
  if(!solids.length&&!native.length){const empty=document.createElement('p');empty.textContent='No solid bodies';partList.append(empty);}
  for(const solid of solids){
   const b=document.createElement('button');b.type='button';b.append(icon('parts'),solid.name||'Body');b.title='Edit source dimensions';b.disabled=locked;b.dataset.partId=solid.id;
   b.onclick=()=>{editBody(solid.bodyId,true);const source=solid.figureIds?.find(id=>studio.desktopDrawing.summary().some(f=>f.id===id&&!f.hidden));if(source){properties.root.open=true;studio.desktopEditing.setMode('cad');studio.desktopDrawing.select(source);}};partList.append(b);
  }
  for(const model of native){
   const b=document.createElement('button');b.type='button';b.append(icon('parts'),model.name||'Body');b.title='Select this body for the next design step';b.disabled=locked;b.dataset.partId=model.id;
   b.onclick=()=>{studio.objects?.select(model.id);studio.nativeSelection?.setModel?.(model);$('#decision-instruction').focus();};partList.append(b);
  }
 }
 const tools=menu('Tools','part-tools'),construction=menu('Sketch geometry'),support=menu('Drawing support'),view=menu('View');
 const select=toolbar.querySelector('[data-tool="select"]');
 for(const [button,name,label] of [[select,'cursor','Select'],[$('#cad-pen'),'pen','Pen'],[$('#cad-eraser'),'erase','Eraser'],[$('#undo'),'undo','Undo'],[$('#redo'),'redo','Redo'],[$('#desktop-fit'),'fit','Fit view']]){
  button.setAttribute('aria-label',label);if(!button.title)button.title=label;
  button.replaceChildren(icon(name));button.classList.add('part-icon');
 }
 const primitives=[...toolbar.querySelectorAll('[data-tool]')].filter(b=>!['pen','erase','select'].includes(b.dataset.tool));
 construction.content.append(...primitives,$('#desktop-edit-layer'),$('#desktop-edit-target'),$('#desktop-eraser-size'),$('#cad-dimensions-toggle'));
 support.content.append($('#cad-plane-picker'),$('#desktop-selection-tools'),$('#cad-start-sketch'));
 view.content.append($('#desktop-flat'),$('#desktop-3d'),$('#desktop-native-editor'));
 tools.content.append(construction.root,support.root,view.root);
 toolbar.append(select,$('#cad-pen'),$('#cad-eraser'),$('#desktop-history-buttons'),$('#desktop-fit'),tools.root,$('#cad-finish-sketch'));
 const newPlane=document.createElement('button');newPlane.id='part-new-plane';newPlane.textContent='New plane';newPlane.onclick=()=>{
  browserOpen(true);planes.root.open=true;$('#cad-new-plane').open=true;$('#cad-plane-base').focus();$('#cad-new-plane').scrollIntoView({block:'nearest'});
 };
 toolbar.insertBefore(newPlane,tools.root);
 const options=menu('Preview settings'),voice=menu('Microphone & transcripts'),activity=menu('Activity'),feedback=menu('Feedback');
 for(const id of ['decision-auto','decision-auto-accept','decision-refine','decision-offset','decision-api-speed'])options.content.append($('#'+id).closest('label'));
 const diagnostics=[...card.querySelectorAll(':scope > details')];options.content.append(diagnostics[0]);
 activity.content.append($('#decision-status'),...diagnostics.slice(1));
 feedback.content.append($('#decision-note').closest('label'),$('#decision-incorrect'),$('#decision-export'));
 voice.content.append($('.speech-panel'));
 options.content.append($('#decision-fit'));
 const recording=document.createElement('a');
 recording.textContent='Open session recording';recording.href='/inspector.html?recording='+encodeURIComponent(store.session.id);
 recording.target='_blank';recording.rel='noopener';activity.content.append(recording);
 settings.content.append(options.root,voice.root,activity.root,feedback.root);
 const dock=document.createElement('div');dock.id='part-composer';dock.setAttribute('role','group');dock.setAttribute('aria-label','Part instructions');
 const mic=$('#mic'),micWrap=document.createElement('div');micWrap.className='part-mic';micWrap.append(mic,icon('mic'));
 const instruction=$('#decision-instruction');instruction.rows=1;instruction.placeholder='Sketch or describe the next design step…';instruction.setAttribute('aria-label','Next collaborative design step');
 const solidify=document.createElement('button');solidify.id='part-solidify';solidify.type='button';solidify.append(icon('check'),'Solidify');solidify.title='Keep this part and begin a new modeling step';solidify.disabled=true;
 const retryVoice=document.createElement('button');retryVoice.type='button';retryVoice.hidden=true;retryVoice.textContent='Retry voice';retryVoice.title='Retry the saved instruction';
 const create=document.createElement('button');create.id='part-create';create.type='button';create.textContent='Create 3D';
 const originOpt=document.createElement('label'),originInput=document.createElement('input');originInput.type='checkbox';originInput.checked=store.session.alignFirstBody===true;originInput.onchange=()=>{store.session.alignFirstBody=originInput.checked;void store.flush();};originOpt.append(originInput,' Center the first closed sketch on the origin');options.content.append(originOpt);
 const chat=initPartChat({studio,store,header:$('.header-actions')});
 const state=document.createElement('output');state.id='part-state';state.setAttribute('aria-live','polite');studio.container.append(state);
 const live=$('#decision-live-speech');dock.append(micWrap,...($('#mic-pause')?[$('#mic-pause')]:[]),instruction,retryVoice,create,solidify);studio.container.append(dock,live);
 // Transient preview controls are separate from the persistent part commit.
 right.hidden=true;renderParts();
 const menus=[files,settings,tools];
 document.addEventListener('pointerdown',e=>{for(const m of menus)if(m.root.open&&!m.root.contains(e.target))m.root.open=false;});
 document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;for(const m of menus)if(m.root.open){m.root.open=false;m.head.focus();}});
 const toast=document.createElement('output');toast.id='part-toast';toast.hidden=true;studio.container.append(toast);
 let timeout;
 return {solidify,create,state,chat,retryVoice,renderParts,announce(message){clearTimeout(timeout);toast.textContent=message;toast.hidden=false;timeout=setTimeout(()=>toast.hidden=true,2300);}};
}
