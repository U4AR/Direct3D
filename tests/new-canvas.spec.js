import{test,expect}from '@playwright/test';
test('new collaborative canvas preserves the prior drawing and isolates CAD',async({page})=>{
 test.setTimeout(90000);await page.goto('http://localhost:5173/');await expect(page.locator('#agent-connection')).toContainText('PC connected');
 const old=await page.evaluate(()=>localStorage.getItem('draw3d.active'));
 await page.locator('#demo').click();await expect(page.locator('#geometry-count')).toContainText('15 strokes');
 await page.locator('#new-session').click();await expect(page.locator('#geometry-count')).toContainText('0 strokes');
 const current=await page.evaluate(()=>localStorage.getItem('draw3d.active'));expect(current).not.toBe(old);
 expect(await page.evaluate(async old=>{const db=await new Promise(r=>{const q=indexedDB.open('draw3d-studio',1);q.onsuccess=()=>r(q.result)});return new Promise(r=>{const q=db.transaction('sessions').objectStore('sessions').get(old);q.onsuccess=()=>r(q.result.strokes.length)})},old)).toBe(15);
 await page.locator('#workspace-full-cad').click();await expect.poll(()=>page.evaluate(()=>{const a=document.querySelector('iframe[title="Full parametric CAD workspace"]')?.contentWindow?.__draw3dCAD;const d=a?.document();return d?.nodes?.[d.rootNodeId]?.name}),{timeout:45000}).toContain('Collaborative canvas');
 expect(await page.evaluate(()=>document.querySelector('iframe[title="Full parametric CAD workspace"]').contentWindow.__draw3dCAD.document().derived?.bodyRepresentations||{})).toEqual({});
});
