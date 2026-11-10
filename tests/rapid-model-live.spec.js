import {test,expect} from '@playwright/test';import fs from 'node:fs';
import {runDesktopEdit} from '../scripts/desktop-edit.mjs';import {newDesktopContext,recordContextApplication} from '../scripts/desktop-context.mjs';
if(process.env.DRAW3D_LIVE_AI==='1')for(const l of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
test.afterEach(async({page})=>{await page.unrouteAll({behavior:'ignoreErrors'});});
for(const model of ['gemini-3.8-flash','gemini-4-argon'])test(model+' real visible CAD construction and latency',async({page})=>{
 test.skip(process.env.DRAW3D_LIVE_AI!=='1','Opt-in actual AI Studio calls');test.setTimeout(240000);
 const originalDir=process.env.SESSION_DIR;process.env.SESSION_DIR='artifacts/rapid-live-recordings';let run,context,currentEdit;const measurements=[],inputs=[];
 const info=()=>({ready:true,model,reasoning:'low',run:run?{...run,controller:undefined}:null});
 await page.route(/\/api\/agent\/(poll|ai-status)(\?|$)/,async route=>{const response=await route.fetch(),json=await response.json();if(route.request().url().includes('/poll'))json.ai=info();else Object.assign(json,info());await route.fulfill({response,json});});
 await page.route(/\/api\/agent\/desktop-edit(\?|$)/,async route=>{
  const body=route.request().postDataJSON();inputs.push({model,figures:body.evidence.figures.length,images:body.evidence.frames.length,receipts:body.evidence.creationTimeline?.length||0});
  if(!body.continueRunId){context=newDesktopContext();run={id:crypto.randomUUID(),model,mode:'direct',state:'running',step:1,prompt:body.prompt,promptSource:body.promptSource,events:[],moves:[],controller:new AbortController()};}else{run.step++;if(run.step>7)throw Error('Model did not finish within seven visible moves');}
  const started=Date.now();const edit=await runDesktopEdit({run,prompt:run.prompt,promptSource:run.promptSource,evidence:body.evidence,signal:run.controller.signal,context,continuationContext:body.continueRunId?{requestedMove:{nextMove:currentEdit.continuation.nextMove},priorMoves:run.moves,automation:run.automation}:undefined});currentEdit=edit;run.edit=edit;
  const timing=run.events.filter(e=>e.kind==='timing').at(-1)?.details;
  measurements.push({model,turn:run.step,requestAt:started,providerMs:Date.now()-started,firstOutputMs:run.firstOutputMs,providerTier:timing?.providerTier,kinds:edit.edits.map(e=>e.kind),summary:edit.summary,continuation:edit.continuation,thinking:run.reasoning});
  await route.fulfill({json:{...info(),edit}});
 });
 await page.route(/\/api\/agent\/desktop-applied(\?|$)/,async route=>{
  const body=route.request().postDataJSON();if(body.error)throw Error(body.error);recordContextApplication(context,{runId:run.id,turn:run.step,appliedCount:body.appliedCount,review:body.review});
  run.moves.push({turn:run.step,output:currentEdit,application:body});run.review=body.review;run.answer=currentEdit.summary;const more=currentEdit.continuation&&!body.stopForUserInput;run.state=more?'running':'completed';
  const last=measurements.at(-1),receipt=body.review?.operationTrace?.filter(s=>s.phase==='applied').at(-1);last.visibleMoveMs=last.kinds.length?(receipt?.at||Date.now())-last.requestAt:null;last.meetsFiveSeconds=last.visibleMoveMs===null?null:last.visibleMoveMs<=5000;
  await route.fulfill({json:{...info(),continuation:more?{runId:run.id,previousTurn:run.step,requestedSketchIds:[],reason:currentEdit.continuation.reason,nextMove:currentEdit.continuation.nextMove}:null}});
 });
 try{
  await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.liveSpeed=e.detail));await page.goto('http://localhost:5173/?session='+crypto.randomUUID());await page.waitForFunction(()=>window.liveSpeed?.studio.modelAgent?.ready);
  await page.evaluate(async()=>{await window.liveSpeed.studio.modelAgent.submitInstruction('Create exactly one cylinder centered at [0,1,-0.6] metres, with radius 20 mm and full height 100 mm along world Y. No other objects.','typed');});
  await expect(page.locator('#assistant-state')).toContainText('Done');expect(await page.evaluate(()=>window.liveSpeed.store.session.spatialObjects.map(f=>f.kind))).toEqual(['cylinder']);
  await page.evaluate(async()=>{await window.liveSpeed.studio.modelAgent.submitInstruction('Keep the existing cylinder. Separately, at center [0.3,1,-0.6] in world XY, visibly create a 200 mm square reference plane, then sketch an exact 40 mm diameter circle on that plane, then extrude that circle by 100 mm along +Z. Use separate visible moves and preserve the editable source plane and sketch. No extra geometry.','typed');});
  await expect(page.locator('#assistant-state')).toContainText('Done');
  const result=await page.evaluate(()=>({figures:window.liveSpeed.store.session.spatialObjects,timeline:window.liveSpeed.store.session.creationTimeline}));const kinds=result.figures.map(f=>f.kind);expect(measurements.at(-1).kinds).toEqual([]);expect(inputs.at(-1).figures).toBeGreaterThanOrEqual(4);expect(kinds).toContain('plane');expect(kinds).toContain('circle3d');expect(kinds).toContain('extrusion');
  const record={model,measurements,inputs,figures:result.figures.map(({id,kind,parameters})=>({id,kind,parameters})),timeline:result.timeline};fs.writeFileSync('artifacts/rapid-'+model+'-benchmark.json',JSON.stringify(record,null,2));console.log(JSON.stringify({model,moves:measurements.map(m=>({kinds:m.kinds,providerMs:m.providerMs,visibleMoveMs:m.visibleMoveMs,firstOutputMs:m.firstOutputMs,meetsFiveSeconds:m.meetsFiveSeconds}))}));
  await page.screenshot({path:'artifacts/rapid-'+model+'-construction.png'});
 }finally{if(originalDir===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=originalDir;}
});
