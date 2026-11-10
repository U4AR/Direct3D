import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test.skip(!process.env.DRAW3D_INTENT_REPLAY,'Opt-in rendering of an isolated backend model replay');
test('semantic model output renders as editable native features and remains a preview until accepted',async({page})=>{
 test.setTimeout(120000);
 const replay=JSON.parse(await readFile(process.env.DRAW3D_INTENT_REPLAY,'utf8')),edit=structuredClone(replay.edit);
 expect(edit.question).toBeNull();expect(edit.continuation).toBeNull();if(replay.deviation){for(const p of replay.deviation)expect(p.result.max).toBeLessThanOrEqual(p.toleranceMetres*1.5+1e-8);expect(edit.edits.length).toBeGreaterThan(4);}else{expect(edit.edits.filter(e=>e.kind==='line').length).toBeGreaterThan(4);expect(edit.edits.filter(e=>e.kind==='arc').length).toBeGreaterThanOrEqual(2);expect(edit.edits.some(e=>e.kind==='spline')).toBe(false);}
 // Replay geometry unchanged in a fresh project. Original source IDs belong to
 // the original recording, so do not impersonate those inputs in this test.
 for(const e of edit.edits)e.strokeIds=[];
 let run=null,application;
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.intentReplay=e.detail));
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.route(/\/api\/agent\/(poll|ai-status)(\?|$)/,r=>r.fulfill({json:r.request().url().includes('/poll')?{job:null,ai:{ready:true,model:replay.model,run}}:{ready:true,model:replay.model,run}}));
 await page.route('**/api/agent/desktop-edit?*',r=>{run={id:crypto.randomUUID(),mode:'direct',model:replay.model,state:'running',step:1,events:[]};return r.fulfill({json:{ready:true,run,edit}});});
 await page.route('**/api/agent/desktop-applied?*',r=>{application=r.request().postDataJSON();run={...run,state:application.error?'failed':'completed',error:application.error,review:application.review};return r.fulfill({json:{ready:true,run,continuation:null}});});
 await page.route('**/api/agent/desktop-review?*',r=>r.fulfill({json:{saved:true}}));
 await page.goto('http://127.0.0.1:5191/desktop.html?session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});
 await expect(page.locator('body')).toHaveAttribute('data-desktop-ready','true',{timeout:30000});await page.locator('#desktop-auto-refine').uncheck();
 await page.selectOption('#cad-plane-library','plane-right');await page.click('#cad-plane-sketch');
 await page.locator('#agent-instruction-text').fill('Reconstruct this sketch');await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('#desktop-preview-accept')).toBeEnabled({timeout:70000});expect(application?.error).toBeFalsy();expect(application.appliedCount).toBe(edit.edits.length);
 await page.evaluate(()=>intentReplay.studio.planeView.refit());
 const before=await page.evaluate(async()=>{const {studio,store}=intentReplay;return {visible:studio.desktopDrawing.summary(),saved:await store.get('sessions',store.session.id)};});
 expect(before.visible).toHaveLength(edit.edits.length);expect(before.saved.desktopFigures?.length||0).toBe(0);
 await page.locator('#cad-dimensions-toggle').click();await page.screenshot({path:replay.deviation?'artifacts/desktop-measured-recorded-preview.png':'artifacts/desktop-intent-car-native-preview.png'});
 await page.locator('#desktop-preview-accept').click();await expect(page.locator('#desktop-ai-preview')).toBeHidden();
 expect(await page.evaluate(async()=>(await intentReplay.store.get('sessions',intentReplay.store.session.id)).desktopFigures.length)).toBe(edit.edits.length);
 console.log('INTENT_REPLAY_RENDER',JSON.stringify({model:replay.model,modelMs:replay.elapsedMs,calls:replay.providerCalls,figures:edit.edits.length,lines:edit.edits.filter(e=>e.kind==='line').length,arcs:edit.edits.filter(e=>e.kind==='arc').length}));
});
