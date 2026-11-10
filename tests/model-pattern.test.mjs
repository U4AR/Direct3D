import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {transformPatternMesh,mirrorMatrix,surfacePlacementMatrix,buildPatternMesh,initModelPatternTools} from '../src/model-pattern-tools.js';
const triangle={vertices:[1,0,0,1,1,0,1,0,1],indices:[0,1,2]};
function near(a,b) { assert.equal(a.length,b.length);a.forEach((x,i)=>assert.ok(Math.abs(x-b[i])<1e-8,`${a} differs from ${b}`)); }
function normal(mesh) {const [a,b,c]=mesh.indices.map(i=>new T.Vector3().fromArray(mesh.vertices,i*3));return b.sub(a).cross(c.sub(a)).normalize().toArray();}
test('mirror across an offset plane reflects positions and fixes triangle winding',()=>{
  const source=structuredClone(triangle),out=transformPatternMesh(source,mirrorMatrix([2,0,0],[2,0,0]));
  near(out.vertices,[3,0,0,3,1,0,3,0,1]);assert.deepEqual(out.indices,[0,2,1]);near(normal(out),[-1,0,0]);assert.deepEqual(source,triangle);
  const restored=transformPatternMesh(out,mirrorMatrix([2,0,0],[1,0,0]));near(restored.vertices,triangle.vertices);assert.deepEqual(restored.indices,triangle.indices);
});
test('world transform includes translation and negative scale with outward winding',()=>{
  const matrix=new T.Matrix4().compose(new T.Vector3(4,2,0),new T.Quaternion(),new T.Vector3(-2,3,1));
  const out=transformPatternMesh(triangle,matrix);near(out.vertices,[2,2,0,2,5,0,2,2,1]);near(normal(out),[-1,0,0]);
});
test('linear patterns copy entire assembly with indexed offsets and preserve source',async()=>{
  const out=await buildPatternMesh(triangle,{mode:'linear',count:2,stepMetres:[0.2,0,0]});
  near(out.vertices,[1.2,0,0,1.2,1,0,1.2,0,1,1.4,0,0,1.4,1,0,1.4,0,1]);assert.deepEqual(out.indices,[0,1,2,3,4,5]);assert.equal(out.count,2);assert.equal(triangle.vertices[0],1);
});
test('circular copies rotate geometry around the stated axis and pivot',async()=>{
  const out=await buildPatternMesh(triangle,{mode:'circular',count:3,pivot:[0,0,0],axisDirection:[0,1,0]});
  near(out.vertices.slice(0,3),[0,0,-1]);near(out.vertices.slice(9,12),[-1,0,0]);near(out.vertices.slice(18,21),[0,0,1]);assert.deepEqual(out.placements.map(p=>p.angleDeg),[90,180,270]);
  const offset=await buildPatternMesh(triangle,{mode:'circular',count:1,pivot:[1,0,0],angleStepDeg:180});near(offset.vertices.slice(0,3),[1,0,0]);
});
test('surface placement aligns normal and tangent while attaching source pivot',()=>{
  const matrix=surfacePlacementMatrix({pivot:[1,0,0],point:[2,3,4],normal:[0,0,1],tangentU:[1,0,0],normalOffsetMetres:0.02});
  near(new T.Vector3(1,0,0).applyMatrix4(matrix).toArray(),[2,3,4.02]);near(new T.Vector3(0,1,0).transformDirection(matrix).toArray(),[0,0,1]);near(new T.Vector3(1,0,0).transformDirection(matrix).toArray(),[1,0,0]);
  assert.ok(matrix.determinant()>0);
});
test('surface UV grids evaluate all placements and reject changed surface versions',async()=>{
  const calls=[];const evaluate=async(id,u,v)=>{calls.push([id,u,v]);return {point:[u,2,v],normal:[0,1,0],tangentU:[1,0,0],version:4};};
  const out=await buildPatternMesh(triangle,{mode:'surface',surfaceId:'patch',expectedSurfaceVersion:4,pivot:[1,0,0],grid:{uCount:2,vCount:2,uRange:[0.2,0.8],vRange:[0.3,0.7]}},evaluate);
  assert.equal(out.count,4);near(out.vertices.slice(0,3),[0.2,2,0.3]);assert.equal(calls.length,4);assert.deepEqual(out.placements.at(-1).uv,[0.8,0.7]);
  await assert.rejects(()=>buildPatternMesh(triangle,{mode:'surface',surfaceId:'patch',expectedSurfaceVersion:3,pivot:[1,0,0],uvs:[[0.5,0.5]]},evaluate),/version conflict/);
});
test('reject invalid geometry, oversized patterns, collapsed axes and invalid UVs',async()=>{
  assert.throws(()=>mirrorMatrix([0,0,0],[0,0,0]),/nonzero/);
  assert.throws(()=>transformPatternMesh({vertices:[NaN,0,0],indices:[0,1,2]},new T.Matrix4()),/valid finite/);
  assert.throws(()=>surfacePlacementMatrix({pivot:[0,0,0],point:[0,0,0],normal:[0,1,0],tangentU:[0,1,0]}),/parallel/);
  await assert.rejects(()=>buildPatternMesh(triangle,{mode:'linear',count:33,stepMetres:[1,0,0]}),/count/);
  await assert.rejects(()=>buildPatternMesh(triangle,{mode:'surface',surfaceId:'p',pivot:[0,0,0],uvs:[[1.2,0]]},()=>{}),/normalized/);
});
test('integrated tool guards versions, imports one combined mesh, and preserves sources',async()=>{
  const mesh=new T.Mesh(new T.BufferGeometry(),new T.MeshBasicMaterial());mesh.position.set(0,2,0);mesh.updateMatrixWorld();
  const original={id:'a',nativeId:'a',source:'cad',version:7,mesh,...structuredClone(triangle)},models=new Map([['a',original]]),imports=[];let revision=3,persisted=0;
  const api={status:()=>({revision}),importMesh:args=>{assert.equal(args.expectedVersion,revision);imports.push(args);revision++;models.set('sculpt::copy',{id:'sculpt::copy',nativeId:'copy',source:'sculpt',version:1});return {id:'copy'};}};
  const tools=initModelPatternTools({models,ensure:async()=>api,refresh:async()=>{},store:{log:()=>{}},persist:async()=>persisted++,apply:()=>{}});
  await assert.rejects(()=>tools.mirror({modelIds:['a'],expectedVersions:{a:6},planeOrigin:[0,0,0],planeNormal:[1,0,0]}),/version conflict/);assert.equal(imports.length,0);
  const result=await tools.pattern({modelIds:['a'],expectedVersions:{a:7},mode:'linear',count:3,stepMetres:[0.1,0,0]});
  assert.equal(imports.length,1);near(imports[0].vertices.slice(0,3),[1.1,2,0]);assert.equal(imports[0].vertices.length,27);assert.equal(original.version,7);assert.equal(result.modelId,'sculpt::copy');assert.equal(result.copyCount,3);assert.equal(result.preservedOriginals,true);assert.equal(persisted,1);
});
