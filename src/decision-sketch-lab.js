import {alignInitialDrawing} from './part-placement.js';
import {collaborationStepPrompt,isSpokenDesignTranscript} from './cad-collaboration.js';
import {figureWorkCaseIds,isSketchContinuation,previousSketchWork,summarizeSketchWork} from './sketch-work-history.js';
import {initPartWorkspace} from './part-workspace.js';
import {speechStrokeContext,speechFigureIds} from './speech-stroke-context.js';
import {initConstructionProgress} from './decision-construction-progress.js';
import {captureSurfaceScene,rebaseSurfaceResult} from './image-surface-pick.js';
import {verifyDecisionFigure} from './decision-sketch/harness.js';
import {cacheDecisionDrafts,splitDecisionDrafts,combineDecisionDrafts,reuseNoiseDrafts} from './decision-draft-context.js';
import * as T from 'three';

import {Line2} from 'three/addons/lines/Line2.js';

import {LineGeometry} from 'three/addons/lines/LineGeometry.js';

import {LineMaterial} from 'three/addons/lines/LineMaterial.js';

import {localDesktopEvidence,applyDesktopEdit,assertDesktopCurrent} from './desktop-direct.js';

import {drawingView} from './sketch-projection.js';

import {archiveAppliedStrokes} from './stroke-archive.js';

import {blobToBase64} from './audio.js';

import {download} from './storage.js';



export async function initDecisionSketchLab({studio,store}){

 const $=s=>document.querySelector(s),card=document.createElement('section');card.id='decision-lab';

 card.innerHTML=`<h2>Sketch experiment</h2><p class="muted">Draw, then pause for a preview.</p><label><input id="decision-auto" type="checkbox" checked> Preview automatically</label><label><input id="decision-auto-accept" type="checkbox" checked> Accept after 2 seconds</label><label for="decision-instruction">Instructions</label><textarea id="decision-instruction" rows="2" placeholder="Optional: symmetric, rounded end…"></textarea><div class="two-buttons"><button id="decision-fit">Preview</button><button id="decision-accept" disabled>Accept</button></div><button id="decision-discard" disabled>Discard preview</button><small id="decision-live-speech" aria-live="polite"></small><p id="decision-status" role="status">Double-click the canvas to draw.</p><details><summary>Representation</summary><label>Geometry <select id="decision-kind"><option value="auto">Automatic</option>${['line','polyline','mixed','circle','ellipse','rectangle','arc','spline'].map(s=>`<option>${s}</option>`).join('')}</select></label><label>Symmetry <select id="decision-symmetry"><option value="auto">Automatic</option><option value="none">None</option><option value="one">One axis</option><option value="both">Two axes</option></select></label><label>Closure <select id="decision-closed"><option value="auto">Automatic</option><option value="true">Closed</option><option value="false">Open</option></select></label></details><details><summary>Decisions, measurements & cost</summary><pre id="decision-details"></pre></details><details><summary>Model input & output</summary><button id="decision-inspect">Load last request</button><div id="decision-input-images"></div><pre id="decision-wire"></pre></details><label>What needs correcting? <input id="decision-note" placeholder="Optional feedback for future tests"></label><div class="two-buttons"><button id="decision-incorrect">Mark incorrect</button><button id="decision-export">Export test cases</button></div><a id="decision-agent">Continue in CAD workspace ↗</a>`;

 $('.right-panel').prepend(card);$('#desktop-input').hidden=true;$('#agent-panel').hidden=true;card.prepend($('.speech-panel'));

 const preview=new T.Group();preview.name='Decision result preview';studio.scene.add(preview);

 const progress=initConstructionProgress(studio);
 const floating=document.createElement('aside');floating.id='decision-preview-controls';floating.hidden=true;floating.setAttribute('aria-label','Drawing preview');floating.innerHTML='<span role="status"></span><small id="decision-auto-accept-status"></small><button id="decision-hold" hidden>Keep preview</button><button id="decision-preview-accept">Accept</button><button id="decision-preview-discard" aria-label="Discard drawing preview">×</button>';studio.container.append(floating);

 const floatingStatus=floating.querySelector('span'),floatingAccept=floating.querySelector('#decision-preview-accept'),floatingDiscard=floating.querySelector('#decision-preview-discard');

 const placementPanel=document.createElement('aside');
 placementPanel.id='decision-plane-choice';
 placementPanel.hidden=true;
 placementPanel.setAttribute('aria-label','Sketch placement');
 placementPanel.innerHTML='<strong role="status"></strong><button type="button" data-plane="different">Use proposed placement</button><button type="button" data-plane="keep">Keep current plane</button>';
 studio.container.append(placementPanel);
 let placementRequest=null;
 function dismissPlacement(){
  placementRequest=null;
  placementPanel.hidden=true;
 }
 function proposedPlacement(result,strokes){
  const targets=[];
  for(const r of result.results){
   if(r.retainedDraft||result.refinement?.featurePlaneIds?.includes(r.frame?.id)||r.frame?.id===result.refinement?.bodyCut?.planeId||r.frame?.id&&r.frame.id===result.refinement?.wireframeBody?.derivedPlaneId)continue;
   for(const stroke of strokes.filter(s=>r.sourceStrokeIds.includes(s.id))){
    const support=stroke.drawingTarget?.captureOnly?studio.desktopPlane:stroke.plane;
    if(!support?.normal||!r.frame?.normal)continue;
    const frame=result.referencePlanes?.find(p=>p.id===r.frame.id)||r.frame;
    const dot=(a,b)=>a.reduce((n,v,k)=>n+v*b[k],0);
    const degrees=Math.acos(Math.min(1,Math.abs(dot(support.normal,frame.normal))))*180/Math.PI;
    const offset=1000*dot(support.normal,frame.origin.map((v,k)=>v-support.origin[k]));
    if(degrees>.1||Math.abs(offset)>.05||stroke.drawingTarget?.captureOnly){
     targets.push({id:stroke.id,supportId:support.id,offset,degrees,captureOnly:stroke.drawingTarget?.captureOnly});
    }
   }
  }
  return targets;
 }
 function confirmPlacement(targets){
  placementRequest=targets;
  const descriptions=[...new Set(targets.map(p=>{
   const distance=Number(p.offset.toFixed(1)),angle=Number(p.degrees.toFixed(1));
   const base=store.session.desktopPlanes.find(x=>x.id===p.supportId)?.name||'drawing plane';
   return distance+' mm from '+base+' · '+(angle?angle+'° tilt':'parallel (0°)');
  }))];
  placementPanel.querySelector('strong').textContent=(descriptions.length===1?'Use the proposed plane?':'Use these proposed planes?')+' Estimated '+descriptions.join(' / ');
  placementPanel.querySelector('[data-plane="different"]').textContent='Use proposed placement';
  placementPanel.querySelector('[data-plane="keep"]').disabled=targets.some(x=>x.captureOnly);
  placementPanel.hidden=false;
  store.log('decision.plane.proposed',{targets});
  sync();
 }
 placementPanel.onclick=event=>{
  const choice=event.target.closest('button')?.dataset.plane;
  if(!choice||!placementRequest||busy||applying)return;
  const targets=placementRequest;
  dismissPlacement();
  store.log('decision.plane.chosen',{targets,choice});
  if(choice==='different'){sync();void acceptPending();return;}
  for(const target of targets){
   const stroke=store.session.strokes.find(s=>s.id===target.id);
   if(stroke)stroke.drawingTarget={...stroke.drawingTarget,placementChoice:'keep',placementSupportId:target.supportId};
  }
  cachedDrafts=cachedDrafts.filter(c=>!c.sources.some(s=>targets.some(t=>t.id===s.id)));
  void store.flush();queue({force:true,delay:0});
 };

 const intentLabel=document.createElement('label');intentLabel.innerHTML='Interpretation <select id="decision-intent"><option value="auto">Understand the figure</option><option value="measured">Trace measured features</option></select>';card.querySelector('#decision-kind').closest('details').prepend(intentLabel);

 const refineLabel=document.createElement('label');refineLabel.innerHTML='<input id="decision-refine" type="checkbox"> Follow instructions with AI';card.querySelector('#decision-auto').closest('label').after(refineLabel);
 const speedLabel=document.createElement('label');
 speedLabel.innerHTML='CAD API speed <select id="decision-api-speed"><option value="default">Standard</option><option value="priority">Fast · higher cost</option><option value="ultrafast">Ultrafast · Sol 6.1 · higher cost</option></select>';
 refineLabel.after(speedLabel);
 const speed=speedLabel.querySelector('select');
 speed.value=localStorage.getItem('draw3d.cad.apiSpeed')||'default';
 if(!speed.value)speed.value='default';
 speed.onchange=()=>localStorage.setItem('draw3d.cad.apiSpeed',speed.value);
 const offsetLabel=document.createElement('label');
 offsetLabel.innerHTML='<input id="decision-offset" type="checkbox"> Detect offset planes';
 refineLabel.after(offsetLabel);
 const offsetToggle=offsetLabel.querySelector('input');offsetToggle.checked=store.session.detectOffsetPlanes!==false;
 offsetToggle.onchange=()=>{store.session.detectOffsetPlanes=offsetToggle.checked;void store.flush();queue();};
 $('#decision-refine').checked=new URL(location.href).searchParams.get('refine')!=='off'&&store.session.decisionRefine!==false;
 $('#decision-symmetry').value=store.session.sketchSymmetry||'auto';
 const status=$('#decision-status'),details=$('#decision-details'),accept=$('#decision-accept'),discard=$('#decision-discard');

 let buildPressed=false,pendingChatText='',userBuildInstruction='';
 function publishTypedInput(){
  if(!pendingChatText)return;
  store.log('decision.instruction.received',{source:'typed',text:pendingChatText});
  pendingChatText='';
 }
 let nativePreview=null,nativeDraftOwned=false,replacingDraft=false;
 let autoAcceptTimer=null,autoAcceptDeadline=0,pausedGeneration=-1,speechPending=false,instructionSource='typed';
 let lastInvalidation='initial',busy=false,applying=false,generation=0,timer,pending=null,evidence=null,lastKey='',voiceText='',queued=false,refinementAbort=null,lastDrawingImage=null,lastDrawingView=null,lastSurfaceScene=null;

 const speechTurns=[],seenAudio=new Set(),resolvingSpeech=new Set(),recentInk=new Map();
 let speaking=false,speechCapture=null,instructionCapture=null,discardedTurn=null;
 function updateSpeechPending(){speechPending=speaking||resolvingSpeech.size>0;}
 function speechPath(points=[]){
  const count=Math.min(64,points.length);
  return Array.from({length:count},(_,i)=>points[Math.round(i*(points.length-1)/Math.max(1,count-1))]);
 }
 function rememberInk(stroke){
  if(!stroke)return;
  const {id,started,ended,desktopSketchId}=stroke;
  recentInk.set(id,{id,started,ended,desktopSketchId,points:speechPath(stroke.points)});
  if(recentInk.size>64)recentInk.delete(recentInk.keys().next().value);
 }
 let emptySpeechCount=0;
 let runningInstruction='',typedBase='',lastModelRequest=null,settledInstruction=false,failedRequest=false;
 let activeTurn=null,speechDelivery=Promise.resolve(),speechStatusBefore='',speechStatusDuring='';
 function advanceTurn(settled=false){
  userBuildInstruction='';
  settledInstruction=settled;
  if(activeTurn&&instructionSource==='speech'){voiceText='';store.session.decisionInstruction='';}
  activeTurn=null;typedBase='';instructionCapture=null;
  if(speechTurns.length)startTurn(speechTurns.shift());
 }
 // A verified body can still be under review while the user starts the next
 // feature. Keep its review transaction and geometry, retire its completed verb.
 function beginIndependentInput({keepField=false}={}){
  if(busy||applying)return false;
  if(!failedRequest&&!settledInstruction&&(!pending||nativePreview?.id!==pending.id&&pending.refinement?.state!=='failed'))return false;
  failedRequest=false;
  settledInstruction=false;
  activeTurn=null;voiceText='';typedBase='';instructionCapture=null;
  store.session.decisionInstruction='';
  if(!keepField)$('#decision-instruction').value='';
  store.log('decision.instruction.boundary',{previousFitId:pending?.id,previousState:pending?.refinement?.state||'finished'});
  return true;
 }
 function startTurn(turn){
  activeTurn=turn;
  receiveInstruction(turn.words,turn.source||'speech',turn.id,turn.capture);
 }
 function resumeDrawing(){
  if(busy||applying){sync();return;}
  if(speechStatusBefore&&status.textContent===speechStatusDuring)status.textContent=speechStatusBefore;
  if(pending){armAutoAccept();sync();}
  else if(queued){clearTimeout(timer);timer=setTimeout(()=>void fit(),0);}

  else sync();
 }
 function enqueueSpeech(words,id,binding,capture){
  updateSpeechPending();
  if(!words?.trim()){resumeDrawing();return;}
  const input={...binding,text:words};
  const existing=store.session.transcripts.find(t=>t.id===id);
  if(existing)Object.assign(existing,input);
  else{store.session.transcripts.push({id,source:'speech',...input});const line=document.createElement('p');line.textContent=words;document.querySelector('#transcripts')?.append(line);}
  store.log('decision.speech.bound',input);void store.flush();
  const turn={words,id,inputs:[input],capture};
  if(applying){speechTurns.push(turn);store.log('decision.instruction.queued',{audioId:id,reason:'committing geometry'});return;}
  const completed=beginIndependentInput();
  const currentInk=new Set(store.session.strokes.filter(s=>!s.hidden).map(s=>s.id));
  const correction=/^(?:no[, ]|(?:i|we) (?:meant|mean)\b|actually\b|correction\b)/i.test(words);
  const resume=correction&&discardedTurn?.strokeIds.some(id=>currentInk.has(id))?discardedTurn:null;
  discardedTurn=null;
  const previous=(completed?'':unfinishedInstruction())||resume?.words;
  if(previous&&!pending?.refinement?.question){
   const combined=previous.split('\nUpdate: ').at(-1)===words?previous:joinInstruction(previous,words);
   if(combined.length<=4000){
    store.log('decision.instruction.steered',{audioId:id,previous,update:words});
    startTurn({id,words:combined,capture,inputs:[...(activeTurn?.inputs||resume?.inputs||[]),input]});status.textContent='Updating the plan with your instruction…';return;
   }
  }
  if(activeTurn){speechTurns.push(turn);store.log('decision.instruction.queued',{audioId:id,after:activeTurn.id});}
  else startTurn(turn);
 }
 function unfinishedInstruction(){
  if(failedRequest||settledInstruction||nativePreview&&nativePreview.id===pending?.id||pending?.refinement?.state==='failed')return '';
  if(busy)return instructionSource==='typed'&&typedBase?text():activeTurn?.words||runningInstruction;
  if(pending||queued)return activeTurn?.words||text();
  return activeTurn?.words||'';
 }
 function joinInstruction(prior,update){
  if(!prior||update.startsWith(prior))return update;
  return prior+'\nUpdate: '+update;
 }
 function listen(statusText){
  if(!speechPending)speechStatusBefore=status.textContent;
  speechStatusDuring=statusText;speechPending=true;clearTimeout(timer);
  stopAutoAccept();if(!busy&&!applying)status.textContent=statusText;sync();
 }
 // Bound provider concurrency while delivering commands in capture order.
 const waitingTranscripts=[],speechDecisions=new Map();
 let activeTranscripts=0;
 function pumpTranscripts(){
  while(activeTranscripts<2&&waitingTranscripts.length){
   activeTranscripts++;const job=waitingTranscripts.shift();
   Promise.resolve().then(job.read).then(words=>job.done({words}),error=>job.done({error}))
    .finally(()=>{activeTranscripts--;pumpTranscripts();});
  }
 }
 let failedSpeech=null;
 function captureSpeech(detail,getWords){
  const id=detail.id;
  if(id&&seenAudio.has(id))return;
  if(id)seenAudio.add(id);
  const archived=new Set((store.session.strokeArchiveCatalog||[]).slice(-64).flatMap(a=>a.strokeIds));
  const ink=new Map([...recentInk].filter(([id])=>archived.has(id)));
  for(const s of store.session.strokes)ink.set(s.id,s);
  const capture=speechCapture||captureViewport();
  const binding=speechStrokeContext(detail,[...ink.values()],capture.view,store.elapsed());
  if(detail.name)binding.audioRef=detail.name;
  if(!binding.strokeIds.length&&capture.selectedFigureId)binding.selectedFigureId=capture.selectedFigureId;
  binding.guides=binding.strokeIds.map(id=>({id,points:speechPath(ink.get(id)?.points)})).filter(g=>g.points.length>1);
  speechCapture=null;
  processSpeech(id,getWords,binding,capture);
 }
 function processSpeech(id,getWords,binding,capture){
  resolvingSpeech.add(id);updateSpeechPending();
  const capturedAt=performance.now();
  const transcript=new Promise(done=>waitingTranscripts.push({read:async()=>{
   const start=performance.now(),words=await getWords(binding);
   store.log('decision.speech.transcribed',{audioId:id,text:words,queueMs:Math.round(start-capturedAt),transcriptionMs:Math.round(performance.now()-start)});
   return words;
  },done}));
  pumpTranscripts();
  speechDelivery=speechDelivery.then(async()=>{
   let transcribed;
   try{
    const ready=await transcript;if(ready.error)throw ready.error;
    const words=ready.words?.trim();transcribed=words;
    if(!words){
     emptySpeechCount++;
     if(emptySpeechCount===3){
      const line=document.createElement('p');line.className='transcript-placeholder';
      line.textContent='Audio is arriving, but speech could not be understood. Check the Microphone input selector.';
      document.querySelector('#transcripts')?.append(line);
     }
     return;
    }
    emptySpeechCount=0;
    if(studio.modelAgent.waitingForAnswer){await collaborativeStep(words);return;}
    if(!activeTurn&&!pending&&!busy&&!applying)status.textContent='Heard “'+words+'” · checking instruction…';
    const decision=speechDecisions.get(id)||await studio.decisionRequest('speech-decision',{
     text:words,currentInstruction:activeTurn?.words||text(),question:pending?.refinement?.question,
     hasSketch:store.session.strokes.some(s=>!s.hidden)||!!studio.desktopDrawing.summary().length
    });
    speechDecisions.delete(id);
    store.log('decision.speech.classified',{audioId:id,text:words,...decision});
    if(decision.choice==='unrelated'){
     if(!activeTurn&&!busy&&!applying&&!pending)status.textContent='Background speech ignored.';
     if(!busy&&!applying)resumeDrawing();
     return;
    }
    enqueueSpeech(words,id,binding,capture);
   }
   catch(e){
    store.log('decision.speech.failed',{audioId:id,message:e.message});
    failedSpeech={id,getWords:transcribed?()=>transcribed:getWords,binding,capture};
    partUI.retryVoice.hidden=false;
    status.textContent='Voice input failed: '+e.message+' · recording available to retry.';
   }
   finally{resolvingSpeech.delete(id);updateSpeechPending();if(!speechPending)resumeDrawing();}
  });
 }
 const cases=store.session.decisionCases||=[];let cachedDrafts=[],cachedPrompt='';const lastCase=[...cases].reverse().find(c=>c.asset);if(lastCase&&!['discarded','incorrect'].includes(lastCase.feedback?.at(-1)?.verdict)){try{const saved=await store.get('assets',[store.session.id,lastCase.asset]),record=saved?JSON.parse(await saved.blob.text()):null;if(record?.result){cachedDrafts=cacheDecisionDrafts(record.result,record.sourceStrokes||record.data.strokes);cachedPrompt=record.data.prompt||'';}}catch{}}

 $('#decision-auto-accept').checked=store.session.decisionAutoAccept!==false;$('#decision-instruction').value=store.session.decisionInstruction||'';
 const text=()=>settledInstruction?'':instructionSource==='speech'?voiceText:joinInstruction(typedBase,$('#decision-instruction').value.trim());

 const storedView=store.session.decisionDrawingView;if(storedView?.asset){try{const saved=await store.get('assets',[store.session.id,storedView.asset]);if(saved){lastDrawingImage='data:'+saved.blob.type+';base64,'+await blobToBase64(saved.blob);lastDrawingView=storedView.view;if(storedView.surfaceAsset){const geometry=await store.get('assets',[store.session.id,storedView.surfaceAsset]);if(geometry)lastSurfaceScene=JSON.parse(await geometry.blob.text());}}}catch{}}
 function stopAutoAccept({pause=false}={}){clearTimeout(autoAcceptTimer);autoAcceptTimer=null;autoAcceptDeadline=0;if(pause)pausedGeneration=generation;$('#decision-auto-accept-status').textContent=pause&&pending?'Auto-accept paused':'';$('#decision-hold').hidden=true;}
 function armAutoAccept(){
  stopAutoAccept();if(placementRequest||!$('#decision-auto-accept').checked||pausedGeneration===generation||!pending||busy||applying||pending.refinement?.question||pending.refinement?.state==='failed'||pending.reusedAfterNoise||speechPending||document.hidden)return;
  const result=pending,token=generation;autoAcceptDeadline=performance.now()+2000;$('#decision-hold').hidden=false;
  const tick=()=>{if(pending!==result||generation!==token||busy||applying||studio.active?.size||speechPending||document.hidden){stopAutoAccept();return;}const left=autoAcceptDeadline-performance.now();$('#decision-auto-accept-status').textContent='Accepting in '+Math.max(1,Math.ceil(left/1000))+'s';if(left<=0){stopAutoAccept();store.log('decision.auto-accept',{id:result.id,delayMs:2000});void acceptPending();}else autoAcceptTimer=setTimeout(tick,Math.min(200,left));};tick();
 }
 $('#decision-auto-accept').onchange=()=>{store.session.decisionAutoAccept=$('#decision-auto-accept').checked;void store.flush();pausedGeneration=-1;armAutoAccept();};
 $('#decision-hold').onclick=()=>stopAutoAccept({pause:true});
 card.addEventListener('pointerdown',e=>{if(e.target.closest('details')&&e.target.id!=='decision-fit')stopAutoAccept({pause:true});},true);
 studio.renderer.domElement.addEventListener('pointerdown',()=>stopAutoAccept({pause:true}),true);
 document.addEventListener('focusin',e=>{if(e.target.closest('#cad-properties,#cad-plane-editor,#cad-sketch-constraints'))stopAutoAccept({pause:true});});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAutoAccept();else armAutoAccept();});
 let partUI,buildingPart=null,finishWhenReady=null;
 window.addEventListener('message',event=>{
  const frame=document.querySelector('#full-cad-workspace iframe');
  if(event.origin!==location.origin||!frame||event.source!==frame.contentWindow||
    event.data?.channel!=='draw3d.cad')return;
  if(event.data.type==='server-recovery'){
   const reason='Building editable geometry on the server';
   store.log('cad.server-recovery',{reason:'Browser CAD compilation ran out of memory'});
   if(busy){progress.step(reason);if(buildingPart)receipt({id:buildingPart.id},'building',{reason});}
   return;
  }
  if(event.data.type!=='memory-recovery')return;
  const {projectId,version,phase,diagnostic,retrying=true}=event.data.data;
  store.log('cad.memory-recovery',{projectId,version,phase,retrying,diagnostic});
  if(busy){
   const state=diagnostic?.kernelState==='failed'?'CAD engine initialization':phase;
   const reason=(retrying?'Restarting CAD after memory exhaustion during ':'CAD memory exhausted again during ')+state;
   const detail=diagnostic?' ('+diagnostic.operation+', '+diagnostic.bodyCount+' bodies, '+diagnostic.featureCount+' features'+(diagnostic.allocatedWasmBytes!=null?', last measured WASM heap '+Math.round(diagnostic.allocatedWasmBytes/1048576)+' MiB':'')+')':'';
   progress.step(reason);
   if(buildingPart)receipt({id:buildingPart.id},'building',{reason:reason+detail});
  }
 });
 function recoveredPart(){
  const draft=studio.aiDraftReview;
  return !nativeDraftOwned&&!pending&&!busy&&draft.active&&draft.hasChanges&&!draft.busy&&!draft.recovering&&
   draft.runIds.some(id=>id.startsWith('local-decision-'))&&store.session.desktopSolids?.length;
 }
 function bodySignature(){
  return JSON.stringify((store.session.desktopSolids||[]).map(s=>[s.id,s.version,...(s.parameters?.profiles||[]).map(p=>p.expectedVersion)]));
 }
 function savedPartReady(){
  return !pending&&!queued&&!studio.aiDraftReview.active&&(store.session.desktopSolids||[]).length>0&&
   !store.session.strokes.some(s=>!s.hidden)&&bodySignature()!==store.session.decisionPartStep?.signature;
 }
 function sync(){
  const blocked=!!placementRequest||busy||applying||speechPending;
  const reviewing=!!pending&&!pending.refinement?.question&&pending.refinement?.state!=='failed';
  const bodyReady=reviewing&&!!nativePreview&&nativePreview.id===pending.id;
  const problem=/^(Could not|Voice input failed|AI refinement failed|Part save failed)/.test(status.textContent);
  floating.hidden=!!placementRequest||!busy&&!pending&&!queued&&!problem;
  floatingStatus.textContent=pending&&status.textContent.startsWith('Preview ready')?(bodyReady?'Part preview':'Sketch preview'):status.textContent;
  accept.disabled=blocked||!reviewing;floatingAccept.disabled=accept.disabled;
  floatingAccept.hidden=bodyReady||!reviewing;floatingDiscard.disabled=busy||applying||!pending;floatingDiscard.hidden=!pending;
  if(partUI){
   const building=busy&&buildingPart?.token===generation;
   const requested=building&&finishWhenReady===buildingPart;
   const hasBody=(store.session.desktopSolids||[]).length>0||studio.surfaceModels?.().some(m=>!m.hidden);
   partUI.state.textContent=problem?'Could not finish · see Chat':placementRequest?'Choose a sketch plane':applying?'Applying geometry':busy?(building||buildPressed||runningInstruction?.startsWith('Create or modify the editable')?'Building 3D':'Preparing sketch'):speechPending?'Listening to instruction':bodyReady?'3D preview':pending?'Reviewing sketch':hasBody?'Editing part':studio.desktopDrawing.summary().length?'Sketch ready · request 3D or press Create 3D':'Sketch mode';
   partUI.state.title=status.textContent;
   partUI.create.textContent=hasBody?'Apply next step':'Create 3D';
   partUI.create.disabled=busy||applying||speechPending||!!placementRequest||!(pending||text()||hasBody||studio.desktopDrawing.summary().some(f=>!f.hidden)||store.session.strokes.some(s=>!s.hidden));
   partUI.solidify.disabled=!!placementRequest||applying||speechPending||requested||!(building||!busy&&(bodyReady||recoveredPart()||savedPartReady()||studio.aiDraftReview.active&&studio.aiDraftReview.hasChanges&&!studio.aiDraftReview.busy));
   partUI.solidify.hidden=partUI.solidify.disabled;
   partUI.solidify.lastChild.textContent=requested?'Saving…':'Keep step';
   partUI.renderParts();
  }
 }
 async function finishPartStep(){
  store.session.decisionPartStep={signature:bodySignature(),sketchIds:studio.desktopSketches.catalog().map(s=>s.id),
   solidIds:store.session.desktopSolids.map(s=>s.id),at:Date.now()};
  studio.desktopSketches.beginStep();studio.desktopSelection.clear();
  studio.desktopDrawing.select(null,false);studio.desktopEditing.clearTarget();
  cachedDrafts=[];cachedPrompt='';lastKey='';voiceText='';typedBase='';
  $('#decision-instruction').value='';$('#decision-live-speech').textContent='';
  store.session.decisionInstruction='';delete store.session.lastDesktopErase;
  store.log('decision.part.solidified',{solidIds:store.session.decisionPartStep.solidIds});
  await store.flush();await studio.desktopHistory.capture('Solidify part');
  status.textContent='Part saved';partUI.announce('Part saved');studio.onChange();
 }
 async function solidify(){
  if(partUI.solidify.disabled)return;
  if(studio.aiDraftReview.active&&studio.aiDraftReview.hasChanges&&!studio.aiDraftReview.busy&&!nativeDraftOwned){await studio.aiDraftReview.accept();await studio.desktopHistory.capture('Keep collaborative design step');partUI.announce('Step kept · the model remains editable');sync();return;}
  if(busy&&buildingPart?.token===generation){finishWhenReady=buildingPart;sync();return;}
  if(recoveredPart()){
   applying=true;sync();
   try{if(await studio.aiDraftReview.accept()){await finishPartStep();advanceTurn();}}
   catch(error){status.textContent='Part save failed: '+error.message;}
   finally{applying=false;sync();if(queued&&!speechPending){clearTimeout(timer);timer=setTimeout(()=>void fit(),0);}}
   return;
  }
  if(nativePreview&&pending){await acceptPending({finishPart:true});return;}
  if(!savedPartReady())return;
  applying=true;sync();
  try{await finishPartStep();advanceTurn();}
  catch(error){status.textContent='Part save failed: '+error.message;}
  finally{applying=false;sync();if(queued&&!speechPending){clearTimeout(timer);timer=setTimeout(()=>void fit(),0);}}
 }


 const observer=new MutationObserver(sync);observer.observe(status,{childList:true});

 function clear(){dismissPlacement();stopAutoAccept();if(nativeDraftOwned)delete document.body.dataset.decisionNativePreview;for(const o of [...preview.children]){o.geometry.dispose();o.material.dispose();preview.remove(o);}pending=null;studio.desktopPreviewStrokeIds=null;studio.strokeWorkflow.sync(true);accept.disabled=discard.disabled=true;sync();}

 function drawFit(result){studio.desktopPreviewStrokeIds=new Set(result.results.flatMap(r=>r.sourceStrokeIds));for(const r of result.results){const material=new LineMaterial({color:r.retainedDraft?0x8495a8:0x70f2c6,linewidth:r.retainedDraft?2:3,depthTest:false,depthWrite:false,transparent:true,opacity:1});material.resolution.copy(studio.renderer.getSize(new T.Vector2()));const line=new Line2(new LineGeometry().setPositions(r.pathWorld.flat()),material);line.renderOrder=1000;preview.add(line);}studio.strokeWorkflow.sync(true);studio.onChange();}
 function render(result){clear();pending=result;if(nativeDraftOwned)document.body.dataset.decisionNativePreview='true';if(!nativePreview)drawFit(result);accept.disabled=!!result.refinement?.question||result.refinement?.state==='failed';discard.disabled=false;sync();studio.onChange();}

 const resize=new ResizeObserver(()=>{const size=studio.renderer.getSize(new T.Vector2());for(const line of preview.children)line.material.resolution?.copy(size);});resize.observe(studio.container);

 function queue({force=false,delay=800,reason='drawing or settings updated'}={}){lastInvalidation=reason;if(!busy)progress.stop();dismissPlacement();refinementAbort?.abort();generation++;clearTimeout(timer);if(pending)clear();queued=force||$('#decision-auto').checked;if(queued){status.textContent='Drawing saved · preparing interpretation…';timer=setTimeout(()=>void fit(),delay);}sync();}

 const receipt=(result,state,extra={})=>{if(!result?.id)return;store.log('decision.preview.'+state,{id:result.id,...extra});void studio.decisionRequest('decision-preview',{id:result.id,state,...extra}).catch(()=>{});};

 async function saveCase(verdict,result=pending,note=$('#decision-note').value){if(!result)return;const entry=cases.find(c=>c.id===result.id);if(entry){entry.feedback??=[];entry.feedback.push({verdict,note,at:Date.now()});}if(['discarded','incorrect'].includes(verdict))cachedDrafts=[];store.log('decision.feedback',{id:result.id,verdict,note});await store.flush();try{await studio.decisionRequest('decision-feedback',{id:result.id,verdict,note});}catch(e){store.log('decision.feedback.unsynced',{id:result.id,verdict,message:e.message});}}

 function captureViewport(previous){
  const view=drawingView(studio),models=studio.surfaceModels?.()||[];
  const selectedFigureId=studio.desktopDrawing?.selectedId;
  const key=JSON.stringify([selectedFigureId,view.cameraToWorld,view.projectionMatrix,view.viewportSize,models.map(m=>[m.id,m.version,m.geometryVersion,m.hidden]),store.session.desktopFigures?.map(f=>[f.id,f.version,f.hidden])]);
  if(previous?.key===key)return previous;
  return {view,image:image(),surfaceScene:captureSurfaceScene(models),selectedFigureId,key};
 }
 function image(){studio.renderer.render(studio.scene,studio.camera);const canvas=document.createElement('canvas'),source=studio.renderer.domElement;canvas.width=768;canvas.height=Math.max(1,Math.round(source.height/source.width*768));canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.78);}

 function hideNoise(result){const ids=new Set((result.ignoredGroups||[]).flatMap(g=>g.sourceStrokeIds));let changed=false;for(const stroke of store.session.strokes)if(ids.has(stroke.id)&&!stroke.hidden){stroke.hidden=true;stroke.rejectedAsNoise={requestId:result.id,at:Date.now()};changed=true;}if(changed){store.session.revision++;studio.strokeWorkflow.sync(true);store.log('decision.noise.ignored',{strokeIds:[...ids]});void store.flush();}}

 async function modelRequest(route,data){
  const requestId=data.requestId||crypto.randomUUID(),supersedes=lastModelRequest;
  lastModelRequest=requestId;
  refinementAbort=new AbortController();
  return studio.decisionRequest(route,{...data,requestId,supersedes},{signal:refinementAbort.signal});
 }
 async function refineFittedSketch(fitId,token){
  try{return await modelRequest('sketch-refine',{fitId});}
  catch(error){
   if(token!==generation||!(/surface inspection|tool budget|no final sketch refinement|refinement incomplete|timed? out|temporarily unavailable|after 5 attempts|fetch failed|failed to fetch/i.test(error.message)))throw error;
   progress.step('Continuing from the fitted sketch');
   status.textContent='Finishing the edit from the saved sketch…';
   store.log('decision.refinement.recovering',{fitId,reason:error.message});
   const result=await modelRequest('sketch-refine',{fitId,directRecovery:true});
   result.cost={...result.cost,usd:null,usageKnown:false,note:'Earlier interrupted request usage is unknown'};
   return result;
  }
 }
 async function collaborativeStep(words){
  const id=crypto.randomUUID(),field=$('#decision-instruction'),submitted=field.value,hadBody=studio.surfaceModels?.().some(m=>!m.hidden),question=pending?.refinement?.question?{question:pending.refinement.question,instruction:cases.find(c=>c.id===pending.id)?.work?.instruction||runningInstruction}:null;
  if(studio.modelAgent.busy&&!studio.modelAgent.waitingForAnswer){queued=true;status.textContent='Your next step is queued while AI finishes the current move…';clearTimeout(timer);timer=setTimeout(()=>void fit(),750);return;}
  busy=true;queued=false;stopAutoAccept();progress.begin('Working on your next CAD step');status.textContent='AI is planning the next step on your current model…';sync();
  store.log('collaboration.step.started',{id,instruction:words});
  try{
   if(studio.modelAgent.waitingForAnswer)await studio.modelAgent.answerInstruction(words,instructionSource);
   else{
    if(pending&&!question&&pending.refinement?.state!=='failed')await acceptPending();
    if(studio.aiDraftReview.active&&studio.aiDraftReview.hasChanges&&!studio.aiDraftReview.busy)await studio.aiDraftReview.accept();
    releaseNativePreview();clear();
    await studio.modelAgent.submitInstruction(collaborationStepPrompt(words,question),'cad-collaboration');
   }
   const run=store.session.lastAIRun;
   if(run?.state==='failed')throw Error(run.error||'The CAD step needs another attempt.');
   if(run?.state==='running'){status.textContent='Connection interrupted · AI will continue when connected';return;}
   if(!hadBody&&studio.surfaceModels?.().some(m=>!m.hidden))document.querySelector('#desktop-3d').click();
   const message=run?.answer||'Step processed. Review the current model and describe the next change.';
   partUI.chat.reply('collaboration:'+id,message);status.textContent=run?.state==='waiting_for_answer'?'AI is waiting for your answer.':'Step ready · review, then keep designing';
   store.log('collaboration.step.finished',{id,runId:run?.id,state:run?.state});
   if(field.value===submitted){field.value='';store.session.decisionInstruction='';userBuildInstruction='';advanceTurn(true);}
  }catch(error){status.textContent='This step needs attention · see Chat';partUI.chat.reply('collaboration:'+id,error.message);store.log('collaboration.step.error',{id,message:error.message});}
  finally{busy=false;progress.stop();sync();await store.flush();if(queued){clearTimeout(timer);timer=setTimeout(()=>void fit(),300);}}
 }
 async function fit(){

  if(busy||applying){status.textContent='New input queued…';return;}

  if(speechPending&&!activeTurn){status.textContent='Listening · waiting for your instruction…';queued=true;return;}
  if(studio.active?.size){timer=setTimeout(()=>void fit(),200);return;}

  if(nativePreview&&!pending){
   if(replacingDraft)return;
   // Extend the verified working model inside its current review transaction.
   nativePreview=null;
   store.log('decision.part.continued',{solidIds:(store.session.desktopSolids||[]).map(s=>s.id)});
  }
  publishTypedInput();
  if((buildPressed||userBuildInstruction?.trim())&&text()?.trim()){
   const words=text();buildPressed=false;await collaborativeStep(words);return;
  }
  const before=localDesktopEvidence(studio,store),existingEdit=!before.strokes.length&&!!text()&&before.figures.some(f=>!f.hidden);if(!before.strokes.length&&!existingEdit){queued=false;status.textContent='Draw or select a sketch first.';sync();if(activeTurn)advanceTurn();return;}

  const explicitBuild=buildPressed;buildPressed=false;
  const creationMode=explicitBuild?'build':userBuildInstruction?'instruction':'sketch';
  const closed=$('#decision-closed').value,options={detectOffsets:offsetToggle.checked,intent:$('#decision-intent').value,representation:$('#decision-kind').value,symmetry:$('#decision-symmetry').value,closed:closed==='auto'?'auto':closed==='true',align:store.session.sketchAlign!==false},key=JSON.stringify({strokes:before.strokes.map(s=>({id:s.id,points:s.points,plane:s.plane})),prompt:text(),creationMode,options,refine:$('#decision-refine').checked});if(key===lastKey&&pending&&pending.refinement?.state!=='failed')return;

  const speechInputs=(activeTurn?.inputs||[]).map(input=>({...input,figureIds:speechFigureIds(input,before.figures,store.session.decisionSketches||[])}));
  const linkedIds=speechInputs.at(-1)?.figureIds||[];
  const selectedId=before.editContext?.targetFigure?.id||studio.desktopDrawing.selectedId,visible=before.figures.filter(f=>!f.hidden),targets=existingEdit?(selectedId?visible.filter(f=>f.id===selectedId):linkedIds.length?visible.filter(f=>linkedIds.includes(f.id)):visible.filter(f=>f.desktopSketchId===store.session.activeDesktopSketchId)):[],instructionTargets=(explicitBuild?visible.filter(f=>!f.construction):targets.length?targets:visible.slice(-1)).slice(-8);if(existingEdit)before.instructionTargets=instructionTargets.map(f=>({id:f.id,version:f.version}));
  const draftContext=existingEdit?{strokes:[],retained:[],references:[]}:splitDecisionDrafts(before,cachedDrafts);if(!draftContext.strokes.length&&!existingEdit){queued=false;status.textContent='Draw on this plane, or return to the existing sketch to edit it.';sync();if(activeTurn)advanceTurn();return;}
  const references=before.figures.filter(f=>!f.hidden).reverse().sort((a,b)=>Number(b.id===before.editContext?.targetFigure?.id)-Number(a.id===before.editContext?.targetFigure?.id)).slice(0,24).map(f=>{const path=studio.desktopDrawing.points(f).map(p=>p.toArray()),step=Math.max(1,Math.ceil(path.length/128)),points=path.filter((_,i)=>i%step===0||i===path.length-1),plane=before.referencePlanes.find(p=>p.id===f.planeId)||{id:f.planeId,origin:f.origin,xAxis:f.xAxis,yAxis:f.yAxis};const input=store.session.strokes.find(s=>f.strokeIds?.includes(s.id)&&s.view?.cameraToWorld);return {id:f.id,name:f.name||f.kind,kind:f.kind,plane,points,captureDirection:input?.view.cameraToWorld.slice(8,11)};});references.unshift(...draftContext.references);references.splice(24);

  const token=generation,started=performance.now(),submittedInstruction=text();let recorded=false,received=null,constructionFailure=null;queued=false;busy=true;runningInstruction=submittedInstruction;failedRequest=false;progress.begin(existingEdit?'Planning changes from your sketches':'Interpreting the strokes');accept.disabled=true;status.textContent=existingEdit?'Editing the current sketch…':'Understanding drawing…';sync();

  try{clear();
   // Use one image, camera and scene snapshot for the whole turn, including
   // tool calls and retries. Orbiting the inspection camera is local UI state.
   const capture=!existingEdit&&lastDrawingImage&&lastDrawingView
    ?{image:lastDrawingImage,view:lastDrawingView,surfaceScene:lastSurfaceScene||{version:1,models:[],omitted:before.models.map(m=>({id:m.id,reason:'No matching mesh snapshot for this drawing'}))}}
    :instructionCapture||captureViewport();
   const data={speechInputs,creationMode,userBuildInstruction,apiSpeed:speed.value,editContext:studio.desktopEditing?.context(),references,requestId:crypto.randomUUID(),designOrigin:[0,1.15,-.6],surfaceScene:capture.surfaceScene,referencePlanes:before.referencePlanes,strokes:draftContext.strokes.map(({id,points,plane,desktopSketchId,drawingTarget,erasedFrom,intentionallyOpen,started,ended,view,endView})=>({id,points,plane,desktopSketchId,drawingTarget,erasedFrom,intentionallyOpen,started,ended,view,endView})),plane:before.defaultPlane,prompt:text(),options,view:capture.view,image:capture.image};

   const solids=store.session.desktopSolids||[];
   if(solids.length){
    const doc=document.querySelector('#full-cad-workspace iframe')?.contentWindow?.__draw3dCAD?.document();
    const scale={mm:.001,cm:.01,m:1,inch:.0254}[doc?.units];
    const bodies=solids.flatMap(s=>{
     const b=doc?.derived?.bodyRepresentations?.[s.bodyId],m=before.models.find(m=>m.nativeId===s.bodyId);
     if(!scale||!b?.exportableStep||b.consumed||m?.hidden||!b.bbox)return [];
     const {min,max}=b.bbox,boundsWorld={min:[min.x*scale,min.z*scale,-max.y*scale],max:[max.x*scale,max.z*scale,-min.y*scale]};
     return [{id:s.id,bodyId:s.bodyId,name:s.name,figureIds:s.figureIds,modelId:m?.id,boundsWorld}];
    });
    data.partContext={selection:studio.desktopSelection.summary(),bodies};
    data.existingSolids=solids.filter(s=>bodies.some(b=>b.bodyId===s.bodyId));
   }
   if(!existingEdit){
    data.sketchFigures=(submittedInstruction||data.partContext?visible:visible.filter(f=>
     f.desktopSketchId===store.session.activeDesktopSketchId&&!f.extrusion&&!(store.session.desktopSolids||[]).some(s=>s.figureIds.includes(f.id)))).slice(-24);
    data.sketchCatalog=studio.desktopSketches?.catalog()||[];
    data.selectedSketchIds=studio.desktopSketches?.selectedIds||[];
   }
   const placements=data.strokes.filter(s=>s.drawingTarget?.placementChoice);
   if(placements.length){
    for(const stroke of placements){
     const t=stroke.drawingTarget;
     t.policy=t.placementChoice==='keep'?'Keep this stroke exactly on '+t.placementSupportId+'.':'User chose a different plane for this stroke. Project it, preferably parallel to '+t.placementSupportId+' if consistent with the drawing; infer depth from the original view or ask for the offset.';
    }
    const note='Honor each stroke’s confirmed placementChoice and policy. Preserve earlier sections on their own planes.';
    if(data.prompt.length+note.length+1<=4000)data.prompt=[data.prompt,note].filter(Boolean).join('\n');
   }
   let rawResult,selectedResult;if(existingEdit){
    data.previousWorkOnTargets=await previousSketchWork(instructionTargets,store.session.decisionSketches||[],cases,async asset=>{
     const entry=await store.get('assets',[store.session.id,asset]);
     return entry?JSON.parse(await entry.blob.text()):null;
    },{includeGuides:isSketchContinuation(data.prompt||'')});
    Object.assign(data,{figures:instructionTargets,constraints:store.session.decisionSketches||[],source:instructionSource,sketchFigures:[...visible].sort((a,b)=>Number(instructionTargets.some(f=>f.id===b.id))-Number(instructionTargets.some(f=>f.id===a.id))).slice(0,24),sketchCatalog:studio.desktopSketches?.catalog()||[],selectedSketchIds:studio.desktopSketches?.selectedIds||[],existingSolids:data.existingSolids||[]});rawResult=await modelRequest('sketch-command',data);selectedResult=rawResult;}else{rawResult=await studio.decisionRequest('sketch-decisions',data);selectedResult=reuseNoiseDrafts(rawResult,cachedDrafts,draftContext.strokes,{sameInstruction:text()===cachedPrompt});}
   const needsPlacement=rawResult.results?.some(r=>r.supportDecision?.label&&!['current','uncertain'].includes(r.supportDecision.label))||data.strokes.some(s=>s.drawingTarget?.captureOnly);
   if(!existingEdit&&($('#decision-refine').checked||!!submittedInstruction||needsPlacement)&&!selectedResult.noOp&&!selectedResult.reusedAfterNoise&&rawResult.results.length&&token===generation){drawFit(selectedResult);progress.step(needsPlacement?'Checking the sketch plane':'Refining the fitted sketch');status.textContent='Sketch fitted · following your instruction…';store.log('decision.refinement.sent',{fitId:rawResult.id,stage:needsPlacement?'plane placement':'sketch refinement',requestedTier:data.apiSpeed});try{const refined=await refineFittedSketch(rawResult.id,token);selectedResult=refined.refinement?.question?{...rawResult,cost:refined.cost,refinement:refined.refinement}:refined;store.log('decision.refinement.received',{fitId:rawResult.id,refinement:refined.refinement});}catch(error){selectedResult={...rawResult,cost:{usd:null,usageKnown:false,fitUSD:rawResult.cost?.usd,refinementUSD:null,note:'Refinement interrupted or failed; provider usage may have been billed'},refinement:{state:'failed',error:error.message}};store.log('decision.refinement.failed',{fitId:rawResult.id,error:error.message});}}
   const building=explicitBuild||creationMode==='instruction'&&['build','extrude','revolve','hollow_revolve'].includes(selectedResult.solidAuthorization);
   if(!building&&(selectedResult.solidEdits?.length||selectedResult.edits?.some(e=>e.extrusionMetres>0)))throw Error('Solid creation needs a 3D instruction or Create 3D. The drawing was retained.');
   let result=combineDecisionDrafts(rebaseSurfaceResult(selectedResult,before.models),draftContext.retained);
   if(!result.refinement?.question&&result.refinement?.state!=='failed'){
    for(const stroke of placements){
     const target=stroke.drawingTarget;
     const support=data.referencePlanes.find(p=>p.id===target.placementSupportId)||stroke.plane;
     for(const figure of result.results.filter(r=>r.sourceStrokeIds.includes(stroke.id))){
      const frame=figure.frame,alignment=Math.abs(support.normal.reduce((sum,n,k)=>sum+n*frame.normal[k],0));
      const depth=Math.abs(support.normal.reduce((sum,n,k)=>sum+n*(frame.origin[k]-support.origin[k]),0));
      const coplanar=alignment>1-1e-6&&depth<1e-5;
      if(coplanar!==(target.placementChoice==='keep')){
       result.refinement={...result.refinement,question:coplanar?'How far should the new sketch plane be offset? Type or speak a distance.':'The proposed sketch moved off your chosen plane. What should change within the current plane?'};
       break;
      }
     }
    }
   }
   for(const {plane,drawingTarget} of data.strokes){
    if(drawingTarget?.captureOnly&&result.edits.some(e=>e.planeId===plane.id)&&!result.referencePlanes?.some(p=>p.id===plane.id))(result.referencePlanes??=[]).push(plane);
   }
   if(!building&&store.session.alignFirstBody===true&&!before.figures.some(f=>!f.hidden)&&!before.models.some(m=>!m.hidden)&&!result.referencePlanes?.length)result=alignInitialDrawing(result,data.plane,data.designOrigin);
   result.creationMode=building?'build':'sketch';received=result;if(token===generation&&!result.solidEdits?.length&&!result.edits.some(e=>e.extrusionMetres>0))partUI?.chat.reply(result.id,result.refinement?.question||result.refinement?.summary||(result.noOp?'Sketch unchanged.':'Sketch fitted.'));receipt(result,'received');let elapsed=performance.now()-started;

   // Record billed stale results too; new ink never gets overwritten by an old response.

   const asset='decision-cases/'+result.id+'.json';await store.asset(asset,new Blob([JSON.stringify({data,result,sourceStrokes:before.strokes,clientPreviewMs:elapsed})],{type:'application/json'}),{kind:'decision-test-case'});cases.push({id:result.id,asset,creationMode:result.creationMode,work:summarizeSketchWork(data,result),at:Date.now(),cost:result.cost,clientPreviewMs:elapsed,refinement:result.refinement,feedback:[]});recorded=true;await store.flush();

   if(token!==generation){receipt(result,'stale',{reason:lastInvalidation});status.textContent='Drawing changed · fitting the latest strokes next';return;}

   if(!result.results.length&&!result.solidEdits?.length&&result.noOp){clear();assertDesktopCurrent(studio,store,before);hideNoise(result);if(nativeDraftOwned)delete document.body.dataset.decisionNativePreview;status.textContent=result.refinement?.summary||'Ignored stray strokes · sketch unchanged.';receipt(result,'unchanged',{ignoredStrokeIds:(result.ignoredGroups||[]).flatMap(g=>g.sourceStrokeIds)});await store.flush();return;}

   if(!result.results.length&&!result.solidEdits?.length&&!result.refinement?.question){status.textContent='No clear figure interpreted · original drawing retained. Add a short description or change Interpretation.';receipt(result,'failed',{reason:'No proposed geometry'});return;}

   const targetsToConfirm=!existingEdit&&!result.refinement?.question&&result.refinement?.state!=='failed'?proposedPlacement(result,data.strokes):[];
   assertDesktopCurrent(studio,store,before);hideNoise(result);evidence=localDesktopEvidence(studio,store);if(existingEdit)evidence.instructionTargets=before.instructionTargets;if(!targetsToConfirm.length&&!result.refinement?.question&&(result.solidEdits?.length||result.edits.some(e=>e.extrusionMetres>0))){clear();drawFit(result);
    try{await stageNativeModel(result,evidence,token);}
    catch(error){
     if(token!==generation||!result.refinement?.id||!error.cadRolledBack||!(error.cadCommandError||/CAD could not build|removed no measurable|added no measurable|one connected solid/i.test(error.message)))throw error;
     receipt(result,'failed',{reason:error.message});
     progress.step('Adjusting the feature after CAD verification');status.textContent='CAD rejected the feature · revising the preview…';
     const failed=result;
     const revised=await modelRequest('sketch-refine',{fitId:rawResult.id,cadFailure:{refinementId:failed.refinement.id,verifiedFeatures:error.verifiedFeatures,reason:error.message.slice(0,1000)}});
     if(token!==generation)return;
     if(!revised.refinement?.question&&!revised.solidEdits?.length)throw Error('CAD repair returned no solid features');
     result=combineDecisionDrafts(rebaseSurfaceResult(revised,before.models),draftContext.retained);result.creationMode=building?'build':'sketch';
     if(result.cost?.usageKnown&&failed.cost?.usageKnown)result.cost.usd+=failed.cost.refinementUSD||0;
     received=result;receipt(result,'received',{reason:'Revised after CAD verification'});
     const audit=cases.find(c=>c.id===result.id);
     if(audit){audit.cadRepair={rejected:failed.refinement.id,reason:error.message,revised:result.refinement.id};audit.cost=result.cost;}
     evidence=localDesktopEvidence(studio,store);
     if(existingEdit)evidence.instructionTargets=before.instructionTargets;
     const placements=proposedPlacement(result,data.strokes);
     if(placements.length)targetsToConfirm.push(...placements);
     if(!placements.length&&!result.refinement?.question){drawFit(result);await stageNativeModel(result,evidence,token);}
    }
    if(token!==generation)return;evidence=localDesktopEvidence(studio,store);if(existingEdit)evidence.instructionTargets=before.instructionTargets;elapsed=performance.now()-started;cases.at(-1).clientPreviewMs=elapsed;cases.at(-1).nativeApplication=result.nativeApplication;}if(!result.refinement?.question&&result.refinement?.state!=='failed'){cachedDrafts=cacheDecisionDrafts(result,before.strokes);cachedPrompt=text();}render(result);if(targetsToConfirm.length)confirmPlacement(targetsToConfirm);lastKey=key;

   const usd=result.cost.usd,known=cases.filter(c=>c.cost?.usageKnown),total=known.reduce((n,c)=>n+c.cost.usd,0),mean=known.length?total/known.length:0;

   details.textContent=JSON.stringify({method:result.method,refinement:result.refinement,timing:{...result.timings,visiblePreviewMs:elapsed},cost:result.cost,session:{requests:cases.length,knownCostUSD:total,unknownUsage:cases.length-known.length},projection:{assumption:'120 updates/hour; 160 hours/month; decision calls only',usdPerHour:mean*120,usdPerMonth:mean*120*160},input:result.input,originPlacements:result.originPlacements,componentRelations:result.componentRelations,connections:result.connections,crossPlaneMatches:result.crossPlaneMatches,traceMerges:result.traceMerges,joinedChains:result.joinedChains,ignoredGroups:result.ignoredGroups,results:result.results.map(({id,kind,interpretation,constraints,metrics,decisions,repairPolicy,warnings})=>({id,kind,interpretation,constraints,metrics,decisions,repairPolicy,warnings})),warnings:result.warnings},null,2);

   status.textContent=result.refinement?.question?'Question: '+result.refinement.question:result.refinement?.state==='failed'?'AI refinement failed: '+result.refinement.error+' · initial fit retained.':result.reusedAfterNoise?'Ignored stray strokes · previous preview unchanged.':`Preview ready · ${result.refinement?.summary||result.results.map(r=>r.interpretation?.label||r.kind).join(', ')} · ${(elapsed/1000).toFixed(2)} s · ${usd===null?'cost unavailable':(result.cost.estimated?'≈$':'$')+usd.toFixed(6)}${result.ignoredGroups?.length?' · ignored '+result.ignoredGroups.reduce((n,g)=>n+g.sourceStrokeIds.length,0)+' stray stroke(s)':''}`;

   await new Promise(resolve=>requestAnimationFrame(resolve));receipt(result,result.reusedAfterNoise?'unchanged':'visible',{elapsedMs:Math.round(performance.now()-started),figureCount:result.results.length,interpretations:result.results.map(r=>r.interpretation?.label||r.kind)});

  }catch(e){if(received?.solidEdits?.length||received?.edits?.some(e=>e.extrusionMetres>0))constructionFailure=e.message;if(token!==generation){receipt(received,'stale',{reason:lastInvalidation});return;}failedRequest=true;receipt(received,'failed',{reason:e.message});if(!recorded)cases.push({id:crypto.randomUUID(),at:Date.now(),error:e.message,cost:{usd:null,usageKnown:false},feedback:[]});await store.flush();status.textContent='Could not preview: '+e.message;store.log('decision.error',{message:e.message});}

  finally{if(constructionFailure&&token===generation){
    progress.failed('Body creation failed · '+constructionFailure,()=>{
     if(token!==generation||busy||applying)return;
     buildPressed=explicitBuild;
     if(submittedInstruction)receiveInstruction(submittedInstruction,'typed');else queue({force:true,delay:0});
    });
   }else progress.stop();refinementAbort=null;busy=false;runningInstruction='';const requested=finishWhenReady?.token===token&&finishWhenReady?.id===nativePreview?.id;
   buildingPart=null;finishWhenReady=null;
   if(token===generation){if(requested&&!speechPending)void acceptPending({finishPart:true});else armAutoAccept();if(activeTurn&&(pending?.refinement?.question||(!pending&&received)||speechTurns.length&&pending?.refinement?.state==='failed'))advanceTurn();}accept.disabled=!pending||!!pending.refinement?.question||pending.refinement?.state==='failed';sync();if(token!==generation&&!speechPending&&(queued||$('#decision-auto').checked)){clearTimeout(timer);timer=setTimeout(()=>void fit(),350);}}

 }

 function editPayload(result){return {summary:result.refinement?.summary||'Sketch-based CAD',assumptions:[],question:null,questionOptions:[],edits:result.edits,modelEdits:[],solidEdits:result.solidEdits||[],requestedSketchIds:[],requestedStrokeArchiveIds:[],voiceControl:null,automation:null,continuation:null};}
 function recordGeometry(result,applied){
  const oldRules=new Map((store.session.decisionSketches||[]).map(rule=>[rule.figureId,rule]));
  const updated=new Set(result.edits.filter(e=>e.operation==='update').map(e=>e.figureId));store.session.decisionSketches=(store.session.decisionSketches||[]).filter(s=>!updated.has(s.figureId));
   store.session.decisionSketches??=[];const figureMap=new Map(result.results.map((r,i)=>[r.id,applied.review.figureIds[i]]));result.results.forEach((r,i)=>{const constraints=structuredClone(r.constraints);for(const c of [...(constraints.connections||[]),...(constraints.componentRelations||[])]){c.referenceId=figureMap.get(c.referenceId)||c.referenceId;if(c.parentId)c.parentId=figureMap.get(c.parentId)||c.parentId;}store.session.decisionSketches.push({id:result.id+':'+r.id,figureId:applied.review.figureIds[i],previousCaseIds:figureWorkCaseIds(oldRules.get(applied.review.figureIds[i])).slice(-2),kind:r.kind,interpretation:r.interpretation,constraints,sourceStrokeIds:r.priorStrokeIds?.length?r.priorStrokeIds:r.sourceStrokeIds});});
 }
 function releaseNativePreview(){nativePreview=null;nativeDraftOwned=false;delete document.body.dataset.decisionNativePreview;}
 async function stageNativeModel(result,source,token){
  const start=performance.now(),runId='local-decision-'+result.id;assertDesktopCurrent(studio,store,source);status.textContent='Building CAD body…';progress.step('Preparing the editable geometry');
  if(!studio.aiDraftReview.active)await studio.desktopHistory.capture('Before 3D edit');
  let verifiedFeatures=0;
  const checkpoint=await studio.aiDraftReview.checkpoint();
  await studio.aiDraftReview.begin(runId);nativeDraftOwned=true;studio.aiDraftReview.setBusy(true);
  try{for(const plane of result.referencePlanes||[])if(!store.session.desktopPlanes.some(p=>p.id===plane.id))store.session.desktopPlanes.push(structuredClone(plane));const applied=await applyDesktopEdit({studio,store,edit:editPayload(result),evidence:{...source,referencePlanes:[...(source.referencePlanes||[]),...(result.referencePlanes||[])],decisionSketches:(source.decisionSketches||[]).filter(s=>!result.edits.some(e=>e.operation==='update'&&e.figureId===s.figureId))},runId,record:(label,item)=>{
    if(token!==generation)return;
    if(item.phase)receipt(result,'building',{reason:label,elapsedMs:Math.round(performance.now()-start)});
    if(item.phase==='applying'&&item.profiles){
     progress.previewSolid(item);buildingPart={id:result.id,token};sync();
    }else if(item.phase==='applying'&&item.kind==='extrusion'){
     const figure=studio.desktopDrawing.summary().find(f=>f.id===item.figureId);
     if(figure){progress.previewSolid({kind:'extrude',profiles:[{figureId:figure.id,depthMetres:item.depthMetres}]});buildingPart={id:result.id,token};sync();}
    }else if(item.phase==='applied'&&item.solidId){verifiedFeatures++;progress.clearGeometry();}
    progress.step(item.phase==='applying'&&(item.profiles||item.kind==='extrusion')?'Provisional 3D preview · '+label:label);
   },cancelled:()=>token!==generation});
  if(token!==generation)throw Error('Superseded by newer drawing instructions');
  if(result.replacesBody)await studio.desktopDrawing.retireRedesignedBody(result.replacesBody);
  recordGeometry(result,applied);if(source.strokes.length)await archiveAppliedStrokes({studio,store,evidence:source,runId,summary:result.refinement?.summary});studio.aiDraftReview.markApplied();nativePreview={id:result.id,review:applied.review};result.nativeApplication={durationMs:performance.now()-start,modelIds:applied.review.modelIds,operations:[...result.edits.filter(e=>e.extrusionMetres>0).map(e=>({kind:'extrude',name:e.name})),...(result.solidEdits||[]).map(s=>({kind:s.kind,figureIds:s.profiles.map(p=>p.figureId)}))]};store.log('decision.model.visible',{id:result.id,...result.nativeApplication});partUI?.chat.reply(result.id,result.refinement?.summary||'3D model ready.');}
  catch(error){
   replacingDraft=true;studio.aiDraftReview.setBusy(false);
   try{if(checkpoint){await studio.aiDraftReview.restoreCheckpoint(checkpoint);nativePreview=null;}else{await studio.aiDraftReview.discard();releaseNativePreview();}}
   finally{replacingDraft=false;}
   error.cadRolledBack=true;error.verifiedFeatures=verifiedFeatures;throw error;
  }
  finally{studio.aiDraftReview.setBusy(false);}
 }
 async function acceptPending({finishPart=false}={}){let owned=false,checkpoint=null,phase="validating the preview";const started=performance.now();let drawingIndex=0;stopAutoAccept();if(placementRequest||!pending||busy||applying||speechPending||pending.refinement?.question||pending.refinement?.state==='failed')return;applying=true;const result=pending;accept.disabled=discard.disabled=true;const runId='local-decision-'+result.id;try{if(result.edits.some(e=>e.planeId===evidence.defaultPlane.id)&&!store.session.desktopPlanes.some(p=>p.id===evidence.defaultPlane.id))result.referencePlanes=[...(result.referencePlanes||[]),structuredClone(evidence.defaultPlane)];
   if(nativePreview?.id===result.id){if(!await studio.aiDraftReview.accept())throw Error('CAD preview could not be committed');await studio.desktopHistory.capture(result.solidEdits?.length||result.nativeApplication?'Create or modify body':'Accept sketch');owned=false;receipt(result,'accepted',{commitMs:Math.round(performance.now()-started)});void saveCase('accepted',result).catch(e=>store.log('decision.feedback.error',{message:e.message}));releaseNativePreview();clear();status.textContent='CAD model ready · source sketches remain editable.';if(finishPart)await finishPartStep();advanceTurn(true);return;}
   assertDesktopCurrent(studio,store,evidence);const updates=result.edits.filter(e=>e.operation==='update');for(const e of updates){const target=evidence.instructionTargets?.find(f=>f.id===e.figureId)||evidence.editContext?.targetFigure;if((!evidence.instructionTargets&&evidence.editContext?.mode!=='cad')||e.figureId!==target?.id||e.expectedVersion!==target.version)throw Error('The edit no longer matches the selected drawing');}for(let i=0;i<result.edits.length;i++)verifyDecisionFigure(result.edits[i],result.results[i]);if(studio.aiDraftReview.active&&!nativeDraftOwned)throw Error('Finish or discard the other active CAD preview first');
   phase='saving the starting sketch';if(!studio.aiDraftReview.active)await studio.desktopHistory.capture('Before sketch edit');checkpoint=await studio.aiDraftReview.checkpoint();owned=true;await studio.aiDraftReview.begin(runId,{documentOnly:updates.length===0});if(result.referencePlanes?.length)studio.surface?.clear();for(const plane of result.referencePlanes||[])if(!store.session.desktopPlanes.some(p=>p.id===plane.id))store.session.desktopPlanes.push(structuredClone(plane));studio.planeEditor.refresh();store.session.decisionSketches=(store.session.decisionSketches||[]).filter(s=>!updates.some(e=>e.figureId===s.figureId));studio.aiDraftReview.setBusy(true);phase='creating editable geometry';receipt(result,'applying');status.textContent='Creating editable geometry…';sync();

   const edit=editPayload(result);

   const applied=await applyDesktopEdit({studio,store,edit,evidence:{...evidence,referencePlanes:[...(evidence.referencePlanes||[]),...(result.referencePlanes||[])],decisionSketches:(evidence.decisionSketches||[]).filter(s=>!result.edits.some(e=>e.operation==='update'&&e.figureId===s.figureId))},runId,record:(label,step)=>{
    if(step?.phase==='applying'){status.textContent='Saving sketch '+(++drawingIndex)+' of '+result.edits.length+' · '+label;sync();}
   }});

   phase="saving the editable sketch";status.textContent="Saving sketch…";sync();recordGeometry(result,applied);

   await archiveAppliedStrokes({studio,store,evidence,runId,summary:edit.summary});studio.aiDraftReview.markApplied();studio.aiDraftReview.setBusy(false);if(!await studio.aiDraftReview.accept())throw Error('CAD preview could not be committed');await studio.desktopHistory.capture(result.solidEdits?.length||result.nativeApplication?'Create or modify body':'Accept sketch');owned=false;receipt(result,'accepted',{commitMs:Math.round(performance.now()-started)});void saveCase('accepted',result).catch(e=>store.log('decision.feedback.error',{message:e.message}));releaseNativePreview();clear();status.textContent='Accepted · draw the next component.';advanceTurn();

  }catch(e){let reason=phase+': '+e.message;
   receipt(result,'failed',{reason,elapsedMs:Math.round(performance.now()-started),figureIndex:drawingIndex});status.textContent='Could not finish '+reason;sync();
   if(owned && studio.aiDraftReview.runIds.includes(runId)){
    studio.aiDraftReview.setBusy(false);
    try{if(checkpoint)await studio.aiDraftReview.restoreCheckpoint(checkpoint);else await studio.aiDraftReview.discard();}catch(restore){reason+='; restore failed: '+restore.message;}
   }
   stopAutoAccept();status.textContent='Could not finish '+reason;}

  finally{applying=false;preview.visible=true;sync();if(queued&&!speechPending){clearTimeout(timer);timer=setTimeout(()=>void fit(),350);}}

 }
 accept.onclick=()=>void acceptPending();

 discard.onclick=async()=>{stopAutoAccept();const result=pending;
  discardedTurn={words:activeTurn?.words||text(),inputs:activeTurn?.inputs||[],strokeIds:(result?.results||[]).flatMap(r=>r.sourceStrokeIds||[])};
  if(nativeDraftOwned){studio.endAll();await studio.aiDraftReview.discard();releaseNativePreview();}
  const feedback=saveCase('discarded',result);clear();status.textContent='Preview discarded. Original drawing retained.';advanceTurn();await feedback;};

 $('#decision-incorrect').onclick=()=>saveCase('incorrect');$('#decision-fit').onclick=()=>void fit();

 floatingAccept.onclick=()=>accept.click();floatingDiscard.onclick=()=>discard.click();

 for(const id of ['kind','symmetry','closed','intent'])$('#decision-'+id).onchange=queue;

 $('#decision-refine').onchange=()=>{store.session.decisionRefine=$('#decision-refine').checked;void store.flush();queue();};
 $('#decision-instruction').oninput=()=>{
  pendingChatText=$('#decision-instruction').value.trim();userBuildInstruction=pendingChatText;
  const completed=beginIndependentInput({keepField:true});
  if(!store.session.strokes.some(s=>!s.hidden))instructionCapture=captureViewport(instructionCapture);
  if(applying){
   const words=$('#decision-instruction').value.trim();
   if(speechTurns.at(-1)?.source==='typed')speechTurns.pop();
   if(words)speechTurns.push({words,source:'typed',capture:instructionCapture});
   return;
  }
  if(!completed&&!typedBase&&!applying&&!pending?.refinement?.question&&(busy||pending||activeTurn))typedBase=runningInstruction||activeTurn?.words||store.session.decisionInstruction||'';
  updateSpeechPending();voiceText='';instructionSource='typed';if(activeTurn)activeTurn.words=text();store.session.decisionInstruction=text();void store.flush();queue({force:true});};$('#decision-auto').onchange=()=>{if($('#decision-auto').checked)queue();else clearTimeout(timer);};

 const log=store.log.bind(store);store.log=(type,data)=>{log(type,data);if(nativeDraftOwned&&!applying&&!replacingDraft&&['ai.preview.accepted','ai.preview.discarded'].includes(type)){releaseNativePreview();clear();if(type==='ai.preview.discarded'){refinementAbort?.abort();generation++;clearTimeout(timer);queued=false;}status.textContent=type==='ai.preview.accepted'?'CAD model accepted.':'CAD preview discarded.';advanceTurn(true);}if(!applying&&type==='stroke.begin'){discardedTurn=null;beginIndependentInput();lastInvalidation='new stroke started';refinementAbort?.abort();generation++;clearTimeout(timer);clear();queued=false;status.textContent='Drawing…';sync();}else if(type==='stroke.end'){rememberInk(store.session.strokes.find(s=>s.id===data.id));lastDrawingImage=image();lastDrawingView=drawingView(studio);lastSurfaceScene=captureSurfaceScene(studio.surfaceModels?.()||[]);const surfaceAsset='decision-latest-surfaces.json';const saveSurfaces=store.asset(surfaceAsset,new Blob([JSON.stringify(lastSurfaceScene)],{type:'application/json'}),{kind:'drawing-surface-snapshot'});const asset='decision-latest-view.jpg',bytes=Uint8Array.from(atob(lastDrawingImage.split(',')[1]),c=>c.charCodeAt(0));store.session.decisionDrawingView={strokeId:data.id,view:lastDrawingView,asset,surfaceAsset};void Promise.all([saveSurfaces,store.asset(asset,new Blob([bytes],{type:'image/jpeg'}),{kind:'drawing-view'})]).then(()=>store.flush());
 if(applying){queued||=$('#decision-auto').checked;}else queue({force:!!activeTurn||!!runningInstruction});}else if(!applying&&['stroke.erase.end','stroke.remove','stroke.undo','stroke.redo','undo','redo'].includes(type)){lastDrawingImage=null;lastDrawingView=null;lastSurfaceScene=null;delete store.session.decisionDrawingView;queue();}};

 function receiveInstruction(value,source,id,capture){const words=value?.trim();userBuildInstruction=buildPressed?'':words||'';if(words){discardedTurn=null;instructionCapture=capture||captureViewport();}updateSpeechPending();if(!words){resumeDrawing();return;}failedRequest=false;settledInstruction=false;typedBase='';voiceText=words;instructionSource=source;$('#decision-instruction').value=words;store.session.decisionInstruction=words;store.log('decision.instruction.received',{text:words,source,audioId:id,...(buildPressed?{displayText:'Create 3D'}:{})});void store.flush();queue({force:true,delay:0,reason:'new '+source+' instruction'});}
 window.addEventListener('draw3d-speech-activity',({detail:d})=>{speaking=!!d.speaking;if(speaking){speechCapture??=captureViewport();listen('Listening…');}});
 window.addEventListener('draw3d-speech-misfire',()=>{speaking=false;speechCapture=null;updateSpeechPending();if(!speechPending)resumeDrawing();});
 window.addEventListener('draw3d-microphone-state',({detail:d})=>{if(['off','error'].includes(d.phase)){speaking=false;updateSpeechPending();if(!speechPending)resumeDrawing();}});
 window.addEventListener('draw3d-transcript-final',({detail:p})=>{if(isSpokenDesignTranscript(p))captureSpeech(p,()=>p.text);});
 window.addEventListener('draw3d-audio-final',({detail:d})=>{
  if(seenAudio.has(d.id))return;
  speaking=false;
  listen('Transcribing instruction…');
  captureSpeech(d,async binding=>{
   const blob=d.blob||(await store.get('assets',[store.session.id,d.name]))?.blob;if(!blob)throw Error('Voice recording missing');
   const {text,speechDecision,timings}=await studio.decisionRequest('concept-transcribe',{sketchSpeech:true,currentInstruction:unfinishedInstruction(),hasSketch:!!studio.desktopDrawing.summary().length||store.session.strokes.some(s=>!s.hidden),audioId:d.id,strokeIds:binding.strokeIds,start:binding.start,end:binding.end,audioInputs:[{mimeType:'audio/wav',audio:await blobToBase64(blob)}],streamTranscript:true},{
    onRetry:retry=>{
     store.log('decision.speech.retry',{audioId:d.id,...retry});
     if(!activeTurn&&!busy&&!applying&&speechPending)listen(retry.stage+' interrupted · reconnecting…');
   },
   onTranscript:words=>{
     if(words){const live=document.querySelector('#decision-live-speech');live.textContent='Heard “'+words+'”';if(!activeTurn&&!busy&&!applying&&speechPending)listen(live.textContent);}
    }
   });
   if(speechDecision)speechDecisions.set(d.id,speechDecision);
   store.log('decision.speech.timing',{audioId:d.id,...timings});
   return text;
  });
 });

 $('#decision-inspect').onclick=async()=>{const id=pending?.id||[...cases].reverse().find(c=>c.asset)?.id;if(!id)return;try{const trace=await studio.decisionRequest('decision-inspect',{id}),refinement=pending?.refinement||[...cases].reverse().find(c=>c.id===id)?.refinement,second=refinement?.id?await studio.decisionRequest('refinement-inspect',{fitId:id,requestId:refinement.id}):null,images=$('#decision-input-images');images.replaceChildren();const seen=new Set();for(const part of [...trace.request.input.flatMap(m=>m.content||[]),...(second?.request?.input||[]).flatMap(m=>m.content||[])])if(part.type==='input_image'&&!seen.has(part.image_url)){seen.add(part.image_url);const img=document.createElement('img');img.src=part.image_url;img.alt='Image sent to the decision model';img.style.width='100%';images.append(img);}$('#decision-wire').textContent=JSON.stringify(second?{fitting:trace,refinement:second}:trace,(k,v)=>k==='image_url'?'[shown above]':v,2);}catch(e){$('#decision-wire').textContent=e.message;}};

 $('#decision-export').onclick=async()=>{const records=await Promise.all(cases.map(async c=>{const saved=c.asset?await store.get('assets',[store.session.id,c.asset]):null;return {...c,case:saved?JSON.parse(await saved.blob.text()):null};}));download(new Blob([JSON.stringify({schema:'draw3d.decision-tests.v1',sessionId:store.session.id,records},null,2)],{type:'application/json'}),'sketch-test-cases.json');};

 const url=new URL(location.href);url.search='';url.searchParams.set('session',store.session.id);url.searchParams.set('projectStore','draw3d-decision-lab');$('#decision-agent').href=url.href;

 const fixtureId=new URL(location.href).searchParams.get('fixture');

 if(fixtureId&&!store.session.strokes.length&&!studio.desktopDrawing.summary().length){

  try{const fixtureSet=new URL(location.href).searchParams.get('fixtureSet'),fixtureURL=fixtureSet==='cad-robustness-v2'?'/benchmarks/cad-robustness-v2/fixtures/'+encodeURIComponent(fixtureId)+'.json':'/benchmarks/decision-images-v1/cases.json',fixture=await (await fetch(fixtureURL)).json(),c=fixture.cases.find(c=>c.id===fixtureId);if(!c)throw Error('Unknown test sketch');$('#decision-auto').checked=false;

   const plane=structuredClone(studio.desktopPlane);for(const s of c.strokes){const stroke={...s,id:crypto.randomUUID(),drawingPlane:plane,plane,points:s.points.map(p=>{const from=c.plane||{origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0]},uv=[from.xAxis,from.yAxis].map(a=>a.reduce((n,v,k)=>n+(p[k]-from.origin[k])*v,0));return plane.origin.map((v,k)=>v+uv[0]*plane.xAxis[k]+uv[1]*plane.yAxis[k]);}),radius:.0005,color:'#8cbcff'};store.session.strokes.push(stroke);studio.addStrokeMesh(stroke);}store.session.generatedExample={caseId:c.id,source:fixture.source};store.session.revision++;store.log('decision.fixture.loaded',{id:c.id});await store.flush();document.querySelector('#desktop-fit').click();status.textContent='Generated sketch loaded · click Preview to fit it.';

  }catch(e){status.textContent='Could not load test sketch: '+e.message;}

 }

 if(!fixtureId&&store.session.decisionInterpretationRevision!==3){store.session.decisionInterpretationRevision=3;await store.flush();if(store.session.strokes.some(s=>!s.hidden&&s.points.length>=2)&&$('#decision-auto').checked)queue();}

 window.addEventListener('pagehide',()=>{progress.stop();refinementAbort?.abort();clearTimeout(timer);stopAutoAccept();observer.disconnect();recoveryObserver.disconnect();resize.disconnect();studio.desktopPreviewStrokeIds=null;},{once:true});studio.decisionLab={fit,get autoPreview(){return $('#decision-auto').checked;},submitInstruction:(words,source='typed')=>receiveInstruction(words,source),accept:acceptPending,discardPending:()=>discard.onclick(),async acceptForEditing(){if(pending&&!busy&&!applying&&!pending.refinement?.question&&pending.refinement?.state!=='failed')await acceptPending();return !pending;},pauseAutoAccept:()=>stopAutoAccept({pause:true}),get applying(){return applying;},invalidate(message='Drawing changed'){lastInvalidation=message;refinementAbort?.abort();generation++;clearTimeout(timer);clear();queued=false;status.textContent=message;},get busy(){return busy||applying;},get pending(){return pending;}};partUI=initPartWorkspace({studio,store,card});const recoveryObserver=new MutationObserver(sync);recoveryObserver.observe($('#desktop-preview-accept'),{attributes:true,attributeFilter:['disabled']});recoveryObserver.observe($('#cad-feature-tree'),{childList:true});partUI.create.onclick=async()=>{
  if(busy||applying||speechPending||placementRequest)return;
  publishTypedInput();const words=text().trim();
  if(!words&&((store.session.desktopSolids||[]).length||studio.surfaceModels?.().some(m=>!m.hidden))){status.textContent='Describe or sketch the next change to your model.';$('#decision-instruction').focus();return;}
  buildPressed=true;receiveInstruction(words||'Create the next editable 3D part from the current sketch. Preserve existing work and ask about essential missing design choices.','typed');
 };
 partUI.retryVoice.onclick=()=>{
  if(!failedSpeech)return;
  const {id,getWords,binding,capture}=failedSpeech;
  failedSpeech=null;partUI.retryVoice.hidden=true;
  listen('Retrying saved instruction…');processSpeech(id,getWords,binding,capture);
 };partUI.solidify.onclick=()=>void solidify();sync();document.body.dataset.decisionReady='true';

}

