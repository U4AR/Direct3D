import {previewSettings} from './part-workspace-controls.mjs';
import {readFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';
import {runExistingSketchEdit} from '../scripts/existing-sketch-edit.mjs';
import {buildDecisionRequest,fitDecisionResponse} from '../scripts/decision-sketch-api.mjs';
import {expandRefinement,withCreationReferences,refinementSchema} from '../scripts/sketch-refinement.mjs';
import {operation} from './sketch-refinement-fixture.mjs';
async function load(page){await page.route('**/api/agent/speech-decision?*',r=>r.fulfill({json:{choice:'modeling'}}));await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.speechEdit=e.detail));await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('http://127.0.0.1:5191/desktop.html?experiment=decision&session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true',{timeout:45000});await expect.poll(()=>page.evaluate(()=>speechEdit.studio.modelAgent.ready)).toBe(true);await previewSettings(page,()=>page.locator('#decision-auto').uncheck());}
async function oldProfile(page){return page.evaluate(async()=>{const{studio,store}=speechEdit;studio.planeEditor.choose('plane-top');const p=studio.desktopPlane,knots=[[-.05,-.04],[.06,-.04],[.05,.05],[-.05,.035]],segments=knots.map((a,i)=>{const b=knots[(i+1)%4];return [...a,...a.map((v,k)=>v+(b[k]-v)/3),...a.map((v,k)=>v+2*(b[k]-v)/3),...b];}),f=(await studio.desktopDrawing.dispatch('drawing_create',{kind:'spline',closed:true,name:'Existing profile',planeId:p.id,origin:p.origin,xAxis:p.xAxis,yAxis:p.yAxis,segments,strokeIds:['archived-original']})).figure;store.session.decisionSketches=[{figureId:f.id,kind:'profile',sourceStrokeIds:['archived-original'],constraints:{closed:true,symmetry:'none',lines:true,lineEdges:[0,1,2,3]}}];await store.flush();return f;});}
async function commandMock(page){const calls=[];process.env.OPENAI_API_KEY||='synthetic-test-only';process.env.SESSION_DIR='.runtime/speech-smoothing-review/browser-mocked';await page.route('**/api/agent/sketch-command?*',async r=>{const input=r.request().postDataJSON();calls.push(input);const result=await runExistingSketchEdit(input,{recordingId:'browser-synthetic',requestId:input.requestId,fetcher:async(url,options)=>{const b=JSON.parse(options.body),d=JSON.parse(b.input[0].content[0].text);
 if(url.endsWith('/decisions')){
  expect(d.currentUserTurn).toBe(input.userBuildInstruction);
  return {ok:true,json:async()=>({answers:[{name:'deliverable',type:'choice',choice:'sketch'},{name:'local_features',type:'choice',choice:'none'},{name:'solid_command',type:'choice',choice:'wait'}],usage:{input_tokens:80,output_tokens:3}})};
 }
 expect(d.userInstruction).toBe(input.prompt);expect(d.mode).toBe('edit-existing');return {ok:true,json:async()=>({status:'completed',usage:{input_tokens:100,output_tokens:20},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Smoothed with four reflection axes',question:null,operations:[operation('f0',{action:'regularize',regularization:{smooth:true,symmetry:'four'}})],additions:[]})}]}]})};}});await r.fulfill({json:result});});for(const name of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+name+'?*',r=>r.fulfill({json:{saved:true}}));return calls;}

test('recorded speech edits an accepted profile in place without any new ink or button press',async({page})=>{const calls=await commandMock(page);let transcriptions=0;await page.route('**/api/agent/concept-transcribe?*',r=>{transcriptions++;expect(r.request().postDataJSON().audioInputs[0].audio.length).toBeGreaterThan(0);return r.fulfill({json:{text:'Make this completely symmetrical in four axes. It should be completely rounded.'}});});await load(page);const original=await oldProfile(page);await page.evaluate(async()=>{const{store}=speechEdit,name='audio/voice.wav';await store.asset(name,new Blob(['synthetic recorded audio'],{type:'audio/wav'}));window.dispatchEvent(new CustomEvent('draw3d-speech-activity',{detail:{speaking:true}}));window.dispatchEvent(new CustomEvent('draw3d-speech-activity',{detail:{speaking:false}}));window.dispatchEvent(new CustomEvent('draw3d-audio-final',{detail:{id:'synthetic-speech',name}}));});await expect(page.locator('#decision-instruction')).toHaveValue(/four axes/);await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:45000});expect(transcriptions).toBe(1);expect(calls).toHaveLength(1);expect(calls[0].strokes).toHaveLength(0);expect(calls[0].source).toBe('speech');expect(calls[0].figures[0].id).toBe(original.id);const state=await page.evaluate(()=>({figures:speechEdit.studio.desktopDrawing.summary(),rules:speechEdit.store.session.decisionSketches,strokes:speechEdit.store.session.strokes,transcripts:speechEdit.store.session.transcripts}));expect(state.figures).toHaveLength(1);expect(state.figures[0].id).toBe(original.id);expect(state.figures[0].objectId).toBe(original.objectId);expect(state.figures[0].version).toBeGreaterThan(original.version);expect(state.figures[0].segments).not.toEqual(original.segments);expect(state.figures[0].strokeIds).toEqual(['archived-original']);expect(state.rules[0].constraints.smooth).toBe(true);expect(state.rules[0].constraints.reflectionAxes).toBe(4);expect(state.strokes).toHaveLength(0);expect(state.transcripts.at(-1).text).toMatch(/rounded/);});

test('typed correction edits the selected existing figure and preserves another figure',async({page})=>{const calls=await commandMock(page);await load(page);const original=await oldProfile(page),other=await page.evaluate(async id=>{const{studio}=speechEdit,p=studio.desktopPlane,other=(await studio.desktopDrawing.dispatch('drawing_create',{kind:'circle',name:'Leave alone',origin:[.2,p.origin[1],p.origin[2]],planeId:p.id,xAxis:p.xAxis,yAxis:p.yAxis,closed:true,radiusMetres:.02})).figure;studio.desktopEditing.setMode('cad');studio.desktopDrawing.select(id);return other;},original.id);await page.locator('#decision-instruction').fill('Make the selected profile smooth and symmetric on four axes.');await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:45000});expect(calls).toHaveLength(1);expect(calls[0].figures).toHaveLength(1);expect(calls[0].figures[0].id).toBe(original.id);const figures=await page.evaluate(()=>speechEdit.studio.desktopDrawing.summary());expect(figures).toHaveLength(2);expect(figures.find(f=>f.id===other.id).version).toBe(other.version);expect(figures.find(f=>f.id===other.id).radiusMetres).toBe(other.radiusMetres);});

test('speech starting during the acceptance countdown pauses it until the spoken correction is processed',async({page})=>{let latest,requests=[];await page.route('**/api/agent/sketch-decisions?*',async r=>{const data=r.request().postDataJSON();requests.push(data.prompt);const{body,groups}=buildDecisionRequest(data);latest={saved:{data,body},fit:{...fitDecisionResponse(data,groups,{answers:body.questions.map(q=>({type:'choice',name:q.name,choice:q.name.endsWith('.role')?'geometry':q.name.endsWith('.primitive')?'circle':q.name.endsWith('.closure')?'closed':q.name.endsWith('.symmetry')?'both':q.name.endsWith('.alignment')?'drawn':q.name.endsWith('.intent')?'regularized_outline':q.choices[0].value}))}),id:crypto.randomUUID(),cost:{usd:0,usageKnown:true},timings:{totalMs:1}}};await r.fulfill({json:latest.fit});});await page.route('**/api/agent/sketch-refine?*',async r=>{const change=latest.saved.data.prompt?{radiusMetres:.06,widthMetres:null,heightMetres:null,extrusionMetres:null}:null,result=expandRefinement({summary:change?'Diameter updated':'Original circle',question:null,operations:change?[operation('g0',{dimensions:change})]:[],additions:[]},latest.saved,latest.fit);await r.fulfill({json:result});});for(const name of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+name+'?*',r=>r.fulfill({json:{saved:true}}));await load(page);await page.evaluate(()=>{const{store,studio}=speechEdit,p=studio.desktopPlane,s={id:crypto.randomUUID(),drawingPlane:p,radius:.0006,color:'#80aaff',points:Array.from({length:81},(_,i)=>p.origin.map((v,k)=>v+.04*Math.cos(i*Math.PI/40)*p.xAxis[k]+.04*Math.sin(i*Math.PI/40)*p.yAxis[k]))};store.session.strokes.push(s);studio.addStrokeMesh(s);});await previewSettings(page,()=>page.locator('#decision-fit').click());await expect(page.locator('#decision-hold')).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new CustomEvent('draw3d-speech-activity',{detail:{speaking:true}})));await page.waitForTimeout(2400);expect(await page.evaluate(()=>speechEdit.studio.desktopDrawing.summary().length)).toBe(0);await expect(page.locator('#decision-accept')).toBeDisabled();await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('draw3d-speech-activity',{detail:{speaking:false}}));window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'speech-diameter',text:'Make the diameter 120 mm.'}}));});await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:45000});expect(requests).toEqual(['','Make the diameter 120 mm.']);expect(await page.evaluate(()=>speechEdit.studio.desktopDrawing.summary()[0].radiusMetres)).toBe(.06);});


test('logged drawing and actual spoken correction publish smooth four-axis native geometry in place',async({page})=>{test.skip(!process.env.DRAW3D_SPEECH_REPLAY_DIR,'Opt-in private replay');const root=process.env.DRAW3D_SPEECH_REPLAY_DIR,input=JSON.parse(await readFile(root+'/input.json','utf8')),recorded=JSON.parse(await readFile(root+'/result.json','utf8'));let original;
 await page.route('**/api/agent/sketch-command?*',async r=>{const data=r.request().postDataJSON();expect(data.prompt).toBe(input.prompt);const out=structuredClone(recorded);out.instructionTargets=[{id:original.id,version:original.version}];out.edits.forEach(e=>{e.figureId=original.id;e.expectedVersion=original.version;});await r.fulfill({json:out});});for(const name of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+name+'?*',r=>r.fulfill({json:{saved:true}}));await load(page);original=await page.evaluate(async data=>{const{studio,store}=speechEdit;for(const p of data.referencePlanes||[])if(!store.session.desktopPlanes.some(q=>q.id===p.id))store.session.desktopPlanes.push(p);studio.planeEditor.choose(data.plane.id);const args={...data.figures[0]};delete args.operation;delete args.figureId;delete args.expectedVersion;const f=(await studio.desktopDrawing.dispatch('drawing_create',args)).figure;store.session.decisionSketches=data.constraints.map(c=>({...c,figureId:f.id}));await store.flush();return f;},input);await page.evaluate(text=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'recorded-replay',text}})),input.prompt);await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:45000});const out=await page.evaluate(()=>{const{studio,store}=speechEdit,f=studio.desktopDrawing.summary()[0],doc=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document();return {figure:f,count:studio.desktopDrawing.summary().length,native:doc.nodes[f.objectId].data,rules:store.session.decisionSketches[0].constraints};});expect(out.count).toBe(1);expect(out.figure.id).toBe(original.id);expect(out.figure.objectId).toBe(original.objectId);expect(out.native.segments).toHaveLength(16);expect(out.rules.smooth).toBe(true);expect(out.rules.reflectionAxes).toBe(4);expect(out.figure.planeId).toBe(original.planeId);});
test('two overlapping voice clips steer a single edit in recording order',async({page})=>{
 const calls=await commandMock(page);await load(page);const original=await oldProfile(page);
 const transcripts=['Smooth the outline.','Make it symmetric on four axes.'];
 let secondStarted;
 const overlap=new Promise(resolve=>secondStarted=resolve);
 await page.route('**/api/agent/concept-transcribe?*',async route=>{
  const index=Number(route.request().postDataJSON().audioId.slice(-1));
  if(!index)await overlap;else secondStarted();
  await route.fulfill({json:{text:transcripts[index]}});
 });
 await page.evaluate(async()=>{
  const {store}=speechEdit;
  for(const i of [0,1]){
   const detail={id:'ordered-'+i,name:'audio/ordered-'+i+'.wav'};
   await store.asset(detail.name,new Blob(['test'],{type:'audio/wav'}));
   window.dispatchEvent(new CustomEvent('draw3d-speech-activity',{detail:{speaking:true}}));
   window.dispatchEvent(new CustomEvent('draw3d-audio-final',{detail}));
   window.dispatchEvent(new CustomEvent('draw3d-audio-final',{detail}));
  }
 });
 await expect.poll(()=>page.evaluate(()=>speechEdit.store.session.decisionCases.filter(c=>c.feedback.some(f=>f.verdict==='accepted')).length),{timeout:45000}).toBe(1);
 expect(calls.at(-1).prompt).toBe(transcripts.join('\nUpdate: '));
 expect(calls.at(-1).speechInputs.map(s=>[s.audioId,s.text])).toEqual(transcripts.map((words,i)=>['ordered-'+i,words]));
 expect(calls.at(-1).figures[0].id).toBe(original.id);
 expect(calls.at(-1).figures[0].version).toBe(original.version);
 expect(await page.evaluate(()=>speechEdit.store.session.transcripts.filter(t=>t.id.startsWith('ordered-')).length)).toBe(2);
});
for(const angle of [50,89])test('freehand at '+angle+' degrees reaches AI with the original view and prior sketch',async({page})=>{
 await load(page);const prior=await oldProfile(page);const calls=[];
 await page.route('**/api/agent/sketch-decisions?*',route=>{calls.push(route.request().postDataJSON());return route.fulfill({status:503,json:{error:'End of capture test'}});});
 await previewSettings(page,()=>page.locator('#decision-auto').check());
 await page.evaluate(angle=>{
  const {studio}=speechEdit;studio.planeView.editPlane('plane-top');
  const center=studio.controls.target,theta=angle*Math.PI/180;
  studio.camera.position.set(center.x,center.y+2*Math.cos(theta),center.z+2*Math.sin(theta));studio.camera.up.set(0,Math.sin(theta),-Math.cos(theta));
  studio.camera.lookAt(center);studio.controls.update();studio.camera.updateMatrixWorld(true);
 },angle);
 const before=await page.evaluate(()=>speechEdit.store.session.desktopPlanes.length);
 const b=await page.locator('#viewport canvas').boundingBox(),x=b.x+b.width*.45,y=b.y+b.height*.55;
 await page.mouse.move(x-25,y+15);await page.mouse.down();await page.mouse.move(x+30,y-15,{steps:12});await page.mouse.up();
 await expect.poll(()=>calls.length,{timeout:10000}).toBe(1);
 const packet=calls[0],stroke=packet.strokes.at(-1);expect(stroke.points.length).toBeGreaterThan(2);
 expect(stroke.view.cameraToWorld).toHaveLength(16);expect(packet.references.some(r=>r.id===prior.id&&r.plane.id==='plane-top')).toBe(true);
 expect(Boolean(stroke.drawingTarget.captureOnly)).toBe(angle===89);
 expect(await page.evaluate(()=>speechEdit.store.session.desktopPlanes.length)).toBe(before);
 expect(await page.evaluate(()=>speechEdit.studio.desktopPlane.id)).toBe('plane-top');
});
test('microphone misfire resumes ink waiting for an automatic preview',async({page})=>{
 await load(page);await previewSettings(page,()=>page.locator('#decision-auto').check());
 let count=0;
 await page.route('**/api/agent/sketch-decisions?*',r=>{count++;return r.fulfill({status:503,json:{error:'End of capture test'}});});
 await page.evaluate(()=>{
  const {studio,store}=speechEdit,plane=studio.desktopPlane;
  const s={id:crypto.randomUUID(),points:[plane.origin,plane.origin.map((v,k)=>v+.02*plane.xAxis[k])],drawingPlane:plane,radius:.0005,color:'#80aaff'};
  store.session.strokes.push(s);studio.addStrokeMesh(s);store.log('stroke.end',{id:s.id});
  window.dispatchEvent(new CustomEvent('draw3d-speech-activity',{detail:{speaking:true}}));
  window.dispatchEvent(new Event('draw3d-speech-misfire'));
 });
 await expect.poll(()=>count).toBe(1);
});
test('desktop CAD queues follow-up speech while the first model request is in flight',async({page})=>{
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.directTest=e.detail));
 let release,run=null,stops=0;const sent=[],gate=new Promise(resolve=>release=resolve);
 const state=()=>({ready:true,model:'fixture',run});
 await page.route('**/api/agent/ai-status?*',r=>r.fulfill({json:state()}));
 await page.route('**/api/agent/poll?*',r=>r.fulfill({json:{job:null,ai:state()}}));
 await page.route('**/api/agent/ai-stop?*',r=>{stops++;return r.fulfill({json:state()});});
 await page.route('**/api/agent/desktop-edit?*',async r=>{
  sent.push(r.request().postDataJSON().prompt);run={id:'voice-'+sent.length,mode:'direct',state:'running',step:1,events:[]};
  if(sent.length===1)await gate;
  await r.fulfill({json:{...state(),edit:{summary:'Received instruction',assumptions:[],question:null,edits:[]}}});
 });
 await page.route('**/api/agent/desktop-applied?*',r=>{run={...run,state:'completed'};return r.fulfill({json:state()});});
 await page.goto('http://127.0.0.1:5191/desktop.html?session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});
 await expect(page.locator('body')).toHaveAttribute('data-desktop-ready','true');
 await expect.poll(()=>page.evaluate(()=>directTest.studio.modelAgent.ready)).toBe(true);
 await expect(page.locator('#ai-auto-speech')).toBeChecked();
 const speak=words=>page.evaluate(text=>{for(const speaking of [true,false])window.dispatchEvent(new CustomEvent('draw3d-speech-activity',{detail:{speaking}}));window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:crypto.randomUUID(),text,source:'browser-speech'}}));},words);
 await speak('Create the first profile.');await expect.poll(()=>sent.length,{timeout:10000}).toBe(1);
 await speak('Then round the corners.');await expect.poll(()=>page.evaluate(()=>directTest.studio.modelAgent.recoveryState.pending)).toBe(1);
 expect(stops).toBe(0);release();await expect.poll(()=>sent,{timeout:20000}).toEqual(['Create the first profile.','Then round the corners.']);
});

test('empty clips during a spoken raw-sketch extrusion preserve its single model result',async({page})=>{
 await load(page);await previewSettings(page,()=>page.locator('#decision-refine').uncheck());
 const raw=await page.evaluate(()=>{
  const {studio,store}=speechEdit,p=studio.desktopPlane,s={id:crypto.randomUUID(),drawingPlane:p,radius:.0006,color:'#80aaff',points:Array.from({length:65},(_,i)=>p.origin.map((v,k)=>v+.04*Math.cos(i*Math.PI/32)*p.xAxis[k]+.04*Math.sin(i*Math.PI/32)*p.yAxis[k]))};
  store.session.strokes.push(s);studio.addStrokeMesh(s);return s.id;
 });
 let fits=0,refinements=0,fit;
 await page.route('**/api/agent/sketch-decisions?*',async route=>{
  const data=route.request().postDataJSON();fits++;const {groups}=buildDecisionRequest(data);
  fit=fitDecisionResponse(data,groups,{answers:[{type:'choice',name:'g0.primitive',choice:'circle'},{type:'choice',name:'g0.closure',choice:'closed'}]});
  Object.assign(fit,{id:crypto.randomUUID(),cost:{usd:0,usageKnown:true},input:{},timings:{}});
  await route.fulfill({json:fit});
 });
 await page.route('**/api/agent/sketch-refine?*',async route=>{
  refinements++;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'empty',text:''}})));
  await route.fulfill({json:{...fit,solidAuthorization:'extrude',edits:fit.edits.map(e=>({...e,extrusionMetres:.02})),refinement:{summary:'Extrude 20 mm'}}});
 });
 for(const ep of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+ep+'?*',route=>route.fulfill({json:{saved:true}}));
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'extrusion',text:'Make this regular and extrude it.'}})));
 await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:20000});
 expect([fits,refinements]).toEqual([1,1]);
 const state=await page.evaluate(()=>({figures:speechEdit.studio.desktopDrawing.summary(),solids:speechEdit.store.session.desktopSolids}));
 expect(state.figures[0].strokeIds).toContain(raw);
 expect(state.solids[0].bodyId).toBe(state.figures[0].extrusion.bodyId);
});

test('combined transcription and intent result reaches the edit without a second filtering request',async({page})=>{
 const calls=await commandMock(page);await load(page);await oldProfile(page);
 let filters=0;
 await page.route('**/api/agent/speech-decision?*',route=>{filters++;return route.fulfill({status:500,json:{error:'Unexpected second filter'}});});
 await page.route('**/api/agent/concept-transcribe?*',route=>route.fulfill({json:{text:'Smooth the outline.',speechDecision:{choice:'modeling',confidence:1},timings:{transcriptionMs:200}}}));
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('draw3d-audio-final',{detail:{id:'combined-audio',blob:new Blob(['synthetic audio'])}})));
 await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:15000});
 expect(filters).toBe(0);expect(calls.map(c=>c.prompt)).toEqual(['Smooth the outline.']);
});

test('a newly fitted circle can be the source of a solid in the same turn',async({page})=>{
 await load(page);
 await page.evaluate(()=>{
  const {studio,store}=speechEdit,p=studio.desktopPlane;
  const stroke={id:'fresh-circle',drawingPlane:p,color:'#aabbcc',radius:.001,points:Array.from({length:65},(_,i)=>p.origin.map((v,k)=>v+.04*(Math.cos(i*Math.PI/32)*p.xAxis[k]+Math.sin(i*Math.PI/32)*p.yAxis[k])))};
  store.session.strokes.push(stroke);studio.addStrokeMesh(stroke);
 });
 let prepared;
 await page.route('**/api/agent/sketch-decisions?*',async route=>{
  const data=route.request().postDataJSON(),{groups,body}=buildDecisionRequest(data);
  const fit=fitDecisionResponse(data,groups,{answers:[{name:'g0.primitive',type:'choice',choice:'circle'},{name:'g0.closure',type:'choice',choice:'closed'}]});
  Object.assign(fit,{id:crypto.randomUUID(),cost:{usd:0,usageKnown:true},input:{},timings:{}});
  prepared=withCreationReferences({data,body},fit);await route.fulfill({json:fit});
 });
 await page.route('**/api/agent/sketch-refine?*',async route=>{
  const {saved,fit}=prepared,figureId=fit.solidReferences[0].figureId;
  expect(refinementSchema(fit).properties.solidEdits.items.properties.profiles.items.properties.figureId.enum).toContain(figureId);
  const plan={summary:'Extrude circle',question:null,operations:[],additions:[],solidEdits:[{kind:'extrude',loftMode:'ruled',name:'Cylinder',profiles:[{figureId,expectedVersion:1,depthMetres:.02,backDepthMetres:0}]}]};
  await route.fulfill({json:{...expandRefinement(plan,saved,fit),solidAuthorization:'extrude'}});
 });
 await page.locator('#decision-instruction').fill('Extrude this new drawing 20 mm.');
 await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:30000});
 const stored=await page.evaluate(()=>({solids:speechEdit.store.session.desktopSolids,figure:speechEdit.studio.desktopDrawing.summary()[0]}));
 expect(stored.solids).toHaveLength(1);expect(stored.solids[0].figureIds).toEqual([stored.figure.id]);
});
test('a correction can replace an unanswered model request before a preview exists',async({page})=>{
 const calls=await commandMock(page);await load(page);await oldProfile(page);
 let first,release;
 const waiting=new Promise(done=>release=done);
 await page.route('**/api/agent/sketch-command?*',async route=>{
  if(first)return route.fallback();
  first=route.request().postDataJSON();
  await waiting;await route.abort().catch(()=>{});
 });
 await page.locator('#decision-instruction').fill('Smooth the outline.');
 await expect.poll(()=>!!first).toBe(true);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'steer-plan',text:'Use four axes of symmetry.'}})));
 try{
  await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:20000});
  expect(calls).toHaveLength(1);
  expect(calls[0].supersedes).toBe(first.requestId);
  expect(calls[0].prompt).toBe('Smooth the outline.\nUpdate: Use four axes of symmetry.');
 }finally{release();}
});

test('retrying a saved voice clip after an outage uses the original view and applies one edit',async({page})=>{
 const calls=await commandMock(page);await load(page);await oldProfile(page);
 const requests=[];
 await page.route('**/api/agent/concept-transcribe?*',r=>{
  requests.push(r.request().postDataJSON());
  return r.fulfill(requests.length===1
   ?{contentType:'application/x-ndjson',body:JSON.stringify({error:'Transcription unavailable after 5 attempts (ECONNRESET)'})+'\n'}
   :{json:{text:'Smooth the outline.',speechDecision:{choice:'modeling'}}});
 });
 const original=await page.evaluate(()=>{
  const {studio}=speechEdit;studio.camera.updateMatrixWorld(true);
  const view=studio.camera.matrixWorld.toArray();
  window.dispatchEvent(new CustomEvent('draw3d-speech-activity',{detail:{speaking:true}}));
  window.dispatchEvent(new CustomEvent('draw3d-audio-final',{detail:{id:'outage-replay',blob:new Blob(['the same audio'],{type:'audio/wav'})}}));
  return view;
 });
 const retry=page.getByRole('button',{name:'Retry voice'});
 await expect(retry).toBeVisible();
 await page.evaluate(()=>{const {camera,controls}=speechEdit.studio;camera.position.x+=.2;controls.update();camera.updateMatrixWorld(true);});
 await retry.click();
 await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:45000});
 expect(requests).toHaveLength(2);
 expect(requests[1].audioInputs).toEqual(requests[0].audioInputs);
 expect(requests[1].audioId).toEqual(requests[0].audioId);
 expect(calls).toHaveLength(1);expect(calls[0].view.cameraToWorld).toEqual(original);
 await expect(retry).toBeHidden();
});

for(const automatic of [true,false])test((automatic?'automatic surface recovery':'manual retry')+' after a failed refinement keeps the same speech and ink',async({page})=>{
 await load(page);
 const words='Make this a circle.',calls=[];
 let fitted,attempt=0;
 await page.route('**/api/agent/sketch-decisions?*',async route=>{
  const d=route.request().postDataJSON();
  calls.push({words:d.prompt,audio:d.speechInputs.map(s=>s.audioId),strokes:d.strokes.map(s=>s.id)});
  const {groups}=buildDecisionRequest(d);
  fitted={...fitDecisionResponse(d,groups,{answers:[{type:'choice',name:'g0.primitive',choice:'circle'},{type:'choice',name:'g0.closure',choice:'closed'}]}),id:crypto.randomUUID(),cost:{usd:0,usageKnown:true},timings:{}};
  await route.fulfill({json:fitted});
 });
 await page.route('**/api/agent/sketch-refine?*',async route=>{
  if(++attempt===1)return route.fulfill({status:422,json:{error:automatic?'Surface inspection exceeded its bounded tool budget':'Test refinement failed'}});
  if(automatic)expect(route.request().postDataJSON().directRecovery).toBe(true);
  await route.fulfill({json:{...fitted,refinement:{summary:'Circle'}}});
 });
 for(const ep of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+ep+'?*',r=>r.fulfill({json:{saved:true}}));
 await page.evaluate(words=>{
  const {studio,store}=speechEdit,p=studio.desktopPlane;
  const s={id:'circle-ink',drawingPlane:p,radius:.0006,color:'#80aaff',started:10,ended:500,points:Array.from({length:65},(_,i)=>p.origin.map((v,k)=>v+.04*Math.cos(i*Math.PI/32)*p.xAxis[k]+.04*Math.sin(i*Math.PI/32)*p.yAxis[k]))};
  store.session.strokes.push(s);studio.addStrokeMesh(s);
  window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'circle-audio',text:words,start:50,end:450}}));
 },words);
 if(!automatic){
  await expect(page.locator('#decision-status')).toContainText('initial fit retained');
  await previewSettings(page,()=>page.locator('#decision-fit').click());
 }
 await expect.poll(()=>attempt).toBe(2);
 await expect(page.locator('#decision-status')).toContainText('Accepted');
 expect(calls).toEqual(Array.from({length:automatic?1:2},()=>({words,audio:['circle-audio'],strokes:['circle-ink']})));
});
