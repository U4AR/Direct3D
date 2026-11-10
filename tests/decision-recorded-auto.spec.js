import {test,expect} from '@playwright/test';import {readFile} from 'node:fs/promises';import path from 'node:path';
test.skip(!process.env.DRAW3D_DECISION_REPLAY,'Opt-in private local recorded drawing replay; no provider calls');
test('a real pointer stroke on its recorded plane automatically displays the returned preview',async({page})=>{
 test.setTimeout(90000);const folder=process.env.DRAW3D_DECISION_REPLAY,request=JSON.parse(await readFile(path.join(folder,'request.json'),'utf8')),saved=JSON.parse(await readFile(process.env.DRAW3D_DECISION_OUTPUT||path.join(folder,'result.json'),'utf8'));let calls=0;
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.autoReplay=e.detail));await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.route('**/api/agent/sketch-decisions?*',async r=>{calls++;const d=r.request().postDataJSON(),result=structuredClone(saved),ids=d.strokes.map(s=>s.id);result.id=crypto.randomUUID();for(const e of result.edits)e.strokeIds=ids;for(const e of result.results)e.sourceStrokeIds=ids;await r.fulfill({json:result});});
 await page.route('**/api/agent/decision-preview?*',r=>r.fulfill({json:{saved:true}}));
 await page.goto('http://127.0.0.1:5191/desktop.html?experiment=decision&session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true',{timeout:30000});
 await page.locator('#decision-refine').uncheck();await page.locator('#decision-auto-accept').uncheck();
 await page.selectOption('#cad-plane-library',request.data.strokes[0].plane.id);await page.locator('#cad-plane-sketch').click();
 const pixels=await page.evaluate(points=>{const {studio}=autoReplay,rect=studio.renderer.domElement.getBoundingClientRect();return points.map(p=>{const q=studio.camera.position.clone().fromArray(p).project(studio.camera);return [rect.left+(q.x+1)*rect.width/2,rect.top+(1-q.y)*rect.height/2];});},request.data.strokes[0].points);
 await page.mouse.move(...pixels[0]);await page.mouse.down();for(const p of pixels.slice(1))await page.mouse.move(...p);await page.mouse.up();
 await expect(page.locator('#decision-accept')).toBeEnabled({timeout:65000});await expect(page.locator('#decision-preview-controls')).toBeVisible();await expect(page.locator('#decision-preview-accept')).toBeEnabled();expect(calls).toBe(1);expect(await page.evaluate(()=>autoReplay.studio.decisionLab.pending.results.length)).toBe(saved.results.length);
 if(saved.edits.some(e=>e.extrusionMetres>0)){
  const getBody=()=>page.evaluate(()=>{
   const {studio}=autoReplay,figure=studio.desktopDrawing.summary().find(f=>f.extrusion),id=figure.extrusion.bodyId;
   const body=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document().derived.bodyRepresentations[id];
   return {id,name:figure.name,depth:figure.extrusion.distanceMetres,volume:body.volume,step:body.exportableStep,active:studio.aiDraftReview.active,visible:studio.surfaceModels().some(m=>m.nativeId===id&&!m.hidden)};
  });
  const preview=await getBody();expect(preview.volume).toBeGreaterThan(0);expect(preview.visible&&preview.step&&preview.active).toBe(true);
  expect(preview.depth).toBe(saved.edits.find(e=>e.extrusionMetres>0).extrusionMetres);
  await page.locator('#decision-preview-accept').click();await expect(page.locator('#decision-status')).toContainText('CAD model ready');
  const accepted=await getBody();expect(accepted.id).toBe(preview.id);expect(accepted.active).toBe(false);
  console.log('REPLAY_BODY',JSON.stringify(accepted));return;
 }
 const visuals=await page.evaluate(()=>({sourceHidden:[...autoReplay.studio.strokeMeshes.values()].every(m=>!m.visible),lineWidth:autoReplay.studio.scene.getObjectByName('Decision result preview').children[0].material.linewidth}));expect(visuals.sourceHidden).toBe(true);expect(visuals.lineWidth).toBe(3);if(process.env.DRAW3D_DECISION_SCREENSHOT)await page.screenshot({path:process.env.DRAW3D_DECISION_SCREENSHOT});
 console.log('RECORDED_AUTO_PREVIEW',JSON.stringify(await page.evaluate(()=>({status:document.querySelector('#decision-status').textContent,previewObjects:autoReplay.studio.scene.getObjectByName('Decision result preview').children.length,cases:autoReplay.store.session.decisionCases.length,strokeEvents:autoReplay.store.pending.filter(e=>e.type?.startsWith('stroke.')).map(e=>e.type)}))));
 await page.locator('#decision-preview-accept').click();await expect(page.locator('#decision-status')).toHaveText(/Accepted/,{timeout:60000});const accepted=await page.evaluate(()=>autoReplay.studio.desktopDrawing.summary());expect(accepted).toHaveLength(saved.results.length);expect(accepted[0].segments).toHaveLength(saved.edits[0].segments.length);
});
