import {test,expect} from '@playwright/test';
import {assessMeasuredEdit} from '../scripts/desktop-measured-tool.mjs';
test.skip(process.env.DRAW3D_LIVE_MEASURED_TEST!=='1','Explicit live automatic sketch refinement');
test('automatic drawing refinement modifies the measured contour and stays within its geometry budget',async({page})=>{
 test.setTimeout(120000);let input,output,calls=0;
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.measuredLive=e.detail));await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 page.on('request',r=>{if(r.url().includes('/api/agent/desktop-edit?')){input=r.postDataJSON();calls++;}});
 page.on('response',async r=>{if(r.url().includes('/api/agent/desktop-edit?'))output=await r.json();});
 await page.goto('http://127.0.0.1:5191/desktop.html?session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});await expect(page.locator('body')).toHaveAttribute('data-desktop-ready','true',{timeout:30000});await expect(page.locator('#desktop-auto-refine')).toBeChecked();await page.locator('#desktop-flat').click();
 const r=await page.locator('#viewport canvas').boundingBox(),vertices=[[-.12,.2],[-.04,.23],[.1,.2],[.1,.08],[.01,.06],[.01,-.02],[.08,-.05],[.1,-.14],[.04,-.22],[-.08,-.2],[-.14,-.13],[-.12,-.05],[-.06,-.03],[-.06,.05],[-.12,.1],[-.12,.2]],pixel=p=>[r.x+r.width*.5+p[0]*550,r.y+r.height*.6-p[1]*550];
 for(let i=0;i<vertices.length;i++){const [x,y]=pixel(vertices[i]);await page.mouse.move(x,y,{steps:i?12:1});if(!i)await page.mouse.down();}await page.mouse.up();const start=Date.now();
 await expect(page.locator('#desktop-preview-accept')).toBeEnabled({timeout:70000});expect(output?.edit?.edits?.length).toBeGreaterThan(4);expect(calls).toBe(1);
 const deviation=assessMeasuredEdit(input.evidence,output.edit);for(const p of deviation)expect(p.result.max).toBeLessThanOrEqual(p.toleranceMetres*1.5+1e-8);
 const visible=await page.evaluate(()=>measuredLive.studio.desktopDrawing.summary());expect(visible).toHaveLength(output.edit.edits.length);
 const saved=await page.evaluate(()=>measuredLive.store.get('sessions',measuredLive.store.session.id));expect(saved.desktopFigures?.length||0).toBe(0);
 console.log('LIVE_MEASURED',JSON.stringify({previewMs:Date.now()-start,calls,figures:visible.length,deviation}));await page.screenshot({path:'artifacts/desktop-measured-live-preview.png'});
 await page.locator('#desktop-preview-accept').click();await expect(page.locator('#desktop-ai-preview')).toBeHidden();expect(await page.evaluate(async()=>(await measuredLive.store.get('sessions',measuredLive.store.session.id)).desktopFigures.length)).toBe(visible.length);
});
