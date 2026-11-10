import test from 'node:test';import assert from 'node:assert/strict';import {validateBlenderEdits} from '../src/blender-contract.js';import {validateBlenderDocument} from '../scripts/blender-bridge.mjs';
const axes=[[1,0,0],[0,1,0],[0,0,1]],create=(id,operation,parameters)=>({operation,targetId:id,toolIds:[],name:id,parameters}),modify=(id,operation,parameters={},toolIds=[])=>({operation,targetId:id,toolIds,name:operation,parameters});
const doc=(operations,targetId='base')=>({schema:'draw3d.modeling.v1',targetId,meshes:[],operations});
test('native bridge rejects arbitrary operations, nonfinite data and stale targets',()=>{assert.throws(()=>validateBlenderDocument(doc([create('base','python',{code:'print(1)'})])));assert.throws(()=>validateBlenderDocument(doc([create('base','create_cube',{center:[0,NaN,0],sizeMetres:[1,1,1]})])));const edit={engine:'freecad',operation:'fillet',modelId:'part',expectedVersion:1,tools:[],parameters:{widthMetres:.001},keepTools:false,name:'Fillet'};assert.throws(()=>validateBlenderEdits([edit],{modeling:{engines:{freecad:{ready:true}}},models:[{id:'part',version:2}]}),/stale/);});
const live=process.env.DRAW3D_NATIVE_TEST==='1',base=process.env.DRAW3D_TEST_URL||'http://127.0.0.1:8788';
async function run(operations,targetId='base'){const r=await fetch(base+'/api/freecad/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(doc(operations,targetId))}),result=await r.json();assert.ok(r.ok,result.error);assert.equal(result.metrics.valid,true);assert.equal(result.metrics.watertight,true);assert.equal(result.metrics.solids,1);assert.ok(result.metrics.volumeMetres3>0);return result;}
test('real FreeCAD sketch extrusion, revolve, loft, sweep, chamfer and shell',{skip:!live},async()=>{
 const circle=create('base','create_sketch',{center:[0,0,0],radiusMetres:.01,axes});
 const extruded=await run([circle,modify('base','extrude',{distanceMetres:.04,direction:[0,0,1]})]);assert.ok(Math.abs(extruded.metrics.volumeMetres3-Math.PI*.01**2*.04)<1e-10);
 const revolved=await run([create('base','create_sketch',{center:[0,0,0],axes,profilePoints:[[.02,0],[.03,0],[.03,.04],[.02,.04]],closed:true}),modify('base','revolve',{angleDeg:360,direction:[0,1,0],pivot:[0,0,0]})]);assert.ok(Math.abs(revolved.metrics.volumeMetres3-Math.PI*(.03**2-.02**2)*.04)<1e-10);
 await run([circle,create('top','create_sketch',{center:[0,0,.04],radiusMetres:.02,axes}),modify('base','loft',{},['top'])]);
 await run([circle,create('path','create_sketch',{center:[0,0,0],axes:[[1,0,0],[0,0,1],[0,-1,0]],profilePoints:[[0,0],[0,.04]],closed:false}),modify('base','sweep',{},['path'])]);
 const cube=create('base','create_cube',{center:[0,0,0],sizeMetres:[.1,.08,.04]});await run([cube,modify('base','chamfer',{widthMetres:.002})]);await run([cube,modify('base','shell',{thicknessMetres:.002,faceIndices:[6]})]);
});

test('native holes, centred patterns, all-edge finishing and exact topology polylines',{skip:!live},async()=>{
 const cube=create('base','create_cube',{center:[0,1,-.6],sizeMetres:[.12,.08,.02]});
 const hole={center:[0,1,-.6],direction:[0,0,1],radiusMetres:.005,through:true};
 const single=await run([cube,modify('base','hole',hole)]);assert.ok(Math.abs(single.metrics.volumeMetres3-(.12*.08*.02-Math.PI*.005**2*.02))<1e-10);
 for(const pattern of [{patternType:'grid',rows:2,columns:2,spacingUMetres:.04,spacingVMetres:.03},{patternType:'linear',count:4,spacingMetres:.025},{patternType:'circular',count:4,patternRadiusMetres:.025}]){const r=await run([cube,modify('base','hole_pattern',{...hole,...pattern})]);assert.ok(Math.abs(r.metrics.volumeMetres3-(.12*.08*.02-4*Math.PI*.005**2*.02))<1e-10);assert.equal(r.metrics.edges.length,r.metrics.edgeCount);assert.ok(r.metrics.edges.every(e=>e.polyline.length>=2));assert.ok(r.metrics.faces.every(f=>f.edgeIndices.every(i=>i>=1&&i<=r.metrics.edgeCount)));}
 await run([cube,modify('base','fillet',{widthMetres:.001}),modify('base','hole_pattern',{...hole,patternType:'grid',rows:2,columns:2,spacingUMetres:.04,spacingVMetres:.03})]);
 for(const operation of ['fillet','chamfer']){const r=await run([cube,modify('base','hole_pattern',{...hole,patternType:'grid',rows:2,columns:2,spacingUMetres:.04,spacingVMetres:.03}),modify('base',operation,{widthMetres:.001})]);assert.ok(r.metrics.volumeMetres3<single.metrics.volumeMetres3);}
});
