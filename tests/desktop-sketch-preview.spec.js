import {test,expect} from '@playwright/test';
const base=process.env.DRAW3D_FOCUS_TEST_URL||'http://localhost:5173';
test('mouse ink is interpreted in the background without showing fitted shapes',async({page})=>{
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.sketchTest=e.detail));await page.goto(base+'/desktop.html?session='+crypto.randomUUID());await expect(page.locator('body')).toHaveAttribute('data-desktop-ready','true');await page.locator('#desktop-auto-refine').uncheck();await page.locator('#desktop-flat').click();
 const box=await page.locator('#viewport canvas').boundingBox(),x=box.x+box.width*.45,y=box.y+box.height*.5;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+90,y,{steps:30});await page.mouse.move(x+90,y-65,{steps:25});await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>!!sketchTest.store.session.strokes[0]?.localFit)).toBe(true);
 expect(await page.evaluate(()=>sketchTest.studio.scene.getObjectByName('Local fitted stroke references').visible)).toBe(false);
 expect(await page.evaluate(()=>!!sketchTest.studio.scene.getObjectByName('Desktop fitted previews'))).toBe(false);
 await page.waitForTimeout(300);expect(await page.evaluate(()=>sketchTest.studio.scene.getObjectByName('Live proposed CAD shape').visible)).toBe(false);
 await page.screenshot({path:'artifacts/desktop-background-fitting.png'});
});
test('visible reference planes stay clickable while native geometry selection is active',async({page})=>{
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.sketchTest=e.detail));await page.goto(base+'/desktop.html?session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveAttribute('data-desktop-ready','true',{timeout:30000});await page.locator('#desktop-auto-refine').uncheck();
 const hit=await page.evaluate(()=>{const {studio}=sketchTest;studio.nativeSelection.setMode('face');const r=studio.renderer.domElement.getBoundingClientRect();for(let u=.15;u<.9;u+=.05)for(let v=.2;v<.85;v+=.05){const x=r.x+r.width*u,y=r.y+r.height*v,id=studio.planeView.pickPlaneAt(x,y);if(id)return {x,y,id};}return null;});expect(hit).not.toBeNull();await page.mouse.click(hit.x,hit.y);expect(await page.evaluate(()=>sketchTest.studio.desktopPlaneExplicit)).toBe(true);expect(await page.evaluate(()=>sketchTest.studio.desktopPlane.id)).toBe(hit.id);
});
test('choosing a plane anchors ink while Automatic asks AI to infer its support',async({page})=>{
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.sketchTest=e.detail));await page.goto(base+'/desktop.html?session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveAttribute('data-desktop-ready','true',{timeout:30000});await page.locator('#desktop-auto-refine').uncheck();
 await page.locator('#cad-plane-picker [data-plane="front"]').click();const box=await page.locator('#viewport canvas').boundingBox(),x=box.x+box.width*.6,y=box.y+box.height*.5;await page.mouse.dblclick(x,y);await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y+20,{steps:12});await page.mouse.up();
 const selected=await page.evaluate(()=>sketchTest.store.session.strokes.at(-1).drawingTarget);expect(selected.kind).toBe('plane');expect(selected.planeId).toBe('plane-front');
 await page.locator('#desktop-draw-auto').click();expect(await page.evaluate(()=>sketchTest.studio.desktopPlaneExplicit)).toBe(false);expect(await page.evaluate(()=>sketchTest.studio.mode)).toBe('draw');const count=await page.evaluate(()=>sketchTest.store.session.strokes.length),next=await page.locator('#viewport canvas').boundingBox(),nx=next.x+next.width*.55,ny=next.y+next.height*.55;await page.mouse.move(nx,ny);await page.mouse.down();await page.mouse.move(nx+45,ny+20,{steps:12});await page.mouse.up();expect(await page.evaluate(()=>sketchTest.store.session.strokes.length)).toBe(count+1);
 const inferred=await page.evaluate(()=>sketchTest.store.session.strokes.at(-1).drawingTarget);expect(inferred.kind).toBe('infer');expect(inferred.explicit).toBe(false);expect(inferred.referencePlane.origin).toHaveLength(3);
});
