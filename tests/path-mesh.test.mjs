import test from 'node:test';
import assert from 'node:assert/strict';
import {meshPath} from '../src/path-mesh.js';
function verify(mesh) {
 const edges=new Map();
 for(let i=0;i<mesh.indices.length;i+=3) {
  const t=mesh.indices.slice(i,i+3);
  for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],key=[a,b].sort((x,y)=>x-y).join(':');const e=edges.get(key)||{n:0,d:0};e.n++;e.d+=a<b?1:-1;edges.set(key,e);}
 }
 for(const e of edges.values()){assert.equal(e.n,2);assert.equal(e.d,0);}
 assert.ok(mesh.vertices.length/3<=4096);
 assert.ok(mesh.vertices.every(Number.isFinite));
}
function volume(mesh) {
 const origin=mesh.diagnostics.start;
 let sum=0;
 for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3).map(k=>mesh.vertices.slice(k*3,k*3+3).map((v,j)=>v-origin[j]));sum+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}
 return sum;
}
test('straight tube has two caps, original placement, exact length and positive expected volume',()=>{
 const m=meshPath([[2,3,4],[2,3,4.1]],{radiusMetres:.01});verify(m);
 assert.deepEqual(m.diagnostics.start,[2,3,4]);assert.deepEqual(m.diagnostics.end,[2,3,4.1]);
 assert.ok(Math.abs(m.diagnostics.lengthMetres-.1)<1e-12);
 assert.ok(Math.abs(volume(m)-3*.01**2*.1)<1e-12);
 assert.ok(Math.abs(m.diagnostics.meshBounds.min[0]-1.99)<1e-12);
 assert.ok(Math.abs(m.diagnostics.meshBounds.max[1]-3.01)<1e-12);
 assert.equal(m.diagnostics.smoothingMaxMetres,0);
});
test('curved spatial path preserves endpoint positions and reports bounded smoothing drift',()=>{
 const p=[[.1,.2,.3],[.12,.22,.31],[.15,.23,.35],[.16,.25,.4]];
 const m=meshPath(p,{radiusMetres:.002,smoothingIterations:2});verify(m);
 assert.deepEqual(m.diagnostics.start,p[0]);assert.deepEqual(m.diagnostics.end,p.at(-1));
 assert.ok(m.diagnostics.smoothingMaxMetres>0);assert.ok(m.diagnostics.smoothingMaxMetres<.01);
 assert.ok(volume(m)>0);
 for(let i=0;i<3;i++) {assert.ok(m.diagnostics.meshBounds.min[i]>=Math.min(...p.map(v=>v[i]))-.00200001);assert.ok(m.diagnostics.meshBounds.max[i]<=Math.max(...p.map(v=>v[i]))+.00200001);}
});
test('rotated tube ring centres follow supplied 3D path without projection',()=>{
 const p=[[-.2,.7,-.4],[-.1,.8,-.2],[.1,.9,-.1]];
 const m=meshPath(p);verify(m);
 for(let ring=0;ring<p.length;ring++)for(let axis=0;axis<3;axis++){
 const avg=Array.from({length:12},(_,i)=>m.vertices[(ring*12+i)*3+axis]).reduce((s,v)=>s+v,0)/12;
 assert.ok(Math.abs(avg-p[ring][axis])<1e-12);
 }
 assert.ok(volume(m)>0);
});
test('invalid, repeated, closed, reversed or excessively dense paths reject safely',()=>{
 assert.throws(()=>meshPath([[0,0,0],[0,0,0]]),/duplicate/);
 assert.throws(()=>meshPath([[0,0,0],[NaN,0,0]]),/finite/);
 assert.throws(()=>meshPath([[0,0,0],[1,0,0],[0,0,0]]),/open/);
 assert.throws(()=>meshPath([[0,0,0],[1,0,0],[.5,0,0]]),/reverses/);
 assert.throws(()=>meshPath([[0,0,0],[1,0,0]],{radiusMetres:0}),/Radius/);
 assert.throws(()=>meshPath(Array.from({length:200},(_,i)=>[i*.001,0,0]),{smoothingIterations:2}),/4096/);
});
