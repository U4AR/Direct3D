import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {groupStrokes} from '../src/decision-sketch/recognize.js';
import {fitDecisionResponse} from '../scripts/decision-sketch-api.mjs';
test('benchmark report compares all cases and loads the extracted car into a fresh experiment',async({page})=>{
 test.setTimeout(120000);const saved=JSON.parse(await readFile('artifacts/generated-sketches-v1/combined.json','utf8')),car=saved.results.find(r=>r.id==='car');
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.generatedTest=e.detail));await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.route('**/api/agent/sketch-decisions?*',async route=>{const d=route.request().postDataJSON(),result=fitDecisionResponse(d,groupStrokes(d.strokes,d.plane),{answers:car.result.decisions});await route.fulfill({json:{...result,id:crypto.randomUUID(),method:'Saved API decisions replay',cost:{usd:0,usageKnown:true},timings:{apiMs:0},input:{},warnings:[]}});});
 await page.route('**/api/agent/decision-feedback?*',r=>r.fulfill({json:{saved:true}}));
 await page.goto('http://127.0.0.1:5191/benchmarks/decision-images-v1/index.html',{waitUntil:'domcontentloaded'});await expect(page.locator('article')).toHaveCount(12);await page.selectOption('#view','extracted');await expect(page.locator('article .extracted').first()).toBeVisible();
 await page.locator('article').filter({has:page.locator('a[data-case="car"]')}).locator('a.try-case').click();await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true',{timeout:30000});
 expect(await page.evaluate(()=>generatedTest.store.session.strokes.length)).toBe(3);await expect(page.locator('#decision-auto')).not.toBeChecked();
 await page.locator('#decision-fit').click();await expect(page.locator('#decision-accept')).toBeEnabled();await page.locator('#decision-accept').click();await expect(page.locator('#decision-status')).toHaveText(/Accepted/,{timeout:70000});
 const geometry=await page.evaluate(()=>({figures:generatedTest.studio.desktopDrawing.summary(),constraints:generatedTest.store.session.decisionSketches}));expect(geometry.figures).toHaveLength(3);expect(geometry.figures.filter(f=>f.kind==='circle')).toHaveLength(2);expect(geometry.constraints).toHaveLength(3);
});
