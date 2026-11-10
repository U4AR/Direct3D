import {expect,test} from '@playwright/test';

import {dragHandle} from './viewport-transform-driver.mjs';
test('drag plane origin arrows and rotation rings directly',async({page})=>{
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.testWorkspace=e.detail));
 await page.goto('http://127.0.0.1:5191/desktop.html?experiment=decision&session='+crypto.randomUUID());
 await page.waitForFunction(()=>document.body.dataset.decisionReady==='true');
 await page.locator('#part-new-plane').click();await page.locator('#cad-plane-create').click();
 await expect(page.locator('#cad-plane-status')).toContainText('Plane created');
 const frame=()=>page.evaluate(()=>structuredClone(testWorkspace.studio.desktopPlane));
 const start=await frame();
 await dragHandle(page,'translate');await expect.poll(async()=>Math.hypot(...(await frame()).origin.map((v,k)=>v-start.origin[k]))).toBeGreaterThan(.001);
 await expect.poll(()=>page.evaluate(()=>testWorkspace.studio.planeEditor.moving)).toBe(false);
 const before=await frame();await dragHandle(page,'rotate');
 await expect.poll(async()=>{const p=await frame();return Math.max(...['xAxis','yAxis','normal'].flatMap(key=>p[key].map((v,k)=>Math.abs(v-before[key][k]))));}).toBeGreaterThan(.01);
});
