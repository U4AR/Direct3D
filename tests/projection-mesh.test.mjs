import test from 'node:test';
import assert from 'node:assert/strict';
import {meshProjection} from '../src/projection-mesh.js';
import {planeFrame} from '../src/sketch-projection.js';
const frame=planeFrame({origin:[2,3,4],normal:[1,2,3]});
const projection=(points)=>({frame,paths:[{strokeId:'outline',start:0,end:points.length-1,points}]});
const square=[[0,0],[.1,0],[.1,.1],[0,.1],[0,0]];
function volume({vertices:v,indices:t}) {
  let sum=0;
  for(let i=0;i<t.length;i+=3) {
    const [a,b,c]=t.slice(i,i+3).map(k=>v.slice(k*3,k*3+3).map((x,j)=>x-frame.origin[j]));
    sum+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  }
  return sum;
}
function assertManifold(mesh) {
  const edges=new Map();
  for(let i=0;i<mesh.indices.length;i+=3) {
    const t=mesh.indices.slice(i,i+3);
    for(let k=0;k<3;k++) {
      const a=t[k],b=t[(k+1)%3],key=[a,b].sort((x,y)=>x-y).join(':');
      const e=edges.get(key)||{count:0,orientation:0};
      e.count++;e.orientation+=a<b?1:-1;edges.set(key,e);
    }
  }
  for(const e of edges.values()) {assert.equal(e.count,2);assert.equal(e.orientation,0);}
}
test('contours produce watertight oriented meshes in the original arbitrary world frame',()=>{
  const [mesh]=meshProjection(projection(square),{thicknessMetres:.02});
  assertManifold(mesh);
  assert.ok(Math.abs(volume(mesh)-.0002)<1e-12);
  for(let i=0;i<mesh.vertices.length;i+=3) {
    const v=mesh.vertices.slice(i,i+3).map((x,j)=>x-frame.origin[j]);
    const d=v.reduce((s,x,j)=>s+x*frame.normal[j],0);
    assert.ok(Math.abs(Math.abs(d)-.01)<1e-12);
  }
  assert.equal(mesh.diagnostics.contourMaxMetres,0);
  assert.equal(mesh.diagnostics.closureAdded,false);
});
test('concave contours retain concavity and reversed winding has positive volume',()=>{
  const p=[[0,0],[.2,0],[.2,.1],[.1,.1],[.1,.2],[0,.2],[0,0]];
  for(const points of [p,[...p].reverse()]) {
    const [mesh]=meshProjection(projection(points),{thicknessMetres:.01});
    assertManifold(mesh);
    assert.ok(Math.abs(volume(mesh)-.0003)<1e-12);
  }
});
test('smoothing reports measurable outline drift; gaps are explicitly bounded',()=>{
  const p=projection([[0,0],[.1,0],[.1,.1],[0,.1],[0,.003]]);
  assert.throws(()=>meshProjection(p,{closureToleranceMetres:.001}),/open/);
  const [mesh]=meshProjection(p,{closureToleranceMetres:.005,smoothingIterations:2});
  assertManifold(mesh);
  assert.equal(mesh.diagnostics.closureAdded,true);
  assert.ok(mesh.diagnostics.contourMaxMetres>0);
  assert.ok(mesh.diagnostics.contourMaxMetres<.03);
  assert.ok(volume(mesh)>0);
});
test('invalid geometry is rejected before mutation and selected regions are independent',()=>{
  assert.throws(()=>meshProjection(projection([[0,0],[1,1],[0,1],[1,0],[0,0]])),/self-intersects/);
  assert.throws(()=>meshProjection(projection([[0,0],[.1,0],[0,0]])),/three/);
  assert.throws(()=>meshProjection(projection(square),{thicknessMetres:0}),/Thickness/);
  assert.throws(()=>meshProjection(projection(square),{smoothingIterations:4}),/Smoothing/);
  const p=projection(square);p.paths.push({strokeId:'open',points:[[0,0],[1,1]]});
  assert.equal(meshProjection(p,{pathIndices:[0]}).length,1);
  assert.throws(()=>meshProjection(p,{pathIndices:[0,0]}),/unique/);
  assert.throws(()=>meshProjection(p),/three/);
});
test('explicit largest-loop repair reports discarded closure loops and geometric error',()=>{
  const p=projection([[0,0],[.1,.1],[0,.1],[.1,0],[0,0]]);
  const [mesh]=meshProjection(p,{selfIntersectionPolicy:'largest-loop'});
  assertManifold(mesh);
  assert.equal(mesh.diagnostics.removedLoopCount,1);
  assert.ok(mesh.diagnostics.discardedAreaSquareMetres>.002);
  assert.ok(mesh.diagnostics.contourMaxMetres>.01);
  assert.ok(volume(mesh)>0);
});
