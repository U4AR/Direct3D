import {previewSettings} from './part-workspace-controls.mjs';
import {readFile} from 'node:fs/promises';
import {test,expect} from '@playwright/test';
import {buildDecisionRequest,fitDecisionResponse} from '../scripts/decision-sketch-api.mjs';
import {expandRefinement} from '../scripts/sketch-refinement.mjs';
import {operation,fixture} from './sketch-refinement-fixture.mjs';
async function load(page){await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.refineTest=e.detail));await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('http://127.0.0.1:5191/desktop.html?experiment=decision&session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true',{timeout:45000});await page.evaluate(()=>{for(const id of ['decision-auto','decision-auto-accept']){const option=document.getElementById(id);if(option.checked)option.click();}});await expect(page.locator('#decision-refine')).toBeChecked();}
function fitPacket(data,kind='circle'){const{body,groups}=buildDecisionRequest(data);return {saved:{data,body},fit:{...fitDecisionResponse(data,groups,{answers:body.questions.map(q=>({type:'choice',name:q.name,choice:q.name==='drawing_representation'?'curves':q.name.endsWith('.role')?'geometry':q.name.endsWith('.primitive')?kind:q.name.endsWith('.closure')?'closed':q.name.endsWith('.symmetry')?'both':q.name.endsWith('.alignment')?'drawn':q.name.endsWith('.intent')?'regularized_outline':q.choices[0].value}))}),id:crypto.randomUUID(),cost:{usd:0,usageKnown:true},timings:{totalMs:1}}};}
async function injectRing(page){await page.evaluate(()=>{const{studio,store}=refineTest,p=studio.desktopPlane,s={id:crypto.randomUUID(),points:Array.from({length:81},(_,i)=>p.origin.map((v,k)=>v+.05*Math.cos(i*Math.PI/40)*p.xAxis[k]+.05*Math.sin(i*Math.PI/40)*p.yAxis[k])),drawingPlane:p,radius:.0006,color:'#80aaff'};store.session.strokes.push(s);studio.addStrokeMesh(s);});}
test('noise-only input skips the second model call',async({page})=>{let secondCalls=0;await page.route('**/api/agent/sketch-decisions?*',async r=>{const data=r.request().postDataJSON(),{body,groups}=buildDecisionRequest(data),result=fitDecisionResponse(data,groups,{answers:body.questions.map(q=>({type:'choice',name:q.name,choice:q.name.endsWith('.role')?'accidental':q.choices[0].value}))});await r.fulfill({json:{...result,id:crypto.randomUUID(),cost:{usd:0,usageKnown:true},timings:{totalMs:1}}});});await page.route('**/api/agent/sketch-refine?*',r=>{secondCalls++;return r.fulfill({json:{error:'Should not run'}});});await page.route('**/api/agent/decision-preview?*',r=>r.fulfill({json:{saved:true}}));await load(page);await injectRing(page);await previewSettings(page,()=>page.locator('#decision-fit').click());await expect(page.locator('#decision-status')).toContainText('Ignored stray strokes');expect(secondCalls).toBe(0);await expect(page.locator('#decision-accept')).toBeDisabled();});
test('new drawing input cancels an obsolete second-stage request',async({page})=>{let input,started=false,release;const gate=new Promise(r=>release=r);await page.route('**/api/agent/sketch-decisions?*',async r=>{input=fitPacket(r.request().postDataJSON());await r.fulfill({json:input.fit});});await page.route('**/api/agent/sketch-refine?*',async r=>{started=true;await gate;try{await r.fulfill({json:input.fit});}catch{}});await page.route('**/api/agent/decision-preview?*',r=>r.fulfill({json:{saved:true}}));await load(page);await injectRing(page);await previewSettings(page,()=>page.locator('#decision-fit').click());await expect.poll(()=>started).toBe(true);await page.evaluate(()=>refineTest.store.log('stroke.begin',{id:'new-input'}));await expect.poll(()=>page.evaluate(()=>refineTest.studio.decisionLab.busy)).toBe(false);await expect(page.locator('#decision-accept')).toBeDisabled();expect(await page.evaluate(()=>refineTest.studio.desktopDrawing.summary().length)).toBe(0);release();});
test('two-stage preview waits for the instruction edit, then accepts one modified native figure',async({page})=>{let input,release,started;const gate=new Promise(r=>release=r);await page.route('**/api/agent/sketch-decisions?*',async r=>{input=fitPacket(r.request().postDataJSON());await r.fulfill({json:input.fit});});await page.route('**/api/agent/sketch-refine?*',async r=>{expect(r.request().postDataJSON().fitId).toBe(input.fit.id);started=true;await gate;const result=expandRefinement({summary:'Set diameter to 120 mm',question:null,operations:[operation('g0',{dimensions:{radiusMetres:.06,widthMetres:null,heightMetres:null,extrusionMetres:null}})],additions:[]},input.saved,input.fit);result.refinement={...result.refinement,id:crypto.randomUUID(),model:'gpt-6.1-terra',reasoning:'none'};await r.fulfill({json:result});});for(const route of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+route+'?*',r=>r.fulfill({json:{saved:true}}));await load(page);await injectRing(page);await page.locator('#decision-instruction').fill('Set circle diameter to 120 mm');await previewSettings(page,()=>page.locator('#decision-fit').click());await expect.poll(()=>!!started).toBe(true);await expect(page.locator('#decision-accept')).toBeDisabled();expect(await page.evaluate(()=>refineTest.studio.desktopDrawing.summary().length)).toBe(0);release();await expect(page.locator('#decision-accept')).toBeEnabled();expect(await page.evaluate(()=>refineTest.studio.decisionLab.pending.edits[0].radiusMetres)).toBe(.06);await page.locator('#decision-preview-accept').click();await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:60000});expect(await page.evaluate(()=>refineTest.studio.desktopDrawing.summary()[0].radiusMetres)).toBe(.06);});
for(const keep of [false,true])test('projected circle '+(keep?'can stay on its source plane':'is accepted on its own new plane')+', with source capture unchanged',async({page})=>{let input;await page.route('**/api/agent/sketch-decisions?*',async r=>{input=fitPacket(r.request().postDataJSON(),'ellipse');await r.fulfill({json:input.fit});});await page.route('**/api/agent/sketch-refine?*',async r=>{if(input.saved.data.strokes.some(s=>s.drawingTarget?.placementChoice==='keep'))return r.fulfill({json:input.fit});const result=expandRefinement({summary:'Circle on offset view plane',question:null,operations:[operation('g0',{action:'project',projection:{base:'view',planeId:null,offsetMetres:.1,throughOrigin:true,representation:'circle',closed:true}})],additions:[]},input.saved,input.fit);result.refinement={...result.refinement,id:crypto.randomUUID(),model:'gpt-6.1-terra',reasoning:'none'};await r.fulfill({json:result});});for(const route of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+route+'?*',r=>r.fulfill({json:{saved:true}}));await load(page);const f=fixture({tilted:true}),base=[0,1.15,-.6];f.saved.data.plane={...f.saved.data.plane,id:'tilted-capture',name:'Tilted capture',origin:base};f.saved.data.strokes[0].points=f.saved.data.strokes[0].points.map(p=>p.map((v,k)=>v+base[k]));f.saved.data.strokes[0].view.cameraToWorld=f.saved.data.strokes[0].view.cameraToWorld.map((v,i)=>i>=12&&i<=14?v+base[i-12]:v);await page.evaluate(data=>{const{studio,store}=refineTest;store.session.desktopPlanes.push(data.plane);studio.setDesktopPlane(data.plane);const sketch=studio.desktopSketches.ensure(data.plane),s={...data.strokes[0],desktopSketchId:sketch.id,drawingPlane:data.plane,plane:data.plane,radius:.0006,color:'#80aaff'};store.session.strokes.push(s);studio.addStrokeMesh(s);},f.saved.data);await previewSettings(page,()=>page.locator('#decision-fit').click());await expect(page.locator('#decision-plane-choice')).toBeVisible();await expect(page.locator('#decision-accept')).toBeDisabled();await page.waitForTimeout(2200);expect(await page.evaluate(()=>refineTest.studio.desktopDrawing.summary().length)).toBe(0);const projected=await page.evaluate(()=>refineTest.studio.decisionLab.pending.edits[0]);expect(projected.kind).toBe('circle');expect(projected.origin[2]).toBeCloseTo(-.5,6);await page.locator(keep?'#decision-plane-choice [data-plane="keep"]':'#decision-plane-choice [data-plane="different"]').click();if(keep){await expect(page.locator('#decision-accept')).toBeEnabled();await page.locator('#decision-preview-accept').click();}await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:60000});const result=await page.evaluate(()=>({figures:refineTest.studio.desktopDrawing.summary(),sketches:refineTest.studio.desktopSketches.catalog(),planes:refineTest.store.session.desktopPlanes}));expect(result.figures).toHaveLength(1);const out=result.figures[0];expect(out.planeId).toBe(keep?'tilted-capture':projected.planeId);expect(result.sketches.find(s=>s.id===out.desktopSketchId).plane.id).toBe(out.planeId);expect(result.planes.find(p=>p.id==='tilted-capture').origin).toEqual(base);});
test('edge-on drawing is blocked and View plane through origin enables safe drawing',async({page})=>{await load(page);const center=await page.evaluate(()=>{const{studio}=refineTest;studio.planeEditor.choose('plane-front');studio.desktopDrawing.setMode('pen');const p=studio.desktopPlane;studio.controls.target.fromArray(p.origin);studio.camera.position.set(p.origin[0]+1,p.origin[1],p.origin[2]);studio.camera.lookAt(...p.origin);studio.camera.updateMatrixWorld(true);studio.controls.update();const r=studio.renderer.domElement.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];});await page.mouse.move(...center);await page.mouse.down();await page.mouse.move(center[0]+30,center[1]+10);await page.mouse.up();expect(await page.evaluate(()=>refineTest.store.session.strokes.length)).toBe(0);await expect(page.locator('#cad-plane-status')).toContainText('edge-on');await page.locator('#desktop-view-plane').click();await expect(page.locator('#cad-plane-status')).toContainText('View-aligned plane');const p=await page.evaluate(()=>refineTest.studio.desktopPlane);expect(p.origin).toEqual([0,1.15,-.6]);expect(Math.abs(p.normal[0])).toBeCloseTo(1,6);await page.mouse.move(...center);await page.mouse.down();await page.mouse.move(center[0]+35,center[1]+15,{steps:8});await page.mouse.up();await expect.poll(()=>page.evaluate(()=>refineTest.store.session.strokes.length)).toBe(1);expect(await page.evaluate(()=>!!refineTest.store.session.decisionDrawingView?.asset)).toBe(true);});
test('live fitted circle goes through Terra none, inspector and native acceptance',async({page})=>{test.setTimeout(150000);await load(page);await injectRing(page);await page.locator('#decision-instruction').fill('Set the circle diameter to 120 mm. Keep its current plane and center.');const started=Date.now();await previewSettings(page,()=>page.locator('#decision-fit').click());await expect(page.locator('#decision-accept')).toBeEnabled({timeout:110000});const report=await page.evaluate(()=>{const r=refineTest.studio.decisionLab.pending;return {radius:r.edits[0].radiusMetres,refinement:r.refinement,cost:r.cost};});expect(report.radius).toBeCloseTo(.06,8);expect(report.refinement.model).toBe('gpt-6.1-terra');expect(report.refinement.reasoning).toBe('none');expect(report.refinement.usage.output_tokens_details.reasoning_tokens).toBe(0);await page.getByText('Model input & output',{exact:true}).click();await page.locator('#decision-inspect').click();await expect(page.locator('#decision-wire')).toContainText('gpt-6.1-terra');await expect(page.locator('#decision-wire')).toContainText('fittedReferences');await page.locator('#decision-preview-accept').click();await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:60000});expect(await page.evaluate(()=>refineTest.studio.desktopDrawing.summary()[0].radiusMetres)).toBeCloseTo(.06,8);console.log('TERRA_FIT_PIPELINE',JSON.stringify({visibleAndAcceptedMs:Date.now()-started,report}));});


test('recorded oblique drawing accepts two circular sections on distinct parallel native sketch planes',async({page})=>{test.skip(!process.env.DRAW3D_DEPTH_REPLAY_DIR,'Opt-in private recorded regression');const root=process.env.DRAW3D_DEPTH_REPLAY_DIR,saved=JSON.parse(await readFile(root+'/request.json','utf8')),initial=JSON.parse(await readFile(root+'/initial.json','utf8')),result=JSON.parse(await readFile(root+'/result.json','utf8'));await page.route('**/api/agent/sketch-decisions?*',r=>r.fulfill({json:initial}));await page.route('**/api/agent/sketch-refine?*',r=>r.fulfill({json:result}));for(const endpoint of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+endpoint+'?*',r=>r.fulfill({json:{saved:true}}));await load(page);await page.evaluate(data=>{const{studio,store}=refineTest;studio.planeEditor.choose(data.plane.id);for(const s of data.strokes){const raw={...s,drawingPlane:s.plane||data.plane,radius:.0006,color:'#80aaff'};store.session.strokes.push(raw);studio.addStrokeMesh(raw);}studio.camera.matrix.fromArray(data.view.cameraToWorld);studio.camera.matrix.decompose(studio.camera.position,studio.camera.quaternion,studio.camera.scale);studio.camera.updateMatrixWorld(true);studio.controls.target.fromArray(data.designOrigin);studio.controls.update();},saved.data);await previewSettings(page,()=>page.locator('#decision-fit').click());await expect(page.locator('#decision-accept')).toBeEnabled();await page.locator('#decision-preview-accept').click();await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:60000});const fs=await page.evaluate(()=>refineTest.studio.desktopDrawing.summary());expect(fs).toHaveLength(2);expect(fs.every(f=>f.kind==='circle')).toBe(true);expect(fs[1].origin[1]-fs[0].origin[1]).toBeCloseTo(.025,7);expect(fs[1].planeId).not.toBe(fs[0].planeId);expect(fs[1].desktopSketchId).not.toBe(fs[0].desktopSketchId);expect(fs[1].sketchId).not.toBe(fs[0].sketchId);});

test('multi-body preview rolls back a missed pocket, reports it, and builds the corrected linked features',async({page})=>{
 test.setTimeout(180000);
 let packet,feedback;
 await page.route('**/api/agent/sketch-decisions?*',route=>{
  packet=fitPacket(route.request().postDataJSON());return route.fulfill({json:packet.fit});
 });
 await page.route('**/api/agent/sketch-refine?*',route=>{
  const {cadFailure}=route.request().postDataJSON();
  if(cadFailure)feedback=cadFailure;
  const base=packet.fit.edits[0];
  const at=u=>base.origin.map((v,i)=>v+u*base.xAxis[i]);
  const rectangle=(name,u,w,h)=>({...base,name,kind:'rectangle',origin:at(u),radiusMetres:null,widthMetres:w,heightMetres:h,segments:null,closed:true});
  const additions=[rectangle('Base',0,.1,.08),rectangle('Tab',.055,.05,.03),
   {...base,kind:'circle',closed:true,radiusMetres:.009,widthMetres:null,heightMetres:null,segments:null,name:'Bore',origin:at(cadFailure?0:.5)}];
  const feature=(id,operation,sketch,target=null,toolBody=null)=>({id,name:id,operation,sketch,target,toolBody,extent:'forward',depthMetres:.02});
  const plan={summary:'Plate with an attached tab and a bore',question:null,operations:[],additions,
   featurePlan:{sketches:[],features:[feature('Plate','new-body','added:0'),feature('Tab solid','new-body','added:1'),
    feature('Join tab','join',null,'Plate','Tab solid'),feature('Bore cut','cut','added:2','Join tab')]}};
  const r=expandRefinement(plan,packet.saved,packet.fit);
  r.refinement.id=crypto.randomUUID();
  return route.fulfill({json:{...r,solidAuthorization:'build'}});
 });
 for(const name of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+name+'?*',r=>r.fulfill({json:{saved:true}}));
 await load(page);await injectRing(page);await page.evaluate(()=>refineTest.studio.decisionLab.submitInstruction('Build a plate with a joined tab and bore'));
 await expect(page.locator('#decision-status')).toContainText('Preview ready',{timeout:140000});
 expect(feedback.reason).toMatch(/material|overlap/i);
 const before=await page.evaluate(()=>{
  const d=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document();
  return {bodies:d.derived.exportableBodyIds.map(id=>d.derived.bodyRepresentations[id].volume),features:refineTest.store.session.desktopSolids.map(s=>s.kind)};
 });
 expect(before.features).toEqual(['extrude','extrude','join-material','pocket']);expect(before.bodies).toHaveLength(1);
 const expected=100*80*20+30*30*20-Math.PI*9*9*20;
 expect(Math.abs(before.bodies[0]-expected)/expected).toBeLessThan(.001);
 await page.getByRole('button',{name:'Solidify',exact:true}).click();await expect.poll(()=>page.evaluate(()=>refineTest.store.session.decisionPartStep?.solidIds?.length)).toBe(4);
});

test('desktop inspection during a pending model edit preserves the input view and the new camera pose',async({page})=>{
 let packet,modelStarted,releaseModel;
 const sent=new Promise(resolve=>{modelStarted=resolve}),hold=new Promise(resolve=>{releaseModel=resolve});
 await page.route('**/api/agent/sketch-decisions?*',route=>{
  packet=fitPacket(route.request().postDataJSON());return route.fulfill({json:packet.fit});
 });
 await page.route('**/api/agent/sketch-refine?*',async route=>{
  modelStarted();await hold;
  const r=expandRefinement({summary:'Extruded circle',question:null,operations:[],additions:[],solidEdits:[
   {name:'Round boss',kind:'extrude',loftMode:'ruled',profiles:[{figureId:'fit:'+packet.fit.results[0].id,expectedVersion:1,depthMetres:.02,backDepthMetres:null}]}]},packet.saved,packet.fit);
  return route.fulfill({json:{...r,solidAuthorization:'build'}});
 });
 let staleReason;
 await page.route('**/api/agent/decision-preview?*',r=>{const receipt=r.request().postDataJSON();if(receipt.state==='stale')staleReason=receipt.reason;return r.fulfill({json:{saved:true}});});
 await page.route('**/api/agent/decision-feedback?*',r=>r.fulfill({json:{saved:true}}));
 await load(page);await injectRing(page);
 const pose=()=>page.evaluate(()=>{const {camera,controls}=refineTest.studio;camera.updateMatrixWorld(true);return {matrix:camera.matrixWorld.toArray(),target:controls.target.toArray(),zoom:camera.zoom};});
 const start=await pose();
 await page.evaluate(()=>refineTest.studio.decisionLab.submitInstruction('Extrude this circle by 20 mm'));
 await sent;expect(packet.saved.data.view.cameraToWorld).toEqual(start.matrix);
 const center=await page.evaluate(()=>{const r=refineTest.studio.renderer.domElement.getBoundingClientRect();return [r.x+r.width*.55,r.y+r.height*.5];});
 await page.evaluate(()=>refineTest.studio.desktopMouse.cursor());
 await page.mouse.move(...center);await page.mouse.down({button:'middle'});await page.mouse.move(center[0]+64,center[1]-36,{steps:5});await page.mouse.up({button:'middle'});
 await page.keyboard.down('Control');await page.mouse.wheel(0,80);await page.keyboard.up('Control');await page.mouse.wheel(0,-110);
 await expect.poll(async()=>(await pose()).matrix).not.toEqual(start.matrix);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const inspected=await pose();releaseModel();
 await expect.poll(async()=>staleReason||await page.locator('#decision-status').textContent(),{timeout:30000}).toContain('Preview ready');
 expect(await pose()).toEqual(inspected);
 await page.getByRole('button',{name:'Solidify',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>refineTest.store.session.decisionPartStep?.solidIds?.length)).toBe(1);
 expect(await pose()).toEqual(inspected);
});

test('a spoken correction after discarding a preview keeps the request for the same drawing',async({page})=>{
 const packets=[];
 await page.route('**/api/agent/speech-decision?*',route=>route.fulfill({json:{choice:'modeling'}}));
 await page.route('**/api/agent/sketch-decisions?*',async route=>{
  const data=route.request().postDataJSON();packets.push(data);
  await route.fulfill({json:fitPacket(data).fit});
 });
 await page.route('**/api/agent/sketch-refine?*',route=>route.fulfill({json:fitPacket(packets.at(-1)).fit}));
 for(const name of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+name+'?*',r=>r.fulfill({json:{saved:true}}));
 await load(page);await injectRing(page);
 const speak=(id,text)=>page.evaluate(([id,text])=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id,text}})),[id,text]);
 await speak('scope','Create the main body from this outline.');
 await expect(page.locator('#decision-preview-discard')).toBeVisible();
 await page.locator('#decision-preview-discard').click();
 await expect(page.locator('#decision-status')).toContainText('discarded');
 await speak('correction','I meant an airplane.');
 await expect.poll(()=>packets.length).toBe(2);
 expect(packets[1].prompt).toContain('Create the main body');
 expect(packets[1].prompt).toContain('I meant an airplane.');
 expect(packets[1].speechInputs.map(s=>s.audioId)).toEqual(['scope','correction']);
 await expect(page.locator('#decision-preview-discard')).toBeVisible();
 await page.locator('#decision-preview-discard').click();
 await expect(page.locator('#decision-status')).toContainText('discarded');
 await speak('fresh','Move the sketch onto the top plane.');
 await expect.poll(()=>packets.length).toBe(3);
 expect(packets[2].prompt).toBe('Move the sketch onto the top plane.');
});
