import {injectGeometryMemoryFault} from './geometry-worker-fault.mjs';
import {previewSettings} from './part-workspace-controls.mjs';
import {test,expect} from '@playwright/test';
import {runExistingSketchEdit} from '../scripts/existing-sketch-edit.mjs';
async function load(page,{manual=false}={}){await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.solidTest=e.detail));await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('http://127.0.0.1:5191/desktop.html?experiment=decision&session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true',{timeout:45000});await expect.poll(()=>page.evaluate(()=>solidTest.studio.modelAgent.ready)).toBe(true);await previewSettings(page,async()=>{await page.locator('#decision-auto').uncheck();if(manual)await page.locator('#decision-auto-accept').uncheck();});}
async function profiles(page,kind='loft'){return page.evaluate(async kind=>{const{studio,store}=solidTest;studio.planeEditor.choose('plane-front');const base=structuredClone(studio.desktopPlane),a=(await studio.desktopDrawing.dispatch('drawing_create',kind==='intersect'?{kind:'rectangle',closed:true,name:'Front outline',planeId:base.id,origin:base.origin,xAxis:base.xAxis,yAxis:base.yAxis,widthMetres:.1,heightMetres:.08}:{kind:'circle',closed:true,name:'Base section',planeId:base.id,origin:base.origin,xAxis:base.xAxis,yAxis:base.yAxis,radiusMetres:.04})).figure;if(kind==='extrude')return [a];let p;if(kind==='intersect'){studio.planeEditor.choose('plane-top');p=studio.desktopPlane;}else{p={...base,id:crypto.randomUUID(),name:'Upper section plane',origin:[base.origin[0],base.origin[1],base.origin[2]+.08]};store.session.desktopPlanes.push(p);studio.planeEditor.choose(p.id);}const b=(await studio.desktopDrawing.dispatch('drawing_create',{kind:'circle',closed:true,name:kind==='intersect'?'Top outline':'Upper section',planeId:p.id,origin:p.origin,xAxis:p.xAxis,yAxis:p.yAxis,radiusMetres:kind==='intersect'?.05:.02})).figure;await store.flush();return [a,b];},kind);}
async function mockCommand(page,kind){await page.route('**/api/agent/speech-decision?*',r=>r.fulfill({json:{choice:'modeling'}}));const packets=[];process.env.OPENAI_API_KEY||='synthetic-only';process.env.SESSION_DIR='.runtime/multi-sketch-fast/browser-mocked';await page.route('**/api/agent/sketch-command?*',async r=>{const input=r.request().postDataJSON();packets.push(input);const all=input.sketchFigures.filter(f=>!f.construction),result=await runExistingSketchEdit(input,{recordingId:'synthetic-multi',requestId:input.requestId,fetcher:async(url,options)=>{const context=JSON.parse(JSON.parse(options.body).input[0].content[0].text);expect(context.solidReferences.length).toBe(all.length);return{ok:true,json:async()=>({status:'completed',usage:{input_tokens:1000,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Create '+kind+' from the existing drawings',question:null,operations:[],additions:[],solidEdits:[{name:'Drawings to CAD',kind,loftMode:'ruled',profiles:(kind==='extrude'?input.figures:all).map(f=>({figureId:f.id,expectedVersion:f.version,depthMetres:kind==='loft'?null:kind==='intersect'?.1:.03,backDepthMetres:kind==='loft'?null:kind==='intersect'?.1:0}))}]})}]}]})};}});await r.fulfill({json:result});});for(const route of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+route+'?*',r=>r.fulfill({json:{saved:true}}));return packets;}
async function state(page){return page.evaluate(()=>{const{studio,store}=solidTest,solids=store.session.desktopSolids||[],doc=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document();return {figures:studio.desktopDrawing.summary(),solids,models:studio.surfaceModels().filter(m=>!m.hidden).length,bodies:solids.map(s=>doc.derived.bodyRepresentations[s.bodyId]),draft:studio.aiDraftReview.active,persistedSolids:store.snapshotForPersistence().desktopSolids||[],preview:studio.decisionLab.pending};});}

test('spoken request builds a visible native loft from drawings on two planes, then accepts once',async({page})=>{test.setTimeout(120000);const packets=await mockCommand(page,'loft');await load(page);const before=await profiles(page);const started=Date.now();await page.evaluate(()=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'create-loft',text:'Make a 3D CAD model by joining these two drawings with a loft.'}})));await expect(page.locator('#decision-hold')).toBeVisible({timeout:45000});await page.locator('#decision-hold').click();const preview=await state(page);expect(preview.draft).toBe(true);expect(preview.models).toBe(1);expect(preview.solids).toHaveLength(1);expect(preview.persistedSolids).toHaveLength(0);expect(preview.figures).toHaveLength(2);expect(preview.figures.map(f=>f.id)).toEqual(before.map(f=>f.id));expect(preview.figures.map(f=>f.version)).toEqual(before.map(f=>f.version));expect(preview.bodies[0].exportableStep).toBe(true);expect(preview.bodies[0].volume).toBeCloseTo(Math.PI*80/3*(40*40+40*20+20*20),-1);expect(packets).toHaveLength(1);expect(packets[0].figures).toHaveLength(1);expect(packets[0].sketchFigures).toHaveLength(2);await page.locator('#part-solidify').click();await expect(page.locator('#decision-status')).toHaveText('Part saved');const accepted=await state(page);expect(accepted.draft).toBe(false);expect(accepted.persistedSolids).toHaveLength(1);const f=accepted.figures[0];await page.evaluate(async f=>{await solidTest.studio.desktopDrawing.dispatch('drawing_update',{figureId:f.id,expectedVersion:f.version,radiusMetres:.05});},f);const updated=await state(page);expect(updated.bodies[0].volume).toBeGreaterThan(accepted.bodies[0].volume);console.log('MULTI_SKETCH_NATIVE',JSON.stringify({totalMs:Date.now()-started,nativeMs:preview.preview.nativeApplication.durationMs,sourceSketches:preview.solids[0].sketchIds.length,volume:accepted.bodies[0].volume}));});

test('discarding a perpendicular-view intersection restores both original sketches and removes the preview body',async({page})=>{test.setTimeout(120000);await mockCommand(page,'intersect');await load(page,{manual:true});const before=await profiles(page,'intersect');await page.locator('#decision-instruction').fill('Make one 3D solid from the front and top silhouettes; intersect their extrusions.');await expect(page.locator('#decision-status')).toContainText('Preview ready',{timeout:45000});const preview=await state(page);expect(preview.bodies[0].exportableStep).toBe(true);expect(preview.bodies[0].volume).toBeCloseTo(Math.PI*50*50*80,-1);await page.locator('#decision-preview-discard').click();await expect(page.locator('#decision-status')).toContainText('Preview discarded',{timeout:45000});const after=await state(page);expect(after.models).toBe(0);expect(after.solids).toHaveLength(0);expect(after.figures.map(f=>[f.id,f.origin,f.version])).toEqual(before.map(f=>[f.id,f.origin,f.version]));});

test('single accepted profile extrudes with a visible solid preview and automatic acceptance',async({page})=>{test.setTimeout(120000);await mockCommand(page,'extrude');await load(page);const before=await profiles(page,'extrude');await page.locator('#decision-instruction').fill('Make this sketch a 3D solid, extruded by 30 mm.');await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:45000});const after=await state(page);expect(after.solids).toHaveLength(1);expect(after.solids[0].kind).toBe('extrude');expect(after.figures[0].id).toBe(before[0].id);expect(after.figures[0].extrusion.distanceMetres).toBe(.03);expect(after.bodies[0].volume).toBeCloseTo(Math.PI*40*40*30,-1);await page.evaluate(async id=>solidTest.studio.desktopDrawing.extrude(id,.04),before[0].id);const changed=await state(page);expect(changed.solids[0].bodyId).toBe(after.solids[0].bodyId);expect(changed.solids[0].parameters.profiles[0].depthMetres).toBe(.04);expect(changed.bodies[0].volume).toBeCloseTo(Math.PI*40*40*40,-1);});

test('live model builds CAD from two accepted drawings without redrawing them',async({page})=>{test.skip(process.env.DRAW3D_MULTI_SOLID_LIVE!=='1','Opt-in paid synthetic inference');test.setTimeout(150000);await load(page);const before=await profiles(page);const started=Date.now();await page.evaluate(()=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'live-build',text:'Make one 3D CAD solid by lofting smoothly between these two circular drawings. Keep both drawings, dimensions and planes unchanged.'}})));await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:120000});const after=await state(page);expect(after.solids).toHaveLength(1);expect(after.solids[0].kind).toBe('loft');expect(after.figures.map(f=>f.id)).toEqual(before.map(f=>f.id));expect(after.bodies[0].volume).toBeGreaterThan(0);expect(after.bodies[0].exportableStep).toBe(true);const timing=await page.evaluate(()=>solidTest.store.session.decisionCases.at(-1));console.log('MULTI_SKETCH_LIVE',JSON.stringify({totalIncludingReviewMs:Date.now()-started,case:timing}));});
import {readFileSync} from 'node:fs';

test('smooth and revolve an open sketch in one transaction', async ({page}) => {
 test.setTimeout(120000);
 const replay=process.env.DRAW3D_REVOLVE_REPLAY;
 const figure=replay ? JSON.parse(readFileSync(replay,'utf8')).data.figures[0] : {
  kind:'spline',segments:[[0,0,.01,.04,.04,.04,.05,0]],closed:false,
  origin:[0,1.15,-.6],xAxis:[1,0,0],yAxis:[0,1,0],planeId:'plane-front',name:'Open side profile'
 };
 if(!replay) await page.route('**/api/agent/sketch-command?*', async route=>{
  const input=route.request().postDataJSON(), source=input.figures[0];
  process.env.OPENAI_API_KEY||='synthetic-only';
  process.env.SESSION_DIR='.runtime/multi-sketch-fast/browser-mocked';
  const plan={summary:'Smooth and revolve about the endpoint chord',question:null,
   operations:[{referenceId:'f0',action:'regularize',regularization:{smooth:true,symmetry:'preserve'}}],
   additions:[],solidEdits:[{name:'Turned profile',kind:'revolve',loftMode:'smooth',revolution:{axis:'endpoints',angleDegrees:360},
    profiles:[{figureId:source.id,expectedVersion:source.version,depthMetres:null,backDepthMetres:null}]}]};
  const result=await runExistingSketchEdit(input,{fetcher:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}]})})});
  await route.fulfill({json:result});
 });
 await load(page);
 const source=await page.evaluate(async f=>{
  const {studio}=solidTest;studio.planeEditor.choose(f.planeId);
  const {name,origin,xAxis,yAxis,segments,planeId}=f;
  return (await studio.desktopDrawing.dispatch('drawing_create',{kind:'spline',closed:false,name,origin,xAxis,yAxis,segments,planeId})).figure;
 },figure);
 await page.locator('#decision-instruction').fill('Make this into a smooth shape and then revolve this.');
 await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:65000});
 const after=await state(page);
 expect(after.solids).toHaveLength(1);expect(after.solids[0].kind).toBe('revolve');
 expect(after.figures[0].id).toBe(source.id);expect(after.bodies[0].volume).toBeGreaterThan(0);
 expect(after.bodies[0].exportableStep).toBe(true);
 // Independent integral of pi*r(t)^2*x'(t) for the synthetic cubic section, in mm³.
 if(!replay)expect(Math.abs(after.bodies[0].volume/(Math.PI*187200/7)-1)).toBeLessThan(.005);
 console.log('Revolve volume',after.bodies[0].volume,'source version',after.figures[0].version);
 const section=after.figures[0];
 await page.evaluate(async f=>{await solidTest.studio.desktopDrawing.dispatch('drawing_update',{figureId:f.id,expectedVersion:f.version,segments:f.segments.map(s=>s.map(v=>v*1.2))});},section);
 const edited=await state(page);expect(edited.bodies[0].volume/after.bodies[0].volume).toBeCloseTo(1.2**3,2);
});
for(const kind of ['union','subtract']){
 test('native '+kind+' consumes the two named sketch extrusions',async({page})=>{
  test.setTimeout(100000);
  await mockCommand(page,kind);await load(page);
  await page.evaluate(async()=>{
   const {studio}=solidTest;studio.planeEditor.choose('plane-front');
   const p=studio.desktopPlane;
   for(const offset of [0,.025]){
    const origin=p.origin.map((v,i)=>v+offset*p.xAxis[i]);
    await studio.desktopDrawing.dispatch('drawing_create',{kind:'rectangle',closed:true,name:'Section',planeId:p.id,
     origin,xAxis:p.xAxis,yAxis:p.yAxis,widthMetres:.05,heightMetres:.04});
   }
  });
  await page.locator('#decision-instruction').fill('Build a '+kind+' from the two sketch extrusions.');
  await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:65000});
  const after=await state(page);
  expect(after.solids).toHaveLength(1);
  expect(after.bodies[0].exportableStep).toBe(true);
  expect(after.bodies[0].volume).toBeCloseTo((kind==='union'?75:25)*40*30,-1);
 });
}

test('unrelated speech leaves the two source sketches alone before a spoken loft',async({page})=>{
 const commands=await mockCommand(page,'loft');
 await load(page);
 await profiles(page);
 await page.route('**/api/agent/speech-decision?*',route=>{
  const packet=route.request().postDataJSON();
  expect(packet.hasSketch).toBe(true);
  return route.fulfill({json:{choice:packet.text==='Discuss the API.'?'unrelated':'modeling'}});
 });
 const speak=words=>page.evaluate(text=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:crypto.randomUUID(),text}})),words);
 await speak('Discuss the API.');
 await expect(page.locator('#decision-status')).toHaveText('Background speech ignored.');
 expect(commands).toHaveLength(0);
 await speak('Loft these sections.');
 await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:30000});
 expect(commands).toHaveLength(1);
});

test('ruled loft of two editable cubic rings gives the expected frustum volume',async({page})=>{
 await load(page);
 const output=await page.evaluate(async()=>{
  const {studio,store}=solidTest,figures=[];
  const base=studio.desktopPlane;
  for(const [i,r] of [.055,.035].entries()){
   const plane=i?{...base,id:crypto.randomUUID(),origin:base.origin.map((v,k)=>v+.09*base.normal[k])}:base;
   if(i)store.session.desktopPlanes.push(plane);
   const n=i?20:16,segments=[];
   for(let j=0;j<n;j++){
    const a=j*2*Math.PI/n,b=(j+1)*2*Math.PI/n,t=4/3*Math.tan((b-a)/4);
    segments.push([Math.cos(a),Math.sin(a),Math.cos(a)-t*Math.sin(a),Math.sin(a)+t*Math.cos(a),Math.cos(b)+t*Math.sin(b),Math.sin(b)-t*Math.cos(b),Math.cos(b),Math.sin(b)].map(x=>r*x));
   }
   figures.push((await studio.desktopDrawing.dispatch('drawing_create',{name:'Ring',kind:'spline',segments,closed:true,origin:plane.origin,xAxis:plane.xAxis,yAxis:plane.yAxis,planeId:plane.id})).figure);
  }
  const result=await studio.desktopDrawing.createSolid({name:'Taper',kind:'loft',loftMode:'ruled',profiles:figures.map(f=>({figureId:f.id,expectedVersion:f.version}))});
  const doc=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document();
  return doc.derived.bodyRepresentations[result.solid.bodyId];
 });
 expect(output.exportableStep).toBe(true);
 const expected=Math.PI*90/3*(55**2+55*35+35**2);
 expect(Math.abs(output.volume/expected-1)).toBeLessThan(.01);
});

test('shows planning and a provisional loft before the native body exists',async({page})=>{
 await mockCommand(page,'loft');
 let release;
 const waiting=new Promise(resolve=>release=resolve);
 await page.route('**/api/agent/sketch-command?*',async route=>{await waiting;await route.fallback();});
 await load(page);
 await profiles(page);
 await page.evaluate(()=>{
  const drawing=solidTest.studio.desktopDrawing,create=drawing.createSolid;
  drawing.createSolid=async spec=>{await new Promise(resolve=>window.releaseLoft=resolve);return create(spec);};
 });
 const panel=page.locator('#decision-construction');
 await page.locator('#decision-instruction').fill('Connect these two sections with a loft.');
 await expect(panel).toContainText('Planning changes from your sketches');
 release();
 await expect(panel).toContainText('Building loft from 2 sketch outputs');
 await page.waitForFunction(()=>typeof window.releaseLoft==='function');
 const before=await page.evaluate(()=>({
  overlays:solidTest.studio.scene.getObjectByName('Provisional CAD surfaces').children.filter(c=>c.isMesh).length,
  solids:solidTest.store.session.desktopSolids?.length||0
 }));
 expect(before).toEqual({overlays:1,solids:0});
 await page.locator('#part-solidify').click();
 await expect(page.locator('#part-solidify')).toHaveText('Finishing…');
 expect(await page.evaluate(()=>solidTest.store.session.decisionPartStep)).toBeUndefined();
 await page.evaluate(()=>window.releaseLoft());
 await expect(page.locator('#decision-status')).toHaveText('Part saved',{timeout:30000});
 expect((await state(page)).bodies[0].volume).toBeGreaterThan(0);
 await expect(panel).toBeHidden();
 expect(await page.evaluate(()=>solidTest.studio.scene.getObjectByName('Provisional CAD surfaces').children.length)).toBe(0);
});

test('a downward spline extrusion survives review, reload and thickness editing',async({page})=>{
 await load(page);
 const figure=await page.evaluate(async()=>{
  const {studio}=solidTest;
  studio.planeEditor.choose('plane-top');
  const p=studio.desktopPlane,segments=[];
  for(let i=0;i<20;i++){
   const a=i*Math.PI/10,b=(i+1)*Math.PI/10,t=4/3*Math.tan((b-a)/4);
   segments.push([Math.cos(a),Math.sin(a),Math.cos(a)-t*Math.sin(a),Math.sin(a)+t*Math.cos(a),
    Math.cos(b)+t*Math.sin(b),Math.sin(b)-t*Math.cos(b),Math.cos(b),Math.sin(b)].map((v,k)=>v*(k%2?.04:.08)));
  }
  return (await studio.desktopDrawing.dispatch('drawing_create',{kind:'spline',closed:true,name:'Section',segments,origin:p.origin,xAxis:p.xAxis,yAxis:p.yAxis,planeId:p.id})).figure;
 });
 process.env.OPENAI_API_KEY||='synthetic-only';process.env.SESSION_DIR='.runtime/multi-sketch-fast/browser-mocked';
 await page.route('**/api/agent/sketch-command?*',async route=>{
  const input=route.request().postDataJSON();
  const plan={summary:'Extrude 50 mm down',operations:[],additions:[],question:null,solidEdits:[{kind:'extrude',loftMode:'ruled',name:'Downward body',revolution:null,profiles:[{figureId:figure.id,expectedVersion:figure.version,depthMetres:0,backDepthMetres:.05}]}]};
  const result=await runExistingSketchEdit(input,{fetcher:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}]})})});
  await route.fulfill({json:result});
 });
 for(const ep of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+ep+'?*',route=>route.fulfill({json:{saved:true}}));
 await page.locator('#decision-instruction').fill('Extrude down by 5 centimetres.');
 await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:25000});
 const expected=Math.PI*80*40*50;
 const initial=await state(page);expect(initial.models).toBe(1);expect(initial.bodies[0].exportableStep).toBe(true);
 expect(Math.abs(initial.bodies[0].volume/expected-1)).toBeLessThan(.01);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.dataset.decisionReady==='true');
 const native=await page.evaluate(async()=>{
  const {studio,store}=solidTest,doc=(await studio.desktopDraftState.capture()).document;
  const {bodyId,featureId}=store.session.desktopSolids[0],feature=Object.values(doc.nodes).find(n=>n.kind==='feature'&&n.featureId===featureId);
  return {bodyId,volume:doc.derived.bodyRepresentations[bodyId].volume,distance:feature.data.distance};
 });
 expect(native.bodyId).toBe(initial.solids[0].bodyId);expect(native.volume).toBeCloseTo(initial.bodies[0].volume,4);expect(native.distance).toBe(-50);
 await page.evaluate(async id=>{await solidTest.studio.desktopDrawing.extrude(id,.075);},figure.id);
 const edited=await state(page);expect(edited.models).toBe(1);
 expect(edited.solids[0].bodyId).toBe(native.bodyId);
 expect(edited.solids[0].parameters.profiles[0]).toMatchObject({depthMetres:0,backDepthMetres:.075});
 expect(edited.bodies[0].volume).toBeCloseTo(native.volume*1.5,2);
});

test('a failed extrusion keeps the source and offers a visible retry of the same request',async({page})=>{
 const requests=await mockCommand(page,'extrude');
 await load(page);const [source]=await profiles(page,'extrude');
 await page.evaluate(()=>{const drawing=solidTest.studio.desktopDrawing,original=drawing.createSolid;drawing.createSolid=async spec=>{drawing.createSolid=original;throw Error('Kernel rejected this test extrusion');};});
 await page.locator('#decision-instruction').fill('Make the section 30 mm thick.');
 const panel=page.locator('#decision-construction');
 await expect(panel).toContainText('Kernel rejected this test extrusion');
 expect((await state(page)).figures.map(f=>f.id)).toEqual([source.id]);
 expect((await state(page)).models).toBe(0);
 await panel.getByRole('button',{name:'Retry'}).click();
 await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:20000});
 expect(requests.map(p=>p.prompt)).toEqual(['Make the section 30 mm thick.','Make the section 30 mm thick.']);
 expect((await state(page)).models).toBe(1);
});

test('a hollow revolve creates an open 3mm cap and preserves its editable outer meridian',async({page})=>{
 await load(page);
 const result=await page.evaluate(async()=>{
  const {studio}=solidTest,p=studio.desktopPlane;
  const line=(a,b)=>[...a,...a.map((v,k)=>v+(b[k]-v)/3),...a.map((v,k)=>v+2*(b[k]-v)/3),...b];
  const f=(await studio.desktopDrawing.dispatch('drawing_create',{kind:'spline',closed:false,origin:p.origin,xAxis:p.xAxis,yAxis:p.yAxis,planeId:p.id,name:'Cap exterior',segments:[line([.05,0],[.05,.1]),line([.05,.1],[0,.1])]})).figure;
  const solid=await studio.desktopDrawing.createSolid({kind:'revolve',name:'Hollow cap',loftMode:'ruled',revolution:{axis:'vertical',axisOriginUV:[0,0],wallThicknessMetres:.003,angleDegrees:360},profiles:[{figureId:f.id,expectedVersion:f.version,depthMetres:null,backDepthMetres:null}]});
  const doc=(await studio.desktopDraftState.capture()).document;
  return {id:f.id,source:studio.desktopDrawing.summary()[0],solid:solid.solid,body:doc.derived.bodyRepresentations[solid.solid.bodyId]};
 });
 expect(result.source.id).toBe(result.id);expect(result.source.closed).toBe(false);
 expect(result.solid.parameters.revolution.wallThicknessMetres).toBe(.003);
 expect(result.body.exportableStep).toBe(true);
 const expected=Math.PI*(50**2*100-47**2*97);
 expect(Math.abs(result.body.volume/expected-1)).toBeLessThan(.01);
});

test('reopening an older sketch session after working in another project restores the source of a hollow revolve',async({page})=>{
 test.setTimeout(150000);
 const recording=process.env.DRAW3D_HOLLOW_SESSION_REPLAY;
 const recorded=recording?JSON.parse(readFileSync(recording,'utf8')).data:null;
 const direction={kind:'spline',closed:false,name:'Outer meridian',origin:[0,1.15,-.6],xAxis:[1,0,0],yAxis:[0,1,0],planeId:'plane-front',
  segments:[[.05,0,.05,.03,.05,.065,.05,.1],[.05,.1,.035,.1,.015,.1,0,.1]]};
 const sources=recorded?.figures||[direction];
 const tier=recorded?(process.env.DRAW3D_REPLAY_TIER||'priority'):'priority';
 if(!recorded)await page.route('**/api/agent/sketch-command?*',async route=>{
  const input=route.request().postDataJSON(),source=input.figures[0];
  expect(input.apiSpeed).toBe('priority');
  process.env.OPENAI_API_KEY||='synthetic-only';
  process.env.SESSION_DIR='.runtime/multi-sketch-fast/browser-mocked';
  const plan={summary:'Hollow cap with 3 mm walls',question:null,operations:[],additions:[],solidEdits:[{
   name:'Cap',kind:'revolve',loftMode:'smooth',profiles:[{figureId:source.id,expectedVersion:source.version,depthMetres:null,backDepthMetres:null}],
   revolution:{axis:'vertical',axisOriginUV:[0,.1],angleDegrees:360,wallThicknessMetres:.003}}]};
  const result=await runExistingSketchEdit(input,{fetcher:async(_url,opts)=>{
   expect(JSON.parse(opts.body).service_tier).toBe('priority');
   return {ok:true,json:async()=>({status:'completed',service_tier:'fast',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}]})};
  }});
  await route.fulfill({json:result});
 });
 await load(page);
 const firstURL=page.url();
 const first=await page.evaluate(async sources=>{
  const {studio,store}=solidTest;
  for(const f of sources){
   studio.planeEditor.choose(f.planeId);
   const {kind,closed,name,origin,xAxis,yAxis,planeId,segments}=f;
   await studio.desktopDrawing.dispatch('drawing_create',{kind,closed,name,origin,xAxis,yAxis,planeId,segments});
  }
  await studio.desktopHistory.capture('Saved source sketches');
  await store.flush();
  return {id:store.session.id,figures:studio.desktopDrawing.summary()};
 },sources);
 await page.locator('#decision-api-speed').selectOption(tier);
 await page.goto(firstURL.replace(first.id,crypto.randomUUID()),{waitUntil:'domcontentloaded'});
 await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true');
 const other=await profiles(page,'extrude');
 expect(other[0].projectId).not.toBe(first.figures[0].projectId);
 // Reproduce the old startup race: a valid session with the wrong active-project pointer.
 await page.evaluate(async id=>{
  const {store}=solidTest;
  const original=await store.get('sessions',id);
  original.activeCADProject=structuredClone(store.session.activeCADProject);
  await store.put('sessions',original);
 },first.id);
 await page.goto(firstURL,{waitUntil:'domcontentloaded'});
 await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true');
 await expect.poll(()=>page.evaluate(()=>solidTest.studio.modelAgent.ready)).toBe(true);
 await expect(page.locator('#decision-api-speed')).toHaveValue(tier);
 await page.locator('#decision-instruction').fill(recorded?.prompt||'Revolve a hollow cap with a 3 mm wall.');
 await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:65000});
 const result=await state(page);
 expect(result.solids).toHaveLength(1);
 expect(result.figures.map(f=>[f.id,f.objectId,f.projectId])).toEqual(first.figures.map(f=>[f.id,f.objectId,f.projectId]));
 expect(result.solids[0].projectId).toBe(first.figures[0].projectId);
 expect(result.solids[0].parameters.revolution.wallThicknessMetres).toBe(.003);
 expect(result.bodies[0].volume).toBeGreaterThan(0);
 expect(result.bodies[0].exportableStep).toBe(true);
 expect(result.models).toBe(1);
 console.log('Reopened cap volume (mm3)',result.bodies[0].volume);
 await page.evaluate(()=>solidTest.store.flush());
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true');
 await page.evaluate(()=>solidTest.studio.desktopDraftState.capture());
 expect((await state(page)).bodies[0].volume).toBeCloseTo(result.bodies[0].volume,0);
});

test('a spoken change during native construction replaces the uncommitted extrusion',async({page})=>{
 await load(page);
 await profiles(page,'extrude');
 const prompts=[];
 await page.route('**/api/agent/speech-decision?*',r=>r.fulfill({json:{choice:'modeling'}}));
 await page.route('**/api/agent/sketch-command?*',async route=>{
  const input=route.request().postDataJSON(),f=input.figures[0];
  prompts.push(input.prompt);
  process.env.OPENAI_API_KEY||='synthetic-only';
  process.env.SESSION_DIR='.runtime/multi-sketch-fast/browser-mocked';
  const solid={name:'Extrusion',kind:'extrude',loftMode:'ruled',profiles:[{figureId:f.id,expectedVersion:f.version,
    depthMetres:input.prompt.includes('40 mm')?.04:.02,backDepthMetres:0}]};
  const result=await runExistingSketchEdit(input,{fetcher:async()=>({ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Build it',question:null,operations:[],additions:[],solidEdits:[solid]})}]}]})})});
  await route.fulfill({json:result});
 });
 await page.evaluate(()=>{
  const drawing=solidTest.studio.desktopDrawing,create=drawing.createSolid;
  drawing.createSolid=async spec=>{
   const result=await create(spec);
   drawing.createSolid=create;
   await new Promise(resolve=>window.finishFirstBuild=resolve);
   return result;
  };
 });
 await page.locator('#decision-instruction').fill('Extrude this by 20 mm.');
 await page.waitForFunction(()=>typeof window.finishFirstBuild==='function');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'update-depth',text:'Make the depth 40 mm instead.'}})));
 await expect(page.locator('#decision-instruction')).toHaveValue(/20 mm.*40 mm/s);
 await page.evaluate(()=>window.finishFirstBuild());
 await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:40000});
 const out=await state(page);
 expect(prompts).toEqual(['Extrude this by 20 mm.','Extrude this by 20 mm.\nUpdate: Make the depth 40 mm instead.']);
 expect(out.solids).toHaveLength(1);
 expect(out.solids[0].parameters.profiles[0].depthMetres).toBe(.04);
 expect(out.models).toBe(1);
});

for(const manual of [true,false])test('solidifying '+(manual?'a preview':'an automatically accepted body')+' starts a separate editable part on the same plane',async({page})=>{
 test.setTimeout(120000);
 const packets=await mockCommand(page,'extrude');await load(page,{manual});
 const [first]=await profiles(page,'extrude');
 await page.locator('#decision-instruction').fill('Extrude the first section.');
 if(manual)await expect(page.locator('#decision-status')).toContainText('Preview ready',{timeout:30000});
 if(!manual)await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:30000});
 await expect(page.locator('#part-solidify')).toBeEnabled({timeout:30000});
 const original=(await state(page)).solids[0];
 await page.locator('#part-solidify').click();
 await expect(page.locator('#decision-status')).toHaveText('Part saved');
 await expect(page.locator('#decision-instruction')).toHaveValue('');
 await expect(page.locator('#part-solidify')).toBeDisabled();
 if(manual){
  await page.reload();await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true');
  await expect.poll(()=>page.evaluate(()=>solidTest.studio.modelAgent.ready)).toBe(true);
 }
 const second=await page.evaluate(async()=>{
  const {studio}=solidTest,p=studio.desktopPlane;
  const {figure}=await studio.desktopDrawing.dispatch('drawing_create',{kind:'circle',closed:true,name:'Boss section',planeId:p.id,
   origin:p.origin.map((v,k)=>v+.12*p.xAxis[k]),xAxis:p.xAxis,yAxis:p.yAxis,radiusMetres:.015});
  studio.desktopDrawing.select(figure.id);return figure;
 });
 expect(second.desktopSketchId).not.toBe(first.desktopSketchId);
 await page.locator('#decision-instruction').fill('Extrude the new boss beside the first part.');
 await expect.poll(()=>packets.length).toBe(2);
 expect(packets[1].prompt).toBe('Extrude the new boss beside the first part.');
 expect(packets[1].partContext.bodies[0].bodyId).toBe(original.bodyId);
 expect(packets[1].figures.map(f=>f.id)).toEqual([second.id]);
 await expect(page.locator('#part-solidify')).toBeEnabled({timeout:30000});
 await page.locator('#part-solidify').click();await expect(page.locator('#decision-status')).toHaveText('Part saved',{timeout:30000});
 const built=await state(page);
 expect(built.solids.map(s=>s.bodyId)).toEqual([original.bodyId,expect.any(String)]);
 expect(new Set(built.solids.map(s=>s.bodyId)).size).toBe(2);
 expect(built.bodies.every(b=>b.exportableStep&&b.volume>0)).toBe(true);
 await page.evaluate(id=>solidTest.studio.desktopDrawing.extrude(id,.04),first.id);
 const edited=await state(page);
 expect(edited.solids[0].bodyId).toBe(original.bodyId);
 expect(edited.bodies[0].volume).toBeGreaterThan(built.bodies[0].volume);
 expect(edited.bodies[1].volume).toBeCloseTo(built.bodies[1].volume);
});

test('reopening a part preview lets Solidify commit its recovered body once',async({page})=>{
 test.setTimeout(90000);await mockCommand(page,'extrude');await load(page,{manual:true});
 await profiles(page,'extrude');
 await page.locator('#decision-instruction').fill('Extrude the first section.');
 await expect(page.locator('#decision-status')).toContainText('Preview ready',{timeout:30000});
 const original=(await state(page)).solids[0].bodyId;
 await page.reload();await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true');
 await expect(page.locator('#part-solidify')).toBeEnabled({timeout:30000});
 await page.locator('#part-solidify').click();
 await expect(page.locator('#decision-status')).toHaveText('Part saved');
 const built=await state(page);
 expect(built.draft).toBe(false);expect(built.persistedSolids.map(s=>s.bodyId)).toEqual([original]);
});

for(const failures of [1,2])test('native memory recovery tolerates '+failures+' failed body rebuild(s) without duplicating the command',async({page})=>{
 test.setTimeout(60000);
 // Count actual compilations in the native editor realm across worker replacements.
 await page.addInitScript(()=>{
  if(window===top)window.remusCompilations=0;
  const compile=WebAssembly.compileStreaming.bind(WebAssembly);
  WebAssembly.compileStreaming=async(source,...options)=>{
   const asset=await source;
   if(new URL(asset.url).pathname.includes('/remus_wasm_bg-'))window.top.remusCompilations++;
   return compile(asset,...options);
  };
 });
 await page.addInitScript(injectGeometryMemoryFault,failures);
 const packets=await mockCommand(page,'extrude');await load(page);const [source]=await profiles(page,'extrude');
 await page.locator('#decision-instruction').fill('Extrude this circle.');
 if(failures===2){
  await expect(page.locator('#decision-construction')).toContainText('out of memory',{timeout:25000});
  expect((await state(page)).solids).toHaveLength(0);
  await page.locator('#decision-construction [data-retry]').click();
 }
 await expect(page.locator('#decision-status')).toContainText('CAD model ready',{timeout:25000});
 const built=await state(page);
 expect(built.solids).toHaveLength(1);expect(built.solids[0].figureIds).toEqual([source.id]);
 expect(built.bodies[0].exportableStep).toBe(true);
 expect(built.bodies[0].volume).toBeCloseTo(Math.PI*40*40*30,-1);
 const io=await page.evaluate(()=>document.querySelector('#full-cad-workspace iframe').contentWindow.memoryTest);
 expect(io).toEqual({faults:failures,workers:2});
 expect(await page.evaluate(()=>window.remusCompilations)).toBe(1);
 expect(packets).toHaveLength(failures);
});
