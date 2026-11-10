import {dragHandle} from './viewport-transform-driver.mjs';
import {test,expect} from '@playwright/test';
import {buildDecisionRequest,fitDecisionResponse} from '../scripts/decision-sketch-api.mjs';
import {prepareExistingSketchEdit} from '../scripts/existing-sketch-edit.mjs';
import {expandRefinement} from '../scripts/sketch-refinement.mjs';

test('sketch first, build, move and undo a body, then create an offset sketch plane',async({page})=>{
 test.setTimeout(150000);
 let fit,buildInput;
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.testWorkspace=e.detail));
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 for(const action of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+action+'?*',r=>r.fulfill({json:{saved:true}}));
 await page.route('**/api/agent/speech-decision?*',r=>r.fulfill({json:{choice:'modeling'}}));
 await page.route('**/api/agent/sketch-decisions?*',async r=>{
  const data=r.request().postDataJSON();expect(data.creationMode).toBe(data.userBuildInstruction?'instruction':'sketch');
  const {body,groups}=buildDecisionRequest(data);
  const answers=body.questions.map(q=>({type:'choice',name:q.name,choice:q.name.endsWith('.primitive')?'rectangle':q.name.endsWith('.role')?'geometry':q.name.endsWith('.closure')?'closed':q.name.endsWith('.symmetry')?'both':q.name.endsWith('.support_plane')?'current':q.choices[0].value}));
  fit={...fitDecisionResponse(data,groups,{answers}),id:crypto.randomUUID(),cost:{usd:0,usageKnown:true},timings:{totalMs:1}};
  await r.fulfill({json:fit});
 });
 await page.route('**/api/agent/sketch-refine?*',r=>r.fulfill({json:{...fit,refinement:{id:crypto.randomUUID(),summary:'Rectangular sketch',operations:[]}}}));
 await page.route('**/api/agent/sketch-command?*',async r=>{
  buildInput=r.request().postDataJSON();expect(buildInput.creationMode).toBe('build');
  const {saved,fit}=prepareExistingSketchEdit(buildInput);
  const multiple=buildInput.figures.length===2;
  const plan={summary:'Made the rectangular base.',question:null,operations:[],additions:[],solidEdits:[{kind:multiple?'loft':'extrude',name:multiple?'Loft':'Base',loftMode:'ruled',profiles:buildInput.figures.map(f=>({figureId:f.id,expectedVersion:f.version,depthMetres:multiple?null:.012,backDepthMetres:null}))}]};
  const out=expandRefinement(plan,saved,fit);out.refinement.id=crypto.randomUUID();await r.fulfill({json:out});
 });
 await page.goto('http://127.0.0.1:5191/desktop.html?experiment=decision&session='+crypto.randomUUID());
 await page.waitForFunction(()=>window.testWorkspace?.studio.modelAgent.ready&&document.body.dataset.decisionReady==='true');
 await page.evaluate(async()=>{
  const {studio,store}=testWorkspace;studio.planeEditor.choose('plane-front');
  const plane=studio.desktopPlane,angle=.22,c=Math.cos(angle),s=Math.sin(angle);
  const corners=[[-.045,-.018],[.045,-.018],[.045,.018],[-.045,.018],[-.045,-.018]];
  const points=corners.slice(1).flatMap((v,i)=>Array.from({length:18},(_,j)=>{
   const x=corners[i][0]+(v[0]-corners[i][0])*j/17,y=corners[i][1]+(v[1]-corners[i][1])*j/17;
   return [plane.origin[0]+.105+x*c-y*s,plane.origin[1]+.077+x*s+y*c,plane.origin[2]];
  }));
  const ink={id:crypto.randomUUID(),drawingPlane:plane,points,radius:.0005,color:'#80aaff'};
  store.session.strokes.push(ink);studio.addStrokeMesh(ink);store.log('stroke.end',{id:ink.id});
  const audio=new Blob([new Uint8Array(44)],{type:'audio/wav'});await store.asset('speech/test.wav',audio);
  window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'test',text:'Sketch the base outline only. I will confirm the 12 mm extrusion later.',name:'speech/test.wav'}}));
 });
 const status=page.locator('#decision-status');
 await expect(status).toContainText('Accepted',{timeout:30000});
 await expect(page.locator('#part-chat .part-message svg')).toHaveCount(1);
 await expect(page.locator('#part-chat')).toContainText('Rectangular sketch');
 await page.getByRole('button',{name:'Play recording'}).click();await expect(page.locator('#part-chat audio')).toHaveCount(1);
 expect(buildInput).toBeUndefined();
 const bounds=()=>page.evaluate(()=>{
  const doc=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document();
  const id=doc.derived.exportableBodyIds[0];if(!id)return null;return doc.derived.bodyRepresentations[id].bbox;
 });
 expect(await bounds()).toBeNull();
 await page.locator('#part-create').click();await expect(status).toContainText('CAD model ready',{timeout:65000});
 const box=await bounds();
 const center=(b,k)=>(b.min[k]+b.max[k])/2;
 expect(Math.abs(center(box,'x')-105)).toBeLessThan(3);expect(Math.abs(center(box,'z')-1227)).toBeLessThan(3);
 await page.locator('#desktop-cad-toolbar [data-tool="select"]').click();
 const pick=await page.evaluate(()=>{
  const {studio}=testWorkspace,mesh=studio.surfaceModels().find(m=>m.nativeId&&!m.hidden).mesh;
  mesh.geometry.computeBoundingBox();
  const p=mesh.geometry.boundingBox.min.clone().lerp(mesh.geometry.boundingBox.max,.5);
  mesh.localToWorld(p);p.project(studio.camera);
  const r=studio.renderer.domElement.getBoundingClientRect();return [r.left+(p.x+1)*r.width/2,r.top+(1-p.y)*r.height/2];
 });
 await page.mouse.click(...pick);
 await expect.poll(()=>page.evaluate(()=>!!testWorkspace.studio.activePlacement?.object)).toBe(true);
 await dragHandle(page,'translate');
 await expect.poll(async()=>{const b=await bounds();return Math.hypot(...['x','y','z'].map(k=>center(b,k)-center(box,k)));},{timeout:20000}).toBeGreaterThan(1);
 await expect.poll(()=>page.evaluate(()=>testWorkspace.studio.desktopDrawing.working)).toBe(false);
 await dragHandle(page,'rotate');
 await expect.poll(async()=>{const b=await bounds();return Math.max(...['x','y','z'].map(k=>Math.abs((b.max[k]-b.min[k])-(box.max[k]-box.min[k]))));},{timeout:20000}).toBeGreaterThan(.2);
 await expect.poll(()=>page.evaluate(()=>testWorkspace.studio.desktopDrawing.working)).toBe(false);
 for(let i=0;i<2;i++){await page.locator('#undo').click();await expect.poll(()=>page.evaluate(()=>testWorkspace.studio.desktopHistory.restoring)).toBe(false);}
 await page.locator('#part-list [data-part-id]').last().click();
 const form=page.locator('#part-pose');await expect(form).toBeVisible();
 await form.locator('input').nth(0).fill('25');await form.locator('input').nth(5).fill('90');
 await form.getByRole('button',{name:'Apply',exact:true}).click();await expect(form).toBeHidden({timeout:30000});
 const moved=await bounds();expect(center(moved,'x')).toBeCloseTo(center(box,'x')+25,1);
 expect(moved.max.x-moved.min.x).toBeCloseTo(box.max.z-box.min.z,1);
 await page.locator('#undo').click();await expect.poll(async()=>center(await bounds(),'x')).toBeCloseTo(center(box,'x'),1);
 await page.locator('#redo').click();await expect.poll(async()=>center(await bounds(),'x')).toBeCloseTo(center(box,'x')+25,1);
 await page.locator('#part-new-plane').click();await page.locator('[data-plane-base="plane-front"]').click();
 await page.locator('#cad-plane-new-offset').fill('20');await page.locator('#cad-plane-angle-x').fill('5');await page.locator('#cad-plane-name').fill('Upper section');
 await page.locator('#cad-plane-create').click();await expect(page.locator('#cad-plane-status')).toContainText('Plane created');
 await page.locator('#cad-plane-sketch').click();
 const active=await page.evaluate(()=>testWorkspace.studio.desktopPlane);expect(active.name).toBe('Upper section');
 expect(Math.abs(active.normal[1])).toBeGreaterThan(.07);
 await page.evaluate(()=>{
  const {studio,store}=testWorkspace,plane=studio.desktopPlane;
  const corners=[[-.032,-.013],[.032,-.013],[.032,.013],[-.032,.013],[-.032,-.013]];
  const points=corners.slice(1).flatMap((v,i)=>Array.from({length:18},(_,j)=>{
   const u=corners[i][0]+(v[0]-corners[i][0])*j/17,w=corners[i][1]+(v[1]-corners[i][1])*j/17;
   return plane.origin.map((a,k)=>a+plane.xAxis[k]*u+plane.yAxis[k]*w);
  }));
  const ink={id:crypto.randomUUID(),drawingPlane:plane,points,radius:.0005,color:'#80aaff'};
  store.log('stroke.begin',{id:ink.id});store.session.strokes.push(ink);studio.addStrokeMesh(ink);store.log('stroke.end',{id:ink.id});
 });
 await expect(page.locator('#part-chat .part-message svg')).toHaveCount(2);
 await expect.poll(()=>page.evaluate(()=>testWorkspace.studio.desktopDrawing.summary().filter(f=>!f.hidden).length),{timeout:30000}).toBe(2);
 await page.locator('#part-create').click();
 await expect.poll(()=>new Set(buildInput.figures.map(f=>f.planeId)).size,{timeout:20000}).toBe(2);
 await expect(status).toContainText('CAD model ready',{timeout:50000});
 const loft=await page.evaluate(()=>{
  const feature=testWorkspace.store.session.desktopSolids.find(s=>s.kind==='loft');
  const doc=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document();
  return feature&&{sections:feature.figureIds.length,volume:doc.derived.bodyRepresentations[feature.bodyId]?.volume,exportable:doc.derived.exportableBodyIds.includes(feature.bodyId)};
 });
 expect(loft?.sections).toBe(2);expect(loft.volume).toBeGreaterThan(0);expect(loft.exportable).toBe(true);
});
