import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {chairStrokes,continuousChairStrokes} from './spatial-fixtures.mjs';
// No route interception: this exercises the running server, provider, acknowledgement,
// context continuation, fitting, rendering and persistence through the production UI.
test('real backend turns an imperfect spatial sketch into a complete chair',async({page})=>{
 test.skip(process.env.DRAW3D_LIVE_AI!=='1','Opt-in real provider calls');test.setTimeout(240000);
 const requests=[],responses=[],errors=[],session=crypto.randomUUID();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/\/api\/agent\/(desktop-edit|desktop-applied)(\?|$)/.test(r.url())){const b=r.postDataJSON();requests.push({route:r.url().split('/').at(-1).split('?')[0],at:Date.now(),prompt:b.prompt,turn:b.previousTurn,figures:b.evidence?.figures.length,strokes:b.evidence?.strokes.length,images:b.evidence?.frames.length,receipts:b.evidence?.creationTimeline?.length,stopForUserInput:b.stopForUserInput,error:b.error});}});
 page.on('response',async r=>{if(/\/api\/agent\/(desktop-edit|desktop-applied)(\?|$)/.test(r.url()))try{const b=await r.json();responses.push({route:r.url().split('/').at(-1).split('?')[0],at:Date.now(),run:b.run,edit:b.edit,continuation:b.continuation});console.log(JSON.stringify({turn:b.run?.step,state:b.run?.state,summary:b.edit?.summary,continuation:!!b.continuation,error:b.run?.error}));}catch{}});
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.chairTest=e.detail));
 await page.goto('http://localhost:5173/?session='+session);await page.waitForFunction(()=>window.chairTest?.studio.modelAgent?.ready);
 await page.evaluate(async strokes=>{const {studio,store}=window.chairTest;studio.radius=.0025;for(const source of strokes){studio.begin('synthetic-chair',source.points[0]);for(const p of source.points.slice(1))studio.sample('synthetic-chair',p);studio.end('synthetic-chair');}await store.flush();await studio.spatialWorkflow.fit();},process.env.CHAIR_STROKES==='continuous'?continuousChairStrokes():chairStrokes());
 await page.evaluate(()=>{const {studio}=window.chairTest;studio.board.visible=false;for(const obj of studio.scene.children)if(obj.geometry?.type==='TorusGeometry')obj.visible=false;});
 const before=await page.evaluate(()=>({strokes:window.chairTest.store.session.strokes.length,points:window.chairTest.store.session.strokes.reduce((n,s)=>n+s.points.length,0)}));
 await page.screenshot({path:'artifacts/chair-synthetic-before.png'});
 const started=Date.now();await page.evaluate(()=>{window.chairFinished=window.chairTest.studio.modelAgent.submitInstruction('Make this a chair.','typed');});
 try{
 await expect.poll(()=>page.evaluate(()=>!window.chairTest.studio.modelAgent.busy),{timeout:180000,intervals:[500]}).toBe(true);
 const result=await page.evaluate(()=>({session:window.chairTest.store.session.id,figures:window.chairTest.store.session.spatialObjects,timeline:window.chairTest.store.session.creationTimeline,run:window.chairTest.store.session.lastAIRun,status:document.querySelector('#assistant-state').textContent,strokes:window.chairTest.store.session.strokes.length}));
 fs.writeFileSync('artifacts/chair-real-'+(process.env.CHAIR_STROKES||'separate')+'-e2e.json',JSON.stringify({session,started,elapsedMs:Date.now()-started,before,requests,responses,result,errors},null,2));
 await page.screenshot({path:'artifacts/chair-synthetic-after.png'});
 expect(result.status).toContain('Done');expect(result.run.state).toBe('completed');expect(result.run.automation?.steps.every(s=>s.state==='completed')).toBe(true);
 expect(result.strokes).toBe(before.strokes);expect(result.figures.length).toBeGreaterThanOrEqual(6);
 const physical=result.figures.filter(f=>['cuboid','cylinder','extrusion'].includes(f.kind));
 expect(physical.length).toBeGreaterThanOrEqual(6);
 const parts=physical.map(f=>{const p=f.parameters;return {name:f.name.toLowerCase(),center:p.center,size:p.sizeMetres||[p.radiusMetres*2,p.heightMetres,p.radiusMetres*2]};});
 const legs=parts.filter(p=>p.size&&p.size[1]>.3&&p.size[0]<.1&&p.size[2]<.1&&p.center[1]<.5);expect(legs).toHaveLength(4);
 expect(parts.some(p=>p.size?.[0]>.3&&p.size[2]>.3&&p.size[1]<.15)).toBe(true);
 const seat=parts.find(p=>p.size?.[0]>.3&&p.size[2]>.3&&p.size[1]<.15);
 for(const leg of legs){
   expect(Math.abs(leg.center[1]+leg.size[1]/2-(seat.center[1]-seat.size[1]/2))).toBeLessThan(.03);
   for(let d=0;d<3;d++)expect(Math.abs(leg.size[d]-legs[0].size[d])).toBeLessThan(.005);
 }
 for(const d of [0,2])expect(Math.abs(legs.reduce((n,l)=>n+l.center[d],0)/4-seat.center[d])).toBeLessThan(.02);
 expect(requests.filter(r=>r.route==='desktop-edit').every(r=>r.strokes===before.strokes&&r.images>=before.strokes+3)).toBe(true);

 expect(parts.some(p=>p.center?.[1]>.6&&p.size?.[0]>.3)).toBe(true);
 expect(requests.filter(r=>r.route==='desktop-applied').every(r=>!r.stopForUserInput&&!r.error)).toBe(true);
 expect(responses.filter(r=>r.edit).at(-1).edit.edits).toHaveLength(0);
 expect(errors).toEqual([]);
 await page.reload();await page.waitForFunction(()=>window.chairTest?.studio.spatialWorkflow);expect(await page.evaluate(()=>window.chairTest.store.session.spatialObjects.length)).toBe(result.figures.length);
 }finally{fs.writeFileSync('artifacts/chair-real-'+(process.env.CHAIR_STROKES||'separate')+'-http-trace.json',JSON.stringify({session,requests,responses,errors},null,2));}
});
