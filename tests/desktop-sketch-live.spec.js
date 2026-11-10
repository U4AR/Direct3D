import {test,expect} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
test.skip(process.env.DRAW3D_LIVE_SKETCH_TEST!=='1','Explicit paid model smoke test');
test('real model receives mouse drawing, projects it with the local tool and creates native editable geometry',async({page})=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.liveSketch=e.detail));
 await page.goto((process.env.DRAW3D_FOCUS_TEST_URL||'http://localhost:5173')+'/desktop.html?session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveAttribute('data-desktop-ready','true',{timeout:30000});
 await page.locator('#desktop-auto-refine').uncheck();await page.locator('#desktop-flat').click();
 const box=await page.locator('#viewport canvas').boundingBox(),x=box.x+box.width*.42,y=box.y+box.height*.5;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+90,y,{steps:24});await page.mouse.move(x+90,y-60,{steps:24});await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>liveSketch.studio.desktopSketchPreview.lastTiming)).not.toBeNull();
 await expect.poll(()=>page.evaluate(()=>liveSketch.studio.modelAgent.ready),{timeout:20000}).toBe(true);
 const started=Date.now();await page.locator('#agent-instruction-text').fill('Use project_sketch to fit my drawn corner with lines on its current plane and apply it immediately. Keep it a flat 2D sketch.');await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>liveSketch.studio.desktopDrawing.summary().length),{timeout:70000}).toBeGreaterThan(0);
 const report=await page.evaluate(()=>({timing:liveSketch.studio.desktopSketchPreview.lastTiming,figures:liveSketch.studio.desktopDrawing.summary().map(f=>({kind:f.kind,origin:f.origin,segments:f.segments?.length})),status:document.querySelector('#ai-status').textContent,log:document.querySelector('#ai-live-log')?.innerText}));report.totalEditMs=Date.now()-started;report.errors=errors;console.log('LIVE_SKETCH_REPORT',JSON.stringify(report));await mkdir('artifacts',{recursive:true});await writeFile('artifacts/desktop-sketch-live-report.json',JSON.stringify(report,null,2));await page.screenshot({path:'artifacts/desktop-sketch-live.png'});expect(errors).toEqual([]);expect(report.timing.previewMs).toBeLessThan(2000);
});
