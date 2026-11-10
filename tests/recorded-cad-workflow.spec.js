import {test,expect} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './sketch-refinement-fixture.mjs';
import {buildDecisionRequest,fitDecisionResponse} from '../scripts/decision-sketch-api.mjs';
import {expandRefinement} from '../scripts/sketch-refinement.mjs';

const directory=process.env.DRAW3D_REPLAY_CASE;
const expected=(process.env.DRAW3D_EXPECT_FEATURES||'').split(',').filter(Boolean);
const json=async file=>JSON.parse(await readFile(file,'utf8'));

// This gate starts with an empty document and exercises the real browser CAD
// compiler. A later edit must first replay the document it depends on.
test('recorded drawing reaches the specified native CAD features in a fresh document',async({page})=>{
 test.skip(!directory,'Opt-in local drawing record');
 test.setTimeout(240000);
 if(!expected.length)throw Error('Specify DRAW3D_EXPECT_FEATURES, e.g. revolve,pocket.');
 const {data}=await json(path.join(directory,'request.json'));
 if(data.partContext?.bodies?.length||data.figures?.length)throw Error('This drawing requires a pre-existing CAD document.');
 if(process.env.DRAW3D_REPLAY_INSTRUCTION){
  data.prompt=process.env.DRAW3D_REPLAY_INSTRUCTION;
  data.speechInputs=[]; // A counterfactual replaces the words, keeping the original ink, plane and image.
 }
 const initial=await json(path.join(directory,'result.json'));
 const live=process.env.DRAW3D_LIVE_REPLAY==='1';
 let planned;
 if(!live){
  const folder=path.join(directory,'refinements');
  const versions=(await readdir(folder,{withFileTypes:true})).filter(e=>e.isDirectory());
  if(versions.length!==1&&!process.env.DRAW3D_REPLAY_REFINEMENT)throw Error('Select DRAW3D_REPLAY_REFINEMENT for a case with multiple attempts.');
  const attempt=path.join(folder,process.env.DRAW3D_REPLAY_REFINEMENT||versions[0].name);
  const result=await json(path.join(attempt,'result.json'));
  const response=await json(path.join(attempt,'response.json'));
  const output=response.output.flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
  planned=expandRefinement(JSON.parse(output),{data},initial);
  planned.refinement={...result.refinement,...planned.refinement};
 }
 await verifyInBrowser(page,{data,initial,planned,live,expected,manual:process.env.DRAW3D_MANUAL_BUILD==='1',followup:process.env.DRAW3D_LIVE_FOLLOWUP});
});

async function verifyInBrowser(page,{data,initial,planned,live=false,expected,followup,manual=false}){
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.replayApp=e.detail));
 await page.route('**/api/agent/sketch-decisions?*',async route=>{
  if(!live)return route.fulfill({json:initial});
  // Preserve recorded camera, sketch coordinates, speech timing and images.
  const actual=route.request().postDataJSON();
  return route.continue({postData:JSON.stringify({...data,creationMode:actual.creationMode,userBuildInstruction:actual.userBuildInstruction,requestId:actual.requestId})});
 });
 if(!live){
  await page.route('**/api/agent/sketch-refine?*',route=>route.request().postDataJSON().fitId===initial.id?route.fulfill({json:{...planned,solidAuthorization:expected.some(k=>k!=='sketch')?'build':'wait'}}):route.continue());
  for(const action of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+action+'?*',r=>r.fulfill({json:{saved:true}}));
 }
 await page.goto((process.env.DRAW3D_REPLAY_ORIGIN||'http://127.0.0.1:5191')+'/desktop.html?experiment=decision&session='+crypto.randomUUID());
 await page.waitForFunction(()=>document.body.dataset.decisionReady==='true'&&window.replayApp.studio.modelAgent.ready);

 await page.evaluate(data=>{
  const {studio,store}=window.replayApp;
  studio.planeEditor.choose(data.plane.id);
  const auto=document.querySelector('#decision-auto-accept');
  if(!auto.checked)auto.click();
  for(const s of data.strokes){
   const ink={...s,drawingPlane:s.plane,color:'#80aaff',radius:.0006};
   store.session.strokes.push(ink);studio.addStrokeMesh(ink);
  }
  studio.decisionLab.submitInstruction(data.prompt);
 },data);
 const state=()=>page.evaluate(()=>{
  const {studio,store}=window.replayApp;
  const doc=document.querySelector('#full-cad-workspace iframe')?.contentWindow?.__draw3dCAD?.document();
  return {status:document.querySelector('#decision-status').textContent,busy:studio.decisionLab.busy,
   question:studio.decisionLab.pending?.refinement?.question,active:studio.aiDraftReview.active,
   figures:studio.desktopDrawing.summary().length,sketchOrigins:studio.desktopDrawing.summary().map(f=>f.origin),revolutions:(store.session.desktopSolids||[]).filter(s=>s.kind==='revolve').map(s=>s.parameters.revolution),kinds:(store.session.desktopSolids||[]).map(s=>s.kind),volumes:(doc?.derived?.exportableBodyIds||[]).map(id=>doc.derived.bodyRepresentations[id].volume)};
 });
 if(manual){
  await expect.poll(async()=>{const s=await state();if(/failed|could not/i.test(s.status))throw Error(s.status);return !s.busy&&!s.active&&/accepted/i.test(s.status)&&s.figures>0;},{timeout:90000}).toBe(true);
  expect((await state()).volumes).toHaveLength(0);
  await page.locator('#part-create').click();
  await expect.poll(async()=>{const s=await state();return s.busy||s.active||!/accepted/i.test(s.status);}).toBe(true);
 }
 if(followup){
  await expect.poll(async()=>{const s=await state();return !s.busy&&!s.active&&/accepted/i.test(s.status)&&s.figures>0;},{timeout:60000}).toBe(true);
  expect((await state()).volumes).toHaveLength(0);
  await page.evaluate(words=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:crypto.randomUUID(),text:words}})),followup);
  await expect.poll(async()=>{const s=await state();return s.busy||s.active||!/accepted/i.test(s.status);}).toBe(true);
 }
 let lastStatus;
 await expect.poll(async()=>{
  const s=await state();
  if(s.status!==lastStatus){lastStatus=s.status;console.log('Replay stage',s.status);}
  if(s.busy)return 'working';
  if(s.question||/could not|failed|initial fit retained/i.test(s.status))throw Error(s.question||s.status);
  if(/accepted|CAD model ready/i.test(s.status)&&!s.active)return 'committed';
  return s.status;
 },{timeout:200000}).toBe('committed');
 const result=await state();
 if(process.env.DRAW3D_CHECK_CAP_PLACEMENT==='1'){
  const f=result.sketchOrigins[0];expect(f[0]).toBeLessThan(-.045);expect(f[1]).toBeGreaterThan(1.19);
  if(expected.includes('revolve')){
   expect(result.revolutions[0].angleDegrees).toBe(360);expect(result.revolutions[0].wallThicknessMetres).toBeGreaterThan(0);
  }
 }
 if(expected.length===1&&expected[0]==='sketch'){
  expect(result.figures).toBeGreaterThan(0);expect(result.volumes).toHaveLength(0);return;
 }
 const remaining=[...result.kinds];
 for(const kind of expected){expect(remaining,JSON.stringify(result)).toContain(kind);remaining.splice(remaining.indexOf(kind),1);}
 expect(result.volumes.length).toBeGreaterThan(0);expect(result.volumes.every(v=>v>0)).toBe(true);
 console.log('Verified CAD replay',JSON.stringify(result));
 return result;

}

// Same input circle, different requested deliverables. This runs in a fresh
// document without a private recording or model charges.
for(const solid of [false,true]){
 test('native workflow commits '+(solid?'a bored spacer':'a planar ring'),async({page})=>{
  test.setTimeout(120000);
  const {saved,fit}=fixture();
  const data=saved.data;
  const plane={...data.plane,id:'plane-front',origin:[0,1.15,-.6]};
  data.plane=plane;data.referencePlanes=[plane];data.strokes[0].plane=plane;
  data.strokes[0].points=data.strokes[0].points.map(p=>p.map((v,k)=>v+plane.origin[k]));
  data.prompt=solid?'Make a spacer, 12 mm thick, with a 30 mm through hole.':'Keep this as a circular sketch.';
  const {groups}=buildDecisionRequest(data);
  const initial={...fitDecisionResponse(data,groups,{answers:fit.decisions}),id:crypto.randomUUID(),cost:{usd:0,usageKnown:true},timings:{totalMs:1}};
  const plan={summary:data.prompt,question:null,operations:[],additions:[],solidEdits:[]};
  if(solid){
   plan.additions=[{...initial.edits[0],radiusMetres:.015,name:'Bore'}];
   const feature=(id,sketch,operation,target,extent,depthMetres)=>({id,name:id,sketch,operation,target,extent,depthMetres,toolBody:null});
   plan.featurePlan={sketches:[{id:'rim',name:'Outer diameter',strokeIds:['ring'],profile:'circle',widthMetres:null}],
    features:[feature('Spacer','rim','new-body',null,'centered',.012),feature('Hole','added:0','cut','Spacer','through-all',null)]};
  }
  const planned=expandRefinement(plan,{data},initial);
  planned.refinement.id=crypto.randomUUID();
  const committed=await verifyInBrowser(page,{data,initial,planned,expected:solid?['extrude','pocket']:['sketch']});
  if(solid){
   expect(committed.volumes).toHaveLength(1);
   expect(committed.volumes[0]).toBeCloseTo(Math.PI*(50**2-15**2)*12,0);
  }
 });
}
