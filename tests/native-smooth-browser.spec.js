import {test,expect} from '@playwright/test';import fs from 'node:fs';
const base=process.env.DRAW3D_TEST_URL||'http://localhost:18890';
test('browser bridges smooth guides, native sweeps and curved surface features without losing profiles',async({page})=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.smoothHarness=e.detail));
 await page.goto(base+'/concepts.html?session='+crypto.randomUUID());await page.waitForFunction(()=>window.smoothHarness?.studio.modeling.health.engines.freecad.ready);
 const r=await page.evaluate(async()=>{
  const {studio}=smoothHarness;const apply=async(edit,evidence)=>{const r=await studio.modeling.apply([{engine:'freecad',modelId:null,expectedVersion:null,tools:[],keepTools:true,...edit}],evidence||await studio.modelAgentEvidence());return studio.surfaceModels().find(m=>m.id===r.review.modelIds[0]);};
  const path=await apply({operation:'create_bspline',name:'Smooth 3D guide',parameters:{center:[0,0,0],points3D:[[0,0,0],[0,0,.02],[.005,.002,.04],[.015,.008,.06]],closed:false}}),profile=await apply({operation:'create_sketch',name:'Tube profile',parameters:{center:[0,0,0],radiusMetres:.002}});
  const tube=await apply({operation:'sweep',name:'Smooth handle',modelId:profile.id,expectedVersion:profile.version,tools:[{modelId:path.id,expectedVersion:path.version}],parameters:{solid:true,frenet:true}});
  const pipe=await apply({operation:'create_pipe',name:'One action smooth pipe',parameters:{center:[.1,0,0],points3D:[[0,0,0],[0,0,.02],[.005,.002,.04],[.015,.008,.06]],radiusMetres:.002,closed:false,frenet:false}});
  let body=await apply({operation:'create_cube',name:'Surface feature test',parameters:{center:[0,1,-.4],sizeMetres:[.1,.1,.02]}});const before=body.blender.metrics.volumeMetres3;
  body=await apply({operation:'transform_body',name:'Move test body',modelId:body.id,expectedVersion:body.version,parameters:{position:[.3,.05,.1],rotationDeg:[0,20,0]}});
  const pose={position:[...body.position],rotationDeg:[...body.rotationDeg]},points=Array.from({length:32},(_,i)=>body.mesh.localToWorld(body.mesh.position.clone().set(Math.cos(i*Math.PI/16)*.01,1+Math.sin(i*Math.PI/16)*.01,-.39)).toArray()),stroke={id:'curved-surface-input',points,surface:{modelId:body.id,geometryVersion:body.geometryVersion||1}},e=await studio.modelAgentEvidence();
  e.strokes=[stroke];e.surfaceFeatureIntent={operation:'add',modelId:body.id,expectedVersion:body.version,depthMetres:.008};
  body=await apply({operation:'create_sketch',name:'Raised capsule',coordinateReference:{modelId:body.id,expectedVersion:body.version},sourceStrokeIds:[stroke.id],parameters:{center:[0,1,-.39],profileType:'rounded_rectangle',widthMetres:.04,heightMetres:.02,cornerRadiusMetres:.01},surfaceDepthMetres:.008},e);
  const capsule={features:structuredClone(body.blender.features),volume:body.blender.metrics.volumeMetres3,pose:{position:body.position,rotationDeg:body.rotationDeg}};
  body=await apply({operation:'body_pattern',name:'Two repeated bodies',modelId:body.id,expectedVersion:body.version,parameters:{patternType:'linear',count:2,direction:[1,0,0],spacingMetres:.2}});const patternSolids=body.blender.metrics.solids;
  body=await apply({operation:'mirror',name:'Reflected bodies',modelId:body.id,expectedVersion:body.version,parameters:{direction:[1,0,0],pivot:[0,0,0]}});
  return {recording:smoothHarness.store.session.id,pipe:{valid:pipe.blender.metrics.valid,solids:pipe.blender.metrics.solids,features:pipe.blender.features.map(f=>f.operation)},tube:{valid:tube.blender.metrics.valid,solids:tube.blender.metrics.solids},before,pose,capsule,patternSolids,finalValid:body.blender.metrics.valid,finalSolids:body.blender.metrics.solids};
 });
 expect(r.pipe).toEqual({valid:true,solids:1,features:['create_pipe']});expect(r.tube).toEqual({valid:true,solids:1});expect(r.capsule.features.at(-3).parameters.profileType).toBe('rounded_rectangle');expect(r.capsule.features.at(-1).operation).toBe('union');expect(r.capsule.pose).toEqual(r.pose);expect(r.capsule.volume).toBeCloseTo(r.before+(.04*.02-(4-Math.PI)*.01**2)*.008,10);expect(r.patternSolids).toBe(2);expect(r.finalSolids).toBe(2);expect(r.finalValid).toBe(true);expect(errors).toEqual([]);fs.writeFileSync('artifacts/native-smooth-browser.json',JSON.stringify({result:r,errors},null,2));
});
