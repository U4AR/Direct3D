import {test,expect} from '@playwright/test';
test.afterEach(async({page})=>{await page.unrouteAll({behavior:'ignoreErrors'});});
const frame={center:[0,1,-.6],axes:[[1,0,0],[0,1,0],[0,0,1]],sizeMetres:[.2,.2,0]};
async function mockSequence(page,{interrupt=false}={}){
 let run,step=0,stopped=false;const requests=[],receipts=[];
 const info=()=>({ready:true,model:'gemini-3.8-flash',reasoning:'low',run});
 await page.route(/\/api\/agent\/(poll|ai-status)(\?|$)/,async route=>{await route.fulfill({json:route.request().url().includes('/poll')?{job:null,ai:info()}:info()});});
 await page.route(/\/api\/agent\/desktop-edit(\?|$)/,async route=>{
  const body=route.request().postDataJSON();requests.push(body);step++;const corrected=body.prompt?.includes('cylinder instead');
  run={id:corrected?'corrected-build':'visible-build',step:corrected?1:step,mode:'direct',state:'running',events:[],moveStartedAt:Date.now(),targetMoveMs:5000};const responseRun={...run};
  const kinds=['plane','circle3d','extrusion'];const kind=corrected?'cylinder':kinds[step-1];let parameters;
  if(kind==='plane')parameters=frame;
  if(kind==='circle3d')parameters={planeFigureId:body.evidence.figures.find(f=>f.kind==='plane').id,radiusMetres:.02};
  if(kind==='extrusion'){const profile=body.evidence.figures.find(f=>f.kind==='circle3d');parameters={profileFigureId:profile.id,profileVersion:profile.version,depthMetres:.1};}
  if(kind==='cylinder')parameters={center:[0,1,-.6],axes:frame.axes,radiusMetres:.02,heightMetres:.06};
  const done=corrected||step===4;
  const edit={summary:kind?'Create '+kind:'Inspected the completed extrusion.',assumptions:[],question:null,automation:corrected?null:{goal:'Make a cylinder visibly',reason:'User supervision',steps:kinds.map((label,i)=>({id:label,label,state:i<step?'completed':'pending'}))},continuation:done?null:{reason:'Inspect the applied result before the next operation',nextMove:step===1?'Draw a circle':step===2?'Extrude the circle':'Inspect final geometry'},edits:kind?[{operation:'create',figureId:null,expectedVersion:null,candidateId:null,kind,name:kind,parameters,strokeIds:[],dimensionNote:'Explicit user dimensions'}]:[]};
  if(interrupt&&step===2)await new Promise(r=>setTimeout(r,1200));else await new Promise(r=>setTimeout(r,150));
  await route.fulfill({json:{...info(),run:responseRun,edit}});
 });
 await page.route(/\/api\/agent\/desktop-applied(\?|$)/,async route=>{const body=route.request().postDataJSON();receipts.push(body);const more=!stopped&&run.id!=='corrected-build'&&step<4;run={...run,state:stopped?'stopped':more?'running':'completed',answer:'Construction applied',review:body.review};await route.fulfill({json:{...info(),continuation:more?{runId:run.id,previousTurn:run.step,requestedSketchIds:[],reason:'Next visible operation',nextMove:'Inspect and continue'}:null}});});
 await page.route(/\/api\/agent\/ai-stop(\?|$)/,async route=>{stopped=true;run={...run,state:'stopped'};await route.fulfill({json:info()});});
 return {requests,receipts};
}
async function setup(page){await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.rapidTest=e.detail));await page.goto('http://localhost:5173/?session='+crypto.randomUUID());await page.waitForFunction(()=>window.rapidTest?.studio.modelAgent?.ready);}
test('plane, sketch and extrusion are visible editable steps with receipts and fresh images at each model turn',async({page})=>{
 const {requests,receipts}=await mockSequence(page);await setup(page);
 await page.evaluate(()=>{window.buildPromise=window.rapidTest.studio.modelAgent.submitInstruction('Create a plane, sketch a circle, then extrude it.','typed');});
 await expect.poll(()=>requests.length).toBe(4);await expect(page.locator('#assistant-state')).toContainText('Done');
 const result=await page.evaluate(()=>({figures:window.rapidTest.store.session.spatialObjects,timeline:window.rapidTest.store.session.creationTimeline,planeOpacity:window.rapidTest.studio.surfaceModels().find(m=>m.parametricKind==='plane')?.mesh.material.opacity,canvas:!!window.rapidTest.studio.xrCreation}));
 expect(result.figures.map(f=>f.kind)).toEqual(['plane','circle3d','extrusion']);expect(result.timeline.filter(s=>s.phase==='applied').map(s=>s.kind)).toEqual(['plane','circle3d','extrusion']);expect(result.canvas).toBe(true);expect(result.planeOpacity).toBeLessThan(.3);
 for(let i=1;i<4;i++){expect(requests[i].evidence.figures.length).toBe(Math.min(i,3));expect(requests[i].evidence.frames.some(f=>f.layer==='spatial-front')).toBe(true);expect(requests[i].evidence.creationTimeline.some(s=>s.phase==='applied')).toBe(true);expect(receipts[i-1].review.operationTrace.length).toBeGreaterThan(0);}
 const profile=result.figures[1],solid=result.figures[2];expect(solid.parameters.profileFigureId).toBe(profile.id);expect(solid.parameters.depthMetres).toBe(.1);
});
test('speaking interrupts a build, discards a late response, and applies the correction instead of continuing',async({page})=>{
 const {requests}=await mockSequence(page,{interrupt:true});await setup(page);
 await page.evaluate(()=>{window.buildPromise=window.rapidTest.studio.modelAgent.submitInstruction('Create a plane, circle, and extrusion.','typed');});
 await expect.poll(()=>requests.length).toBe(2);
 expect(await page.evaluate(()=>window.rapidTest.studio.voicePanelAction({x:80/900,y:1-175/285}))).toBe('ai-stop');
 await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('draw3d-speech-activity',{detail:{speaking:true}}));window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:crypto.randomUUID(),text:'Keep the plane and create a cylinder instead, radius 20 mm, height 60 mm.',source:'browser-speech'}}));window.dispatchEvent(new CustomEvent('draw3d-speech-activity',{detail:{speaking:false}}));});
 await expect.poll(()=>page.evaluate(()=>window.rapidTest.store.session.spatialObjects.map(f=>f.kind)),{timeout:15000}).toEqual(['plane','cylinder']);
 expect(requests).toHaveLength(3);expect(requests[2].prompt).toContain('cylinder instead');expect(requests[2].continueRunId).toBeUndefined();
});


test('voice requests start without enabling stroke automation and voice pause/resume survive reload',async({page})=>{
 const {requests}=await mockSequence(page);await setup(page);
 await expect(page.locator('#ai-auto-speech')).toBeChecked();await expect(page.locator('#vr-enable-ai')).not.toBeChecked();
 const speak=text=>page.evaluate(text=>{const detail={id:crypto.randomUUID(),text,source:'browser-speech'};window.rapidTest.store.session.transcripts.push(detail);window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail}));},text);
 await speak('pause AI');await expect(page.locator('#ai-auto-speech')).not.toBeChecked();expect(requests).toHaveLength(0);
 await page.reload();await page.waitForFunction(()=>window.rapidTest?.studio.modelAgent?.ready);await expect(page.locator('#ai-auto-speech')).not.toBeChecked();
 await speak('resume AI');await expect(page.locator('#ai-auto-speech')).toBeChecked();
 // Drawing automation may be switched off without switching speech off.
 await page.locator('#vr-enable-ai').uncheck();await expect(page.locator('#ai-auto-speech')).toBeChecked();
 await speak('Create a plane, circle, and extrusion.');
 await expect.poll(()=>requests.length,{timeout:15000}).toBe(4);await expect(page.locator('#assistant-state')).toContainText('Done');
 await expect(page.locator('#vr-enable-ai')).not.toBeChecked();expect(await page.evaluate(()=>window.rapidTest.studio.agentState.canRun)).toBe(false);
 await speak('try again');await expect.poll(()=>requests.length,{timeout:15000}).toBe(5);expect(requests.at(-1).prompt).toBe('Create a plane, circle, and extrusion.');await expect(page.locator('#assistant-state')).toContainText('Done');
});
