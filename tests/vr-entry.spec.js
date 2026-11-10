import {test,expect} from '@playwright/test';
async function setup(page,getRun){
 await page.setViewportSize({width:1280,height:670});
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.entryTest=e.detail));
 await page.route(/\/api\/agent\/poll(\?|$)/,async route=>{const response=await route.fetch();const json=await response.json();json.ai={ready:true,model:'entry-test',reasoning:'low',run:getRun()};await route.fulfill({response,json});});
 await page.goto('http://localhost:5173/?session='+crypto.randomUUID());
 await page.waitForFunction(()=>window.entryTest?.studio.modelAgent?.ready);
}
const failure=()=>({id:'old-failure',state:'failed',model:'old-model',step:1,error:'Old provider error. '+('a very long failure message '.repeat(45)),events:[]});
test('long AI failures and expanded logs cannot cover Enter VR in a compact headset window',async({page})=>{
 const run=failure();await setup(page,()=>run);
 await expect(page.locator('#assistant-state')).toContainText('AI failed');
 const bounds=await page.evaluate(()=>{const v=document.querySelector('#viewport').getBoundingClientRect(),l=document.querySelector('#ai-live-log').getBoundingClientRect(),b=document.querySelector('#vr'),r=b.getBoundingClientRect();return {inside:l.top>=v.top&&l.bottom<=v.bottom,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
 expect(bounds.inside).toBe(true);expect(bounds.hit).toBe(true);
 await page.evaluate(()=>{window.xrCalls=0;Object.defineProperty(navigator,'xr',{configurable:true,value:{isSessionSupported:()=>new Promise(()=>{}),requestSession(){window.xrCalls++;return Promise.reject(Error('Synthetic XR entry reached'));}}});});
 await page.locator('#vr').click();
 await expect(page.locator('#notice')).toContainText('Synthetic XR entry reached');
 expect(await page.evaluate(()=>window.xrCalls)).toBe(1);await expect(page.locator('#vr')).toBeEnabled();
});
test('a saved AI failure becomes history when the current backend is ready with no run',async({page})=>{
 let run=failure();await setup(page,()=>run);
 await expect(page.locator('#assistant-state')).toContainText('AI failed');run=null;
 await expect(page.locator('#assistant-state')).toContainText('AI ready');
 await expect(page.locator('#ai-live-state')).not.toContainText('FAILED');
 const saved=await page.evaluate(()=>({current:window.entryTest.store.session.lastAIRun,previous:window.entryTest.store.session.previousAIRun,entries:window.entryTest.store.session.aiActivity}));
 expect(saved.current).toBeUndefined();expect(saved.previous.id).toBe('old-failure');expect(saved.previous.error).toContain('Old provider error');expect(saved.entries.some(e=>e.message==='Previous AI failure · saved in history')).toBe(true);
});
