// Opt-in real model test using only newly generated geometry in an empty recording.
import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';

test('live AI preserves the rounded end of a drawing in one low-reasoning request',async({page})=>{
 test.skip(process.env.DRAW3D_LIVE_AI!=='1','Opt-in synthetic live AI request');test.setTimeout(240000);
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.desktopTest=e.detail));
 await page.goto('http://localhost:5173/desktop.html?session='+crypto.randomUUID());await expect(page.locator('body')).toHaveAttribute('data-desktop-ready','true',{timeout:30000});await expect(page.locator('#ai-run')).toBeEnabled({timeout:30000});
 expect(await page.evaluate(()=>window.desktopTest.store.session.strokes.length)).toBe(0);await page.locator('#desktop-flat').click();await page.locator('#desktop-auto-refine').check();
 await page.evaluate(()=>{
  const {studio}=window.desktopTest,p=studio.desktopPlane,points=[],r=.055,cx=.13;
  const at=(u,v)=>p.origin.map((o,j)=>o+p.xAxis[j]*u+p.yAxis[j]*v);
  const line=(a,b,n)=>{const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);for(let i=0;i<n;i++){const t=i/n,w=.001*Math.sin(t*Math.PI)*Math.sin(t*17);points.push(at(a[0]+t*dx-dy/length*w,a[1]+t*dy+dx/length*w));}};
  line([-.2,-r],[-.2,r],30);line([-.2,r],[cx,r],45);
  for(let i=0;i<=70;i++){const a=Math.PI/2-i*Math.PI/70,k=r*(1+.018*Math.sin(i*.7));points.push(at(cx+k*Math.cos(a),k*Math.sin(a)));}
  line([cx,-r],[-.2,-r],45);points.push(at(-.2,-r));studio.begin('generated-rounded-tab',points[0]);points.slice(1).forEach(p=>studio.sample('generated-rounded-tab',p));studio.end('generated-rounded-tab');
 });
 await expect.poll(()=>page.evaluate(()=>{const r=window.desktopTest.store.session.lastAIRun;return r&&['completed','failed','stopped'].includes(r.state)?r.state:'waiting';}),{timeout:210000}).not.toBe('waiting');await page.locator('#desktop-auto-refine').uncheck();
 const state=await page.evaluate(()=>{const {studio,store}=window.desktopTest,figures=studio.desktopDrawing.summary(),doc=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document();return {run:store.session.lastAIRun,figures,paths:figures.map(f=>studio.desktopDrawing.points(f).map(p=>p.toArray())),nativeKinds:Object.values(doc.nodes).map(n=>n.data?.objectKind).filter(Boolean),bodies:Object.keys(doc.derived.bodyRepresentations||{})};});
 await writeFile('artifacts/live-rounded-profile.json',JSON.stringify(state,null,2));expect(state.run.state,state.run.error||state.run.answer).toBe('completed');expect(state.run.providerCallCount).toBe(1);expect(state.run.reasoning).toBe('low');expect(state.figures.length).toBeGreaterThan(0);expect(state.figures.every(f=>['line','arc','spline'].includes(f.kind))).toBe(true);expect(state.bodies).toHaveLength(0);expect(state.nativeKinds).toContain('arc');
 const curves=state.figures.filter(f=>f.kind==='arc');expect(curves).toHaveLength(1);expect(curves[0].radiusMetres).toBeCloseTo(.055,2);const sweep=((curves[0].endAngleDeg-curves[0].startAngleDeg)%360+360)%360;expect(sweep).toBeCloseTo(180,1);
 const vertices=new Map();for(const path of state.paths)for(const p of [path[0],path.at(-1)]){const key=p.map(n=>n.toFixed(5)).join(',');vertices.set(key,(vertices.get(key)||0)+1);}expect([...vertices.values()].every(n=>n===2)).toBe(true);
 const pts=state.paths.flat(),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);expect(Math.max(...xs)).toBeGreaterThan(.17);expect(Math.max(...xs)-Math.min(...xs)).toBeGreaterThan(.32);expect(Math.max(...xs)-Math.min(...xs)).toBeLessThan(.44);expect(Math.max(...ys)-Math.min(...ys)).toBeGreaterThan(.09);expect(Math.max(...ys)-Math.min(...ys)).toBeLessThan(.15);
 const request=JSON.parse(await readFile('sessions/desktop-edits/'+state.run.id+'/request.json','utf8'));expect(request.body.tools).toBeUndefined();expect(request.body.reasoning.effort).toBe('low');expect(state.run.events.some(e=>e.kind==='recovery')).toBe(false);expect(state.run.events.some(e=>e.kind==='timing'&&e.details.durationMs>0)).toBe(true);await expect(page.locator('#ai-model')).toContainText('low reasoning');await expect(page.locator('#cad-dimension-labels')).toContainText('mm');await page.screenshot({path:'artifacts/live-rounded-profile.png'});console.log('Synthetic rounded tab:',state.run.providerCallCount,'request,',state.run.providerDurationMs,'ms provider time;',curves.length,'native curved portion(s).');
});
