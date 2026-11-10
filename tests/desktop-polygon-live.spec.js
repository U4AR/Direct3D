// Opt-in live validation uses a new generated drawing, never a saved user sketch.
import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';

test('live AI interprets a rough fitted chamfered outline as a connected line profile',async({page})=>{
 test.skip(process.env.DRAW3D_LIVE_AI!=='1','Opt-in synthetic live AI request');test.setTimeout(240000);
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.desktopTest=e.detail));
 await page.goto('http://localhost:5173/desktop.html?session='+crypto.randomUUID());
 await expect(page.locator('body')).toHaveAttribute('data-desktop-ready','true',{timeout:30000});await expect(page.locator('#ai-run')).toBeEnabled({timeout:30000});
 expect(await page.evaluate(()=>window.desktopTest.store.session.strokes.length)).toBe(0);
 await page.locator('#desktop-flat').click();await page.locator('#desktop-auto-refine').check();
 const strokeId=await page.evaluate(()=>{
  const {studio,store}=window.desktopTest,p=studio.desktopPlane,vertices=[[-.105,.07],[.14,.07],[.14,-.07],[-.105,-.07],[-.14,-.035],[-.14,.035]],points=[];
  for(let side=0;side<vertices.length;side++){const a=vertices[side],b=vertices[(side+1)%vertices.length],dx=b[0]-a[0],dy=b[1]-a[1],n=Math.hypot(dx,dy);for(let i=0;i<24;i++){const t=i/24,w=.0015*Math.sin(t*Math.PI)*Math.sin(t*13+side),u=a[0]+dx*t-dy/n*w,v=a[1]+dy*t+dx/n*w;points.push(p.origin.map((o,j)=>o+p.xAxis[j]*u+p.yAxis[j]*v));}}
  points.push(p.origin.map((o,j)=>o+p.xAxis[j]*(vertices[0][0]+.001)+p.yAxis[j]*vertices[0][1]));
  studio.begin('generated-angular-profile',points[0]);points.slice(1).forEach(p=>studio.sample('generated-angular-profile',p));studio.end('generated-angular-profile');return store.session.strokes.at(-1).id;
 });
 await expect.poll(()=>page.evaluate(()=>{const r=window.desktopTest.store.session.lastAIRun;return r&&['completed','failed','stopped'].includes(r.state)?r.state:'waiting';}),{timeout:210000}).not.toBe('waiting');
 await page.locator('#desktop-auto-refine').uncheck();
 const state=await page.evaluate(()=>{const {studio,store}=window.desktopTest,doc=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document();return {run:store.session.lastAIRun,figures:studio.desktopDrawing.summary(),nativeKinds:Object.values(doc.nodes).map(n=>n.data?.objectKind).filter(Boolean),bodies:Object.keys(doc.derived.bodyRepresentations||{})};});
 expect(state.run.state,state.run.error||state.run.answer).toBe('completed');expect(state.figures).toHaveLength(6);expect(state.figures.every(f=>f.kind==='line'&&f.strokeIds.includes(strokeId)&&f.planeId==='plane-front')).toBe(true);expect(state.nativeKinds.filter(k=>k==='line')).toHaveLength(6);expect(state.nativeKinds).not.toContain('spline');expect(state.bodies).toHaveLength(0);
 const vertices=new Map();for(const f of state.figures)for(const p of [f.origin,f.end]){const key=p.map(n=>n.toFixed(6)).join(',');vertices.set(key,(vertices.get(key)||0)+1);}expect(vertices.size).toBe(6);expect([...vertices.values()].every(n=>n===2)).toBe(true);
 expect(state.run.providerCallCount).toBe(1);const request=JSON.parse(await readFile('sessions/desktop-edits/'+state.run.id+'/request.json','utf8'));expect(request.evidence.strokes[0].fit.selected.parameters).toBeTruthy();expect(request.body.tools).toBeUndefined();expect(request.evidence.frames.some(f=>f.layer==='stroke'&&f.strokeIds.includes(strokeId))).toBe(true);
 await expect(page.locator('#cad-dimension-labels')).toContainText('mm');await page.screenshot({path:'artifacts/live-angular-profile.png'});await writeFile('artifacts/live-angular-profile.json',JSON.stringify({run:state.run,figures:state.figures,nativeKinds:state.nativeKinds,sourceFit:request.evidence.strokes[0].fit.selected.kind,vertexCount:vertices.size},null,2));console.log('Synthetic angular profile:',state.run.providerCallCount,'AI request(s), six native straight edges, no solid.');
});
