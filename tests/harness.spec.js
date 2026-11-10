import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';

test('MCP constructs fitted curved surface, trims, mirrors and patterns without moving user',async({page})=>{
 test.setTimeout(240000);
 const proc=spawn('node',['scripts/draw3d-mcp.mjs'],{stdio:['pipe','pipe','pipe']});let seq=0;const pending=new Map();
 createInterface({input:proc.stdout}).on('line',line=>{const m=JSON.parse(line);pending.get(m.id)?.(m);pending.delete(m.id);});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(Error('MCP timeout')),130000);pending.set(id,m=>{clearTimeout(t);resolve(m)});proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
 let sessionId;
 const tool=async(name,args={})=>{const m=await rpc('tools/call',{name,arguments:name==='draw3d_sessions'?{}:name==='cad_command_help'?args:{sessionId,...args}});if(m.error||m.result?.isError)throw Error(name+': '+JSON.stringify(m.error||m.result));const content=m.result.content;return content[0].type==='image'?content:JSON.parse(content[0].text)};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://localhost:5173/');
  await expect(page.locator('#agent-connection')).toContainText('PC connected',{timeout:20000});
  const reg=await page.evaluate(()=>Object.keys(sessionStorage).find(k=>k.startsWith('draw3d.agent.session.')));
  sessionId=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)).id,reg);
  await page.locator('#demo').click();
  const catalog=await tool('stroke_catalog');expect(catalog.strokes.length).toBeGreaterThan(1);
  expect(new Set(catalog.strokes.map(s=>s.variable)).size).toBe(catalog.strokes.length);
  const picked=catalog.strokes.slice(0,2).map(s=>s.id);const loaded=await tool('stroke_load',{strokeIds:picked});expect(loaded.loaded.length).toBe(2);
  const frames=await tool('sketch_views',{strokeIds:picked,views:['front','right'],colorMode:'stroke',width:512,height:512});expect(frames.frames.length).toBe(2);expect(frames.frames[0].strokes.map(s=>s.variable)).toEqual(loaded.loaded.map(s=>s.name));expect(frames.frames[0].strokes[0].color).not.toBe(frames.frames[0].strokes[1].color);
  const before=await tool('agent_status');
  await tool('cad_command_help',{operation:'revolveSketch'});
  await tool('cad_create_project',{name:'Revolved solid regression',units:'mm'});
  const document=(await tool('cad_document')).document;
  const profile=await tool('cad_execute',{operation:'addSketch',expectedVersion:document.version,payload:{name:'Half profile',planeRef:{type:'canonical',plane:'XZ',offset:0},objects:[{objectKind:'rectangle',width:10,height:40,centerX:5,centerY:20}]}});
  const solid=await tool('cad_execute',{operation:'revolveSketch',expectedVersion:profile.version,payload:{name:'Rounded body via revolution',sketchId:profile.command.payload.ids.sketchId,axis:'vertical',angleDeg:360}});
  expect(solid.warnings).toEqual([]);
  const bodies=(await tool("scene_models",{includeGeometry:true})).models.filter(m=>m.source==="cad");
  expect(bodies.length).toBeGreaterThan(0);expect(bodies[0].triangleCount).toBeGreaterThan(0);
  const dimensions=[0,1,2].map(a=>{const values=bodies[0].vertices.filter((_,i)=>i%3===a);return Math.max(...values)-Math.min(...values)}).sort((a,b)=>a-b);
  dimensions.forEach((v,i)=>expect(v).toBeCloseTo([.02,.02,.04][i],4));

  const surface=await tool('surface_create',{kind:'equation',name:'Curved test canopy',x:'u*.4-.2',y:'1+.1*(1-(2*u-1)^2)',z:'v*.4-.2'});
  const points=Array.from({length:49},(_,i)=>{const u=(i%7)/6,v=Math.floor(i/7)/6;return [u*.4-.2,1+.12*(1-(2*u-1)**2)+.001*Math.sin(i),v*.4-.2]});
  const fit=await tool('surface_fit',{surfaceId:surface.id,expectedVersion:surface.version,points,fairnessWeight:.002,anchorWeight:.001});
  const trimmed=await tool('surface_trim',{surfaceId:surface.id,expectedVersion:fit.surface.version,uvPolygon:[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]});
  const sculpt=await tool('sculpt_document');
  const committed=await tool('surface_commit',{surfaceId:surface.id,expectedVersion:trimmed.version,expectedSculptVersion:sculpt.revision,uSegments:12,vSegments:12});
  let models=(await tool('scene_models')).models,model=models.find(m=>m.id===committed.modelId);expect(model).toBeTruthy();
  const mirror=await tool('model_mirror',{modelIds:[model.id],expectedVersions:{[model.id]:model.version},planeOrigin:[0,1,0],planeNormal:[0,1,0],name:'Canopy reflection'});
  models=(await tool('scene_models')).models;model=models.find(m=>m.id===committed.modelId);
  const pattern=await tool('model_pattern',{mode:'surface',modelIds:[model.id],expectedVersions:{[model.id]:model.version},surfaceId:surface.id,expectedSurfaceVersion:trimmed.version,pivot:[0,1,0],uvs:[[.25,.5],[.75,.5]],sourceNormal:[0,1,0]});
  const after=await tool('agent_status');for(const field of ['position','quaternion'])after.userCamera[field].forEach((v,i)=>expect(v).toBeCloseTo(before.userCamera[field][i],10));expect(after.userWorkspace).toBe(before.userWorkspace);
  expect((await tool('math_evaluate',{expression:'norm([3,4,0])',saveAs:'distance'})).value).toBe(5);
  await page.reload();await expect(page.locator('#agent-connection')).toContainText(sessionId.slice(0,8),{timeout:20000});
  expect((await tool('surface_get',{surfaceId:surface.id})).version).toBe(trimmed.version);
  await tool('agent_camera',{position:[.7,1.7,.8],target:[0,1,0]});const capture=await tool('agent_capture',{width:640,height:640});
  await mkdir('artifacts/agent/harness',{recursive:true});await writeFile('artifacts/agent/harness/surfaces.png',Buffer.from(capture[0].data,'base64'));
  await writeFile('artifacts/agent/harness/integration.json',JSON.stringify({fit:fit.diagnostics,trim:trimmed.trim,committed,mirror,pattern,errors},null,2));expect(errors).toEqual([]);
 }finally{proc.kill();}
});

test('design popup accepts speech, options, typed answers and routes them into the waiting run',async({page})=>{
 await page.goto('http://localhost:5173/');
 await page.goto('http://localhost:5173/tests/question-fixture.html');
 await page.evaluate(async()=>{
  const {initModelAgentUI}=await import('/src/model-agent-ui.js');
  document.body.innerHTML='<section id="panel"><p id="agent-connection"></p><form><input id="instruction"></form></section>';
  const session={strokes:[],transcripts:[],autoSpeechAgent:false};window.calls=[];window.xrQuestions=[];
  window.state={ready:true,model:'test',reasoning:'medium',run:null};
  const store={session,elapsed:()=>0,log:()=>{},flush:async()=>{},getAll:async()=>[]};
  window.ui=initModelAgentUI({panel:document.querySelector('#panel'),input:document.querySelector('#instruction'),store,studio:{setAgentState:()=>{},setAgentQuestion:q=>window.xrQuestions.push(q)},addTranscript:p=>{session.transcripts.push(p);window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:p}))},dispatch:async()=>({}),request:async(route,data)=>{if(route==='ai-answer'){window.calls.push({route,data});window.state.run={...window.state.run,state:'running',activity:'Using answer',question:{...window.state.run.question,status:'answered',answer:data.answer}}}return window.state;}});
  window.ask=(id)=>{window.state.run={id:'same-run',state:'waiting_for_answer',activity:'Question',question:{id,question:'Flat ornament or curved wings?',options:['Flat ornament','Curved wings'],status:'pending'}};window.ui.update(window.state)};window.ask('q1');
 });
 await expect(page.locator('#agent-question')).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:{id:'spoken1',source:'gemini-audio',text:'Curved wings with a rounded body'}})));
 await expect.poll(()=>page.evaluate(()=>window.calls.length)).toBe(1);
 expect(await page.evaluate(()=>window.calls[0].data)).toEqual({runId:'same-run',questionId:'q1',answer:'Curved wings with a rounded body',source:'speech'});
 await expect(page.locator('#agent-question')).toBeHidden();
 await page.evaluate(()=>window.ask('q2'));await page.getByRole('button',{name:'1. Flat ornament',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.calls.length)).toBe(2);
 await page.evaluate(()=>window.ask('q3'));await page.locator('#agent-answer-text').fill('Keep a little asymmetry');await page.getByRole('button',{name:'Send answer',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.calls.length)).toBe(3);
 expect(await page.evaluate(()=>window.calls.map(c=>c.data.source))).toEqual(['speech','option','typed']);
 expect(await page.evaluate(()=>window.xrQuestions.some(q=>q?.id==='q1'))).toBe(true);
});
