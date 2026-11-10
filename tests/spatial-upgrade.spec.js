import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';import {createInterface} from 'node:readline';
test('update page fits curves, corrects scale, exposes manipulation and follows object frame independently',async({page})=>{
 test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const proc=spawn('node',['scripts/draw3d-mcp.mjs'],{stdio:['pipe','pipe','pipe']});let seq=0,sessionId;const pending=new Map();
 createInterface({input:proc.stdout}).on('line',l=>{const m=JSON.parse(l);pending.get(m.id)?.(m);pending.delete(m.id)});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(Error('MCP timeout')),125000);pending.set(id,m=>{clearTimeout(t);resolve(m)});proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
 const call=async(name,args={})=>{const m=await rpc('tools/call',{name,arguments:{sessionId,...args}});if(m.error||m.result?.isError)throw Error(JSON.stringify(m.error||m.result));return JSON.parse(m.result.content.find(c=>c.type==='text').text)};
 try{
  await page.goto('http://localhost:5173/');await expect(page.locator('#agent-connection')).toContainText('PC connected',{timeout:20000});
  sessionId=await page.evaluate(()=>JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.startsWith('draw3d.agent.session.')))).id);
  await page.locator('#demo').click();const ctx=await call('draw3d_context');expect(ctx.capabilities.spatialTools).toBe(true);const stroke=ctx.strokes[0];
  const curve=await call('stroke_fit_curve',{strokeId:stroke.id,degree:5,controlCount:12,fairnessWeight:.00001});expect(curve.curve.degree).toBe(5);
  const sampled=await call('curve_get',{curveId:curve.id,samples:64});expect(sampled.samples.length).toBe(64);
  const refit=await call('curve_refit',{curveId:curve.id,expectedVersion:curve.version,degree:3});expect(refit.version).toBe(2);
  const doc=await call('sculpt_document');const made=await call('sculpt_create',{shape:'box',name:'Oversized test part',sizeMm:[2000,2000,2000],positionMm:[3000,3000,3000],expectedVersion:doc.revision});
  const models=(await call('scene_models')).models,model=models.find(m=>m.nativeId===made.id);expect(model).toBeTruthy();
  const fit=await call('model_fit_check',{modelIds:[model.id],strokeIds:[stroke.id]});expect(fit.grossMismatch).toBe(true);
  const matched=await call('model_match_sketch',{modelIds:[model.id],strokeIds:[stroke.id],expectedRevision:fit.sketchRevision,expectedVersions:fit.modelVersions});expect(matched.centerErrorMetres).toBeLessThan(.0001);
  const frame=await call('model_frame',{modelId:model.id});
  const conversion=await call('frame_convert',{modelId:model.id,expectedVersion:frame.version,from:'object',to:'world',points:[[0,0,0]]});conversion.points[0].forEach((v,i)=>expect(v).toBeCloseTo(frame.worldBounds.center[i],9));
  const before=await call('agent_status');await call('agent_camera',{referenceFrame:'object',modelId:model.id,expectedVersion:frame.version,position:[0,0,4],target:[0,0,0]});
  const m=(await call('scene_models')).models.find(m=>m.id===model.id);
  await call('model_transform',{modelId:m.id,expectedVersion:m.version,position:m.position.map((v,i)=>v+(i===0?.2:0)),rotationDeg:m.rotationDeg,scale:m.scale});
  const capture=await call('agent_capture',{modelIds:[m.id],width:256,height:256});expect(capture.camera.referenceFrame.version).toBe(m.version+1);
  const after=await call('agent_status');expect(after.userCamera).toEqual(before.userCamera);
  const fixture=JSON.parse(await readFile(new URL('./fixtures/pentagon-stroke.json',import.meta.url),'utf8'));
  await page.evaluate(async stroke=>{const db=await new Promise(res=>{const r=indexedDB.open('draw3d-studio');r.onsuccess=()=>res(r.result)});const id=localStorage.getItem('draw3d.active');const session=await new Promise(res=>{const r=db.transaction('sessions').objectStore('sessions').get(id);r.onsuccess=()=>res(r.result)});session.strokes=[stroke];await new Promise(res=>{const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put(session);tx.oncomplete=res;});},fixture.stroke);
  await page.reload();await expect(page.locator('#agent-connection')).toContainText('PC connected');
  sessionId=await page.evaluate(()=>JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.startsWith('draw3d.agent.session.')))).id);
  const simple=await call('primitive_from_strokes',{strokeIds:[fixture.stroke.id],shape:'polygon',sides:5,workspace:'cad',thicknessMetres:.01});expect(simple.modelIds).toHaveLength(1);expect(simple.models[0].source).toBe('cad');expect(simple.fitted.size).toContain(.01);expect(simple.fitted.polygon.vertices).toHaveLength(5);
  const native=(await call('cad_document')).document;const solid=native.derived.bodyRepresentations[simple.models[0].nativeId];expect(solid.exportableStep).toBe(true);expect(solid.volume).toBeGreaterThan(0);expect(solid.faceCount).toBe(7);
  const sketch=Object.values(native.nodes).find(n=>n.kind==='sketch'&&n.objectIds.length===5);const again=await call('cad_execute',{operation:'extrudeSketch',payload:{sketchId:sketch.sketchId,distance:12,operation:'new-body',name:'Line-loop regression'},expectedVersion:native.version});expect(again.diagnostics).toEqual([]);expect(again.command.payload.profile.sourceEntityIds).toHaveLength(5);
  const sculptPoly=await call('primitive_from_strokes',{strokeIds:[fixture.stroke.id],shape:'polygon',sides:5,workspace:'sculpt',thicknessMetres:.01});expect(sculptPoly.models[0].source).toBe('sculpt');expect(sculptPoly.fitted.polygon.vertices).toHaveLength(5);
  const visibleCount=(await call('scene_models')).models.filter(m=>!m.hidden).length;await page.locator('#objects-mode').click();await expect(page.locator('.object-tools')).toBeVisible();await page.getByRole('button',{name:'All objects',exact:true}).click();await expect(page.locator('.object-tools [data-label]')).toContainText(`${visibleCount} selected`);
  await page.getByRole('button',{name:'Unselect',exact:true}).click();await expect(page.locator('.object-tools [data-label]')).toContainText('Point');
  await page.getByRole('button',{name:'Done',exact:true}).click();await expect(page.locator('.object-tools')).toBeHidden();expect(errors).toEqual([]);
 }finally{proc.kill();}
});

test('XR object input moves, rotates, scales and persists a selected model',async({page})=>{
 await page.goto('http://localhost:5173/');
 const result=await page.evaluate(async()=>{
  const T=await import('/node_modules/three/build/three.module.js'),{initObjectManipulation}=await import('/src/object-manipulation.js');
  const canvas=document.createElement('canvas');document.body.append(canvas);const scene=new T.Scene(),camera=new T.PerspectiveCamera(),mesh=new T.Mesh(new T.BoxGeometry(.2,.2,.2));scene.add(mesh);mesh.updateMatrixWorld(true);
  const m={id:'test',mesh,version:1,position:[0,0,0],rotationDeg:[0,0,0],scale:[1,1,1]},models=new Map([[m.id,m]]);let persisted=0;const logs=[];
  const studio={container:document.body,scene,camera,renderer:{domElement:canvas,xr:{isPresenting:true}},controls:{},mode:'draw',endAll(){},updateHUD(){}};
  const objects=initObjectManipulation({studio,store:{log:(...v)=>logs.push(v)},models,apply:m=>{mesh.position.fromArray(m.position);mesh.rotation.set(...m.rotationDeg.map(T.MathUtils.degToRad));mesh.scale.fromArray(m.scale);mesh.updateMatrixWorld(true);},persist:async()=>{persisted++;},report:e=>{throw e}});
  objects.setEnabled(true);const ray=new T.Ray(new T.Vector3(0,0,1),new T.Vector3(0,0,-1));
  const frame=entries=>{objects.beginFrame();for(const [key,p]of entries)objects.input({key,ray,pose:new T.Matrix4().makeTranslation(...p),pressed:true,selectPressed:true,blocked:false});objects.endFrame();};
  frame([['left',[0,0,0]]]);frame([['left',[.1,.2,.3]]]);const moved=[...m.position];frame([]);
  frame([['left',[-.1,0,0]],['right',[.1,0,0]]]);frame([['left',[0,-.2,0]],['right',[0,.2,0]]]);frame([]);
  return {selected:objects.selectedIds,moved,scale:m.scale,rotation:m.rotationDeg,version:m.version,persisted,transforms:logs.filter(l=>l[0]==='objects.transform').length};
 });
 expect(result.selected).toEqual(['test']);result.moved.forEach((v,i)=>expect(v).toBeCloseTo([.1,.2,.3][i]));result.scale.forEach(v=>expect(v).toBeCloseTo(2));expect(result.rotation[2]).toBeCloseTo(90);expect(result.persisted).toBe(2);expect(result.transforms).toBe(2);expect(result.version).toBeGreaterThan(1);
});
