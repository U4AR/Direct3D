(()=>{
 'use strict';
 if(window.top!==window.self||window.__draw3dTutorialLoaded)return;
 window.__draw3dTutorialLoaded=true;
 const namespace=window.DRAW3D_USER_NAMESPACE;
 if(!namespace)return;
 const stateKey='draw3d.tutorial.v1.'+namespace,voiceKey='draw3d.voice-choice.v1.'+namespace;
 const example='Make this a cylinder, 40 mm in diameter and 20 mm tall.';
 let step=0,dialog,previousFocus,micState=null,permissionState='prompt',closed=false;
 const cards=[
  {label:'Welcome',kicker:'Your first few minutes',title:'Design together, one step at a time.',description:'Draw3D is a human + AI CAD harness. Sketch, speak, or type the next design step. AI proposes and verifies geometry; you review it, change it, and keep developing the same model.',image:'model.webp',alt:'A blue revolved piston-like CAD part made from a drawn profile',caption:'Demo: a sketched profile becomes a revolved 3D part.',points:['Begin with a sketch or a small instruction. Add details through later steps.','Your Google account opens a private workspace.','You can reopen these cards anytime from Tutorial.']},
  {label:'Microphone',kicker:'Set up your input',title:'Speak while you sketch.',description:'Enable the microphone to describe your idea as you draw. Your browser will ask for access the first time. Typed instructions work too.',microphone:true,points:['Click Enable microphone, then choose Allow in the browser prompt.','Say a few words and check that the level meter moves.','Use headphones if your speakers are feeding sound back into the microphone.']},
  {label:'Draw a shape',kicker:'01 · Sketch',title:'Put the idea on a plane.',description:'Choose a drawing plane or a face, then sketch the outline of your part. Begin with one simple shape.',image:'sketch.webp',alt:'A green stepped profile drawn on a plane in the 3D workspace',caption:'Demo: the outline of a part before 3D generation.',points:['Use Planes or New plane to choose where to draw.','Double-click empty canvas to switch the pen on or off.','Pause after drawing to review the fitted sketch. Undo is always available.']},
  {label:'Describe it',kicker:'02 · Explain',title:'Tell Draw3D what you mean.',description:'Speak, or type the next change at the bottom: create a base, add a hole, move a feature, then refine an edge. Each step works with the current model and its history.',example:true,points:['Say whether you want a 2D sketch or a 3D part.','Use concrete dimensions such as “40 mm diameter”.','For a follow-up, describe one clear change at a time.']},
  {label:'Create 3D',kicker:'03 · Build',title:'Give the sketch depth.',description:'When the outline and instruction describe the part you want, choose Create 3D. Keep the workspace open while the model is built.',image:'model.webp',alt:'The completed blue piston-like model with visible dimensions',caption:'Demo: the same outline after the 3D part is created.',points:['Inspect the preview from more than one angle.','Use Keep step to accept the current draft. The same body stays editable for your next instruction.','If the result needs a change, describe it using the same instruction box.']},
  {label:'Refine & save',kicker:'04 · Make it yours',title:'Change the part, not the whole idea.',description:'Select the part or face you want to change. Then sketch or describe the next feature, such as a hole, a rounded edge, or a washer.',image:'edit.webp',alt:'A generated piston with additional circular washer components',caption:'Demo: more components are added to the original part.',points:['Use the Parts list to focus on the right object.','Double-click a face to select it; choose Draw on surface to add a sketch.','Use File to export your work. Undo and Redo let you revise earlier actions.'],controls:true},
  {label:'Try VR',kicker:'Optional · More room to create',title:'Step inside the workspace.',description:'On a supported headset, open this same website, sign in, and switch to VR. Enter VR from the workspace when you are ready.',image:'vr.webp',alt:'A VR view of colored CAD components and handwritten green sketches',caption:'Demo: hand-drawn instructions alongside native CAD geometry in VR.',points:['Allow the browser’s VR session prompt when you choose to enter.','With hand tracking, pinch index finger and thumb to draw.','Desktop and typed instructions remain available if you prefer.']}
 ];
 const $=selector=>document.querySelector(selector);
 function read(key){try{return localStorage.getItem(key);}catch{return null;}}
 function save(key,value){try{localStorage.setItem(key,value);}catch{}}
 function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
 function nativeMic(){return $('#mic');}
 function activeMic(){return nativeMic()?.getAttribute('aria-pressed')==='true';}
 function repairMessage(){return 'Microphone access is blocked. Open the site controls beside the address bar, set Microphone to Allow, then reload this page. You can also continue by typing.';}
 function updateMic(){
  const button=$('#tour-enable-mic'),message=$('#tour-mic-status'),help=$('#tour-permission-help'),meter=$('#tour-mic-level'),header=$('#draw3d-voice-setup');
  const active=activeMic(),observed=nativeMic()?.dataset.micState,phase=micState?.phase||(observed==='requesting'?'starting':observed);
  if(header){header.hidden=read(voiceKey)==='typed'&&!active;header.textContent=active?'Mic on':phase==='paused'?'Audio paused':phase==='captured'?'Mic allowed · starting…':permissionState==='granted'?'Start mic':'Enable mic';header.dataset.active=String(active);}
  if(!button||!message)return;
  const starting=['starting','captured'].includes(phase);button.disabled=starting;
  button.textContent=active?'Microphone on · Stop':phase==='paused'?'Resume audio':phase==='captured'?'Microphone allowed · starting…':starting?'Waiting for microphone…':permissionState==='granted'?'Start microphone':'Enable microphone';
  message.textContent=active?'Microphone is on. Pause audio in the workspace when you want a break.':phase==='paused'?'Audio is paused. You can keep modeling or typing, then resume when ready.':phase==='captured'?(micState.status||'Microphone access granted. Preparing voice detection…'):starting?'Choose Allow if your browser asks for microphone access.':permissionState==='denied'?'Microphone access is blocked.':phase==='error'?(micState.status||'The microphone could not start.'):permissionState==='granted'?'Microphone permission is granted. Start it when you want to speak.':'Microphone is off. It will start only when you enable it.';
  if(help){help.hidden=permissionState!=='denied'&&phase!=='error';help.textContent=permissionState==='denied'||/denied|permission|notallowed/i.test(micState?.status||'')?repairMessage():'Check that a microphone is connected and selected under Settings → Microphone & transcripts, then try again. You can keep using typed instructions.';}
  if(meter)meter.value=Math.max(0,Math.min(1,Number(micState?.level)||0));
 }
 function enableMic(){
  save(voiceKey,'voice');const mic=nativeMic();
  if(!mic){micState={phase:'error',status:'The workspace microphone control is not ready yet.'};updateMic();return;}
  if(activeMic()){mic.click();updateMic();return;}
  // Use the app's capture handler synchronously inside this real click gesture.
  // It owns the stream, audio context, device choice and reconnection preference.
  mic.click();updateMic();
  setTimeout(()=>{void refreshPermission();updateMic();},250);
 }
 async function refreshPermission(){try{const permission=await navigator.permissions?.query({name:'microphone'});if(permission){permissionState=permission.state;permission.onchange=()=>{permissionState=permission.state;updateMic();};}}catch{}updateMic();}
 function render(){
  const card=cards[step],content=dialog.querySelector('.tour-main');content.replaceChildren();
  content.append(node('p','tour-kicker',card.kicker),node('h2','',card.title),node('p','tour-description',card.description));content.querySelector('h2').id='tour-heading';
  if(card.image){const figure=node('figure'),img=node('img');img.src='/learn/assets/'+card.image;img.alt=card.alt;img.width=1200;img.height=606;figure.append(img,node('figcaption','',card.caption));content.append(figure);}
  if(card.microphone){
   const box=node('section','tour-mic-box');box.setAttribute('aria-label','Microphone setup');
   const message=node('p','tour-mic-status');message.id='tour-mic-status';message.setAttribute('role','status');
   const meter=node('meter','tour-level');meter.id='tour-mic-level';meter.min=0;meter.max=1;meter.value=0;meter.setAttribute('aria-label','Live microphone input level');
   const actions=node('div','tour-mic-actions'),enable=node('button','tour-primary','Enable microphone');enable.id='tour-enable-mic';enable.type='button';enable.onclick=enableMic;
   const typing=node('button','','I’ll type instead');typing.type='button';typing.onclick=()=>{save(voiceKey,'typed');go(step+1);};
   const help=node('p','tour-permission-help');help.id='tour-permission-help';help.hidden=true;
   actions.append(enable,typing);box.append(message,meter,actions,help,node('p','tour-note','Voice is optional. Camera access is not needed for drawing or typing.'));content.append(box);
  }
  if(card.example){const box=node('div','tour-example');box.append(node('p','',example));const copy=node('button','','Copy example instruction');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(example);copy.textContent='Copied';}catch{copy.textContent='Select and copy the example above';}};box.append(copy);content.append(box);}
  const list=node('ul');for(const point of card.points)list.append(node('li','',point));content.append(list);
  if(card.controls){const controls=node('dl','tour-controls');for(const [gesture,action]of [['Middle drag','Rotate'],['Ctrl + middle drag','Pan'],['Wheel / Shift + middle drag','Zoom']])controls.append(node('dt','',gesture),node('dd','',action));content.append(controls);}
  if(step===cards.length-1)content.append(node('p','tour-note','You’re ready. Start with one outline and one clear instruction. Tutorial is always here if you need it.'));
  dialog.querySelectorAll('nav button').forEach((button,index)=>{if(index===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
  dialog.querySelector('.tour-progress').textContent=`${step+1} of ${cards.length} · ${card.label}`;dialog.querySelector('.tour-back').disabled=step===0;dialog.querySelector('.tour-next').textContent=step===cards.length-1?'Start creating':'Next';
  dialog.querySelector('.tour-main').scrollTop=0;dialog.scrollTop=0;updateMic();
 }
 function go(index){step=Math.max(0,Math.min(cards.length-1,index));render();dialog.querySelector('#tour-heading').setAttribute('tabindex','-1');dialog.querySelector('#tour-heading').focus({preventScroll:true});}
 function close(completed=false){if(!dialog?.open)return;save(stateKey,completed?'completed':'skipped');closed=true;dialog.close();previousFocus?.focus?.();updateMic();}
 function show(index=0){
  if(!dialog){
   dialog=node('dialog');dialog.id='draw3d-tutorial';dialog.setAttribute('aria-labelledby','tour-heading');
   const top=node('div','tour-top');top.append(node('span','tour-brand','◇ DRAW3D · GETTING STARTED'));const skip=node('button','tour-close','Skip tour');skip.type='button';skip.setAttribute('aria-label','Close tutorial');skip.onclick=()=>close(false);top.append(skip);
   const layout=node('div','tour-layout'),nav=node('nav');nav.setAttribute('aria-label','Tutorial steps');cards.forEach((card,index)=>{const button=node('button');button.type='button';button.append(node('span','',String(index+1)),document.createTextNode(card.label));button.onclick=()=>go(index);nav.append(button);});
   layout.append(nav,node('section','tour-main'));
   const footer=node('div','tour-footer'),progress=node('output','tour-progress');progress.setAttribute('aria-live','polite');const buttons=node('div','tour-navigation'),back=node('button','tour-back','Back'),next=node('button','tour-primary tour-next','Next');back.type=next.type='button';back.onclick=()=>go(step-1);next.onclick=()=>step===cards.length-1?close(true):go(step+1);buttons.append(back,next);footer.append(progress,buttons);dialog.append(top,layout,footer);document.body.append(dialog);
   dialog.addEventListener('cancel',event=>{event.preventDefault();close(false);});
   dialog.addEventListener('keydown',event=>{if(event.target.closest('input,textarea,select'))return;if(event.key==='ArrowRight'&&step<cards.length-1){event.preventDefault();go(step+1);}if(event.key==='ArrowLeft'&&step>0){event.preventDefault();go(step-1);}});
  }
  previousFocus=document.activeElement;closed=false;step=index;render();dialog.showModal();dialog.querySelector('.tour-next').focus({preventScroll:true});
 }
 function install(){
  const link=node('link');link.rel='stylesheet';link.href='/learn/onboarding.css';document.head.append(link);
  const host=$('.header-actions')||$('header')||document.body;
  const help=node('button','','Tutorial');help.id='draw3d-help';help.type='button';help.title='Open the getting-started cards';help.onclick=()=>show();
  const voice=node('button','','Enable mic');voice.id='draw3d-voice-setup';voice.type='button';voice.onclick=()=>{show(1);};host.append(help,voice);
  window.addEventListener('draw3d-microphone-state',event=>{micState=event.detail;if(['captured','listening','no-signal'].includes(micState?.phase))permissionState='granted';updateMic();});
  const observer=new MutationObserver(()=>updateMic());if(nativeMic())observer.observe(nativeMic(),{attributes:true,attributeFilter:['aria-pressed','disabled','data-mic-state']});
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});void refreshPermission();
  if(read(stateKey))return;
  fetch('/learn/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.ok?r.json():{firstVisit:true}).then(data=>{if(data.firstVisit&&!closed)show();}).catch(()=>{if(!read(stateKey))show();});
 }
 function ready(){return !!nativeMic()?.onclick&&!document.body.hasAttribute('data-opening')&&(!document.body.classList.contains('desktop-studio')||document.body.dataset.desktopReady==='true');}
 function wait(){if(ready()){install();return;}let checks=0;const timer=setInterval(()=>{if(ready()){clearInterval(timer);install();}else if(++checks>=480)clearInterval(timer);},250);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wait,{once:true});else wait();
})();
