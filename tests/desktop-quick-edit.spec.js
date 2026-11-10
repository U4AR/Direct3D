import {test,expect} from '@playwright/test';
import {buildDecisionRequest,fitDecisionResponse} from '../scripts/decision-sketch-api.mjs';
async function load(page,{experiment=true}={}){await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.quickEdit=e.detail));await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.goto('http://127.0.0.1:5191/desktop.html?'+(experiment?'experiment=decision&refine=off&':'')+'session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveAttribute(experiment?'data-decision-ready':'data-desktop-ready','true',{timeout:45000});if(experiment)await page.locator('#decision-auto').uncheck();}
async function mockFit(page){let fit;await page.route('**/api/agent/sketch-decisions?*',async r=>{const data=r.request().postDataJSON(),{body,groups}=buildDecisionRequest(data);fit={...fitDecisionResponse(data,groups,{answers:body.questions.map(q=>({type:'choice',name:q.name,choice:q.name.endsWith('.role')?'geometry':q.name.endsWith('.primitive')?'circle':q.name.endsWith('.closure')?'closed':q.name.endsWith('.symmetry')?'both':q.name.endsWith('.alignment')?'drawn':q.name.endsWith('.intent')?'regularized_outline':q.choices[0].value}))}),id:crypto.randomUUID(),cost:{usd:0,usageKnown:true},timings:{totalMs:1}};await r.fulfill({json:fit});});for(const endpoint of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+endpoint+'?*',r=>r.fulfill({json:{saved:true}}));return ()=>fit;}
async function ring(page){await page.evaluate(()=>{const{studio,store}=quickEdit,p=studio.desktopPlane,s={id:crypto.randomUUID(),points:Array.from({length:81},(_,i)=>p.origin.map((v,k)=>v+.04*Math.cos(i*Math.PI/40)*p.xAxis[k]+.04*Math.sin(i*Math.PI/40)*p.yAxis[k])),drawingPlane:p,radius:.0006,color:'#80aaff'};store.session.strokes.push(s);studio.addStrokeMesh(s);});}
async function pixel(page,p){return page.evaluate(p=>{const s=quickEdit.studio,r=s.renderer.domElement.getBoundingClientRect(),v=s.camera.position.clone().fromArray(p).project(s.camera);return [r.left+(v.x+1)*r.width/2,r.top+(1-v.y)*r.height/2];},p);}

test('successful fit accepts automatically after a two-second visible review window',async({page})=>{await mockFit(page);await load(page);await expect(page.locator('#decision-auto-accept')).toBeChecked();await ring(page);await page.locator('#decision-fit').click();await expect(page.locator('#decision-auto-accept-status')).toContainText('Accepting in');const start=Date.now();await page.waitForTimeout(900);expect(await page.evaluate(()=>quickEdit.studio.desktopDrawing.summary().length)).toBe(0);await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:30000});expect(Date.now()-start).toBeGreaterThanOrEqual(1800);const result=await page.evaluate(()=>({figures:quickEdit.studio.desktopDrawing.summary(),strokes:quickEdit.store.session.strokes,cases:quickEdit.store.session.decisionCases}));expect(result.figures).toHaveLength(1);expect(result.strokes).toHaveLength(0);expect(result.cases.at(-1).feedback.at(-1).verdict).toBe('accepted');});

test('Keep preview and new drawing both cancel automatic acceptance',async({page})=>{await mockFit(page);await load(page);await ring(page);await page.locator('#decision-fit').click();await expect(page.locator('#decision-hold')).toBeVisible();await page.locator('#decision-hold').click();await page.waitForTimeout(2300);expect(await page.evaluate(()=>quickEdit.studio.desktopDrawing.summary().length)).toBe(0);expect(await page.evaluate(()=>!!quickEdit.studio.decisionLab.pending)).toBe(true);await page.locator('#decision-auto-accept').uncheck();await page.locator('#decision-auto-accept').check();await expect(page.locator('#decision-hold')).toBeVisible();await page.evaluate(()=>quickEdit.store.log('stroke.begin',{id:'new-stroke'}));await page.waitForTimeout(2300);expect(await page.evaluate(()=>quickEdit.studio.desktopDrawing.summary().length)).toBe(0);await expect(page.locator('#decision-accept')).toBeDisabled();});

test('a clarification is never automatically accepted',async({page})=>{const fit=await mockFit(page);await page.route('**/api/agent/sketch-refine?*',r=>r.fulfill({json:{...fit(),refinement:{question:'Should this be a hole or a separate part?',summary:'Question'}}}));await load(page);await page.locator('#decision-refine').check();await ring(page);await page.locator('#decision-fit').click();await expect(page.locator('#decision-status')).toContainText('Question:');await page.waitForTimeout(2300);expect(await page.evaluate(()=>quickEdit.studio.desktopDrawing.summary().length)).toBe(0);await expect(page.locator('#decision-accept')).toBeDisabled();await expect(page.locator('#decision-hold')).toBeHidden();});

test('double-click exits pen into CAD cursor; center dragging translates a circle in its plane and dimensions remain editable',async({page})=>{await load(page,{experiment:false});const f=await page.evaluate(async()=>{const{studio}=quickEdit;studio.planeEditor.choose('plane-front');const p=studio.desktopPlane,f=(await studio.desktopDrawing.dispatch('drawing_create',{kind:'circle',name:'Move me',origin:p.origin,xAxis:p.xAxis,yAxis:p.yAxis,planeId:p.id,radiusMetres:.04,closed:true})).figure;studio.planeView.editSketch(f.desktopSketchId);studio.desktopEditing.setMode('drawing');studio.desktopDrawing.setMode('pen');return f;});const blank=await page.evaluate(()=>{const c=quickEdit.studio.renderer.domElement,r=c.getBoundingClientRect();for(const [u,v]of [[.8,.25],[.2,.3],[.75,.7],[.3,.2]]){const p=[r.left+r.width*u,r.top+r.height*v];if(document.elementFromPoint(...p)===c)return p;}throw Error('No unobstructed canvas point');});await page.mouse.dblclick(...blank);await expect(page.locator('#desktop-layer-cad')).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>quickEdit.studio.mode)).toBe('orbit');await page.evaluate(id=>quickEdit.studio.desktopDrawing.select(id),f.id);const start=await pixel(page,f.origin),end=await pixel(page,[f.origin[0]+.03,f.origin[1]+.02,f.origin[2]]);await page.mouse.move(...start);await page.mouse.down();await page.mouse.move(...end,{steps:8});await page.mouse.up();await expect(page.locator('#cad-tool-status')).toContainText('Sketch updated',{timeout:60000});const moved=await page.evaluate(()=>quickEdit.studio.desktopDrawing.summary()[0]);expect(moved.origin[0]).toBeCloseTo(f.origin[0]+.03,5);expect(moved.origin[1]).toBeCloseTo(f.origin[1]+.02,5);expect(moved.origin[2]).toBeCloseTo(f.origin[2],8);expect(moved.radiusMetres).toBe(.04);await page.locator('[data-figure-id="'+f.id+'"] [data-dimension-key="diameterMetres"]').dblclick();await page.locator('#cad-dimension-value').fill('100');await page.locator('#cad-dimension-value').press('Enter');await expect(page.locator('#cad-dimension-editor')).not.toBeVisible();expect(await page.evaluate(()=>quickEdit.studio.desktopDrawing.summary()[0].radiusMetres)).toBe(.05);});

test('selecting a plane exposes its normal drag handle and moving it carries native sketches with undo',async({page})=>{await load(page,{experiment:false});const f=await page.evaluate(async()=>{const{studio}=quickEdit;studio.planeEditor.choose('plane-front');const p=studio.desktopPlane;return (await studio.desktopDrawing.dispatch('drawing_create',{kind:'rectangle',name:'On movable plane',origin:p.origin,xAxis:p.xAxis,yAxis:p.yAxis,planeId:p.id,widthMetres:.08,heightMetres:.06,closed:true})).figure;});await page.locator('.cad-plane-label[data-plane-id="plane-front"]').click();expect(await page.evaluate(()=>!!quickEdit.studio.planeGizmo.object)).toBe(true);await expect(page.locator('#desktop-layer-cad')).toHaveAttribute('aria-pressed','true');await page.locator('#cad-plane-distance').fill('30');await page.locator('#cad-plane-apply').click();await expect(page.locator('#cad-plane-status')).toContainText('Plane updated',{timeout:60000});const after=await page.evaluate(()=>({plane:quickEdit.studio.desktopPlane,figure:quickEdit.studio.desktopDrawing.summary()[0],sketch:quickEdit.studio.desktopSketches.catalog().find(s=>s.id===quickEdit.studio.desktopDrawing.summary()[0].desktopSketchId)}));expect(after.plane.origin[2]).toBeCloseTo(-.57,8);expect(after.figure.origin[2]).toBeCloseTo(-.57,8);expect(after.sketch.plane.origin[2]).toBeCloseTo(-.57,8);expect(after.figure.widthMetres).toBe(f.widthMetres);await page.evaluate(()=>quickEdit.studio.desktopHistory.undo());expect(await page.evaluate(()=>quickEdit.studio.desktopDrawing.summary()[0].origin[2])).toBeCloseTo(-.6,8);
 await page.locator('.cad-plane-label[data-plane-id="plane-front"]').click();const handle=await page.evaluate(()=>{const{studio}=quickEdit,c=studio.planeGizmo;c.getHelper().updateMatrixWorld(true);const rect=studio.renderer.domElement.getBoundingClientRect(),screen=v=>{v.project(studio.camera);return [rect.left+(v.x+1)*rect.width/2,rect.top+(1-v.y)*rect.height/2];},origin=screen(c.object.position.clone());const points=c._gizmo.gizmo.translate.children.filter(o=>o.name==='Z'&&o.visible&&o.geometry).map(o=>{o.geometry.computeBoundingBox();return screen(o.geometry.boundingBox.getCenter(studio.camera.position.clone()).applyMatrix4(o.matrixWorld));});const tip=points.sort((a,b)=>Math.hypot(b[0]-origin[0],b[1]-origin[1])-Math.hypot(a[0]-origin[0],a[1]-origin[1]))[0],dx=tip[0]-origin[0],dy=tip[1]-origin[1],n=Math.hypot(dx,dy);return {tip,end:[tip[0]+dx/n*28,tip[1]+dy/n*28]};});await page.mouse.move(...handle.tip);await page.mouse.down();await page.mouse.move(...handle.end,{steps:8});await page.mouse.up();await expect.poll(()=>page.evaluate(()=>Math.abs(quickEdit.studio.desktopDrawing.summary()[0].origin[2]+.6))).toBeGreaterThan(.001);await expect(page.locator('#cad-plane-status')).toContainText('Plane updated',{timeout:60000});const dragged=await page.evaluate(()=>({plane:quickEdit.studio.desktopPlane.origin,figure:quickEdit.studio.desktopDrawing.summary()[0].origin}));expect(dragged.figure[2]).toBeCloseTo(dragged.plane[2],8);});
test('failed native publication restores the starting drawing and reports its cause',async({page})=>{
 const receipts=[];
 await mockFit(page);await load(page);
 await page.route('**/api/agent/decision-preview?*',route=>{receipts.push(route.request().postDataJSON());return route.fulfill({json:{saved:true}});});
 await page.evaluate(()=>{
  const drawing=quickEdit.studio.desktopDrawing, dispatch=drawing.dispatch;
  drawing.dispatch=async(...args)=>{const result=await dispatch(...args);drawing.dispatch=dispatch;throw Error('simulated native publish failure');};
 });
 await ring(page);await page.locator('#decision-fit').click();
 await expect(page.locator('#decision-status')).toContainText('simulated native publish failure',{timeout:45000});
 await expect.poll(()=>page.evaluate(()=>quickEdit.studio.aiDraftReview.active)).toBe(false);
 expect(await page.evaluate(()=>quickEdit.studio.desktopDrawing.summary().length)).toBe(0);
 await expect.poll(()=>receipts.some(r=>r.state==='failed' && r.reason.includes('creating editable geometry'))).toBe(true);
 const fitVisible=await page.evaluate(()=>{const fit=quickEdit.studio.scene.getObjectByName('Decision result preview');return fit.visible&&fit.children.length>0;});
 expect(fitVisible).toBe(true);
 await page.locator('#decision-accept').click();
 await expect(page.locator('#decision-status')).toContainText('Accepted');
 expect(await page.evaluate(()=>quickEdit.studio.desktopDrawing.summary().length)).toBe(1);
});
test('standalone editable sketch commits while the solid rebuild indicator stays busy, with the fit visible during dispatch',async({page})=>{
 await mockFit(page);await load(page);await ring(page);
 await page.locator('#decision-auto-accept').uncheck();
 await page.locator('#decision-fit').click();await expect(page.locator('#decision-accept')).toBeEnabled();
 await page.evaluate(async()=>{
  const {studio}=quickEdit;await studio.desktopHistory.ready;
  const w=document.querySelector('#full-cad-workspace iframe').contentWindow;
  let current=w.__draw3dCAD;
  Object.defineProperty(w,'__draw3dCAD',{configurable:true,get:()=>({...current,busy:()=>true}),set:v=>{current=v;}});
  const dispatch=studio.desktopDrawing.dispatch;
  studio.desktopDrawing.dispatch=async(...args)=>{
   const preview=studio.scene.getObjectByName('Decision result preview');window.visibleWhileSaving=preview.visible&&preview.children.length>0;
   return dispatch(...args);
  };
 });
 await page.locator('#decision-accept').click();await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:10000});
 expect(await page.evaluate(()=>window.visibleWhileSaving)).toBe(true);
 expect(await page.evaluate(()=>{const {studio}=quickEdit,f=studio.desktopDrawing.summary()[0],doc=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document();return doc.nodes[f.objectId].data.objectKind;})).toBe('circle');
});
test('the local fit is drawn while the refinement request is still open',async({page})=>{
 const fit=await mockFit(page);await load(page);await ring(page);
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/agent/sketch-refine?*',async route=>{
  await gate;await route.fulfill({json:fit()});
 });
 await page.locator('#decision-auto-accept').uncheck();
 await page.locator('#decision-refine').check();
 const sent=page.waitForRequest(r=>r.url().includes('/sketch-refine?'));
 await page.locator('#decision-fit').click();await sent;
 try{
  expect(await page.evaluate(()=>{const p=quickEdit.studio.scene.getObjectByName('Decision result preview');return p.visible&&p.children.length>0;})).toBe(true);
  await expect(page.locator('#decision-accept')).toBeDisabled();
 }finally{release();}
 await expect(page.locator('#decision-status')).toContainText('Preview ready');
});
