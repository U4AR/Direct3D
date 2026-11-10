import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test.skip(!process.env.DRAW3D_COMPONENT_REPLAY,'Opt-in private replay in a fresh isolated browser project');
test('recorded rectangle and repeated components preview then publish native geometry with relation references',async({page})=>{
 test.setTimeout(120000);const {data,result}=JSON.parse(await readFile(process.env.DRAW3D_COMPONENT_REPLAY,'utf8'));expect(result.componentRelations).toHaveLength(1);
 // Keep source IDs internally consistent while never using the original recording.
 const ids=new Map(data.strokes.map(s=>[s.id,crypto.randomUUID()]));for(const s of data.strokes)s.id=ids.get(s.id);for(const r of result.results)r.sourceStrokeIds=r.sourceStrokeIds.map(id=>ids.get(id));for(const e of result.edits)e.strokeIds=e.strokeIds.map(id=>ids.get(id));
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.relationTest=e.detail));
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.route('**/api/agent/sketch-decisions?*',r=>r.fulfill({json:result}));
 for(const route of ['decision-preview','decision-feedback'])await page.route('**/api/agent/'+route+'?*',r=>r.fulfill({json:{saved:true}}));
 await page.goto('http://127.0.0.1:5191/desktop.html?experiment=decision&refine=off&session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true',{timeout:45000});await page.locator('#decision-auto').uncheck();await page.locator('#decision-auto-accept').uncheck();
 await page.evaluate(data=>{const {studio,store}=relationTest;studio.planeEditor.choose(data.plane.id);for(const s of data.strokes){const raw={...s,drawingPlane:s.plane||data.plane,radius:.0005,color:'#80aaff'};store.session.strokes.push(raw);studio.addStrokeMesh(raw);}store.session.revision++;},data);
 await page.locator('#decision-fit').click();await expect(page.locator('#decision-accept')).toBeEnabled();expect(await page.evaluate(()=>relationTest.studio.desktopDrawing.summary().length)).toBe(0);await page.locator('#decision-accept').click();await expect(page.locator('#decision-status')).toContainText('Accepted',{timeout:60000});
 const saved=await page.evaluate(()=>({figures:relationTest.studio.desktopDrawing.summary(),metadata:relationTest.store.session.decisionSketches}));expect(saved.figures).toHaveLength(3);expect(saved.figures.every(f=>f.kind==='rectangle')).toBe(true);expect(saved.figures[1].widthMetres).toBe(saved.figures[2].widthMetres);expect(saved.figures[1].heightMetres).toBe(saved.figures[2].heightMetres);
 const idsOut=saved.figures.map(f=>f.id);for(const m of saved.metadata)for(const c of m.constraints.componentRelations||[]){expect(idsOut).toContain(c.referenceId);expect(idsOut).toContain(c.parentId);expect(c.type).toBe('mirror_u');}
});
