import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';import {fitStroke} from '../src/stroke-fitting.js';
const line=(a,b,n=40)=>Array.from({length:n},(_,i)=>a.map((x,j)=>x+(b[j]-x)*i/(n-1)));
const poly=v=>v.flatMap((p,i)=>i?v.length&&line(v[i-1],p).slice(1):[p]);
const noisy=(p,s=.001)=>p.map((v,i)=>v.map((x,j)=>x+s*Math.sin(i*2.37+j*1.17)));
const transform=(p,scale=1)=>p.map(([x,y,z])=>[2+scale*(.8*x-.6*z),1+scale*y,-1+scale*(.6*x+.8*z)]);
for(const scale of [.1,1,3])for(const [name,points] of [
 ['line',line([-.3,0,0],[.3,.1,.2],100)],
 ['circle',Array.from({length:129},(_,i)=>[.25*Math.cos(i*Math.PI/64),.25*Math.sin(i*Math.PI/64),0])],
 ['rectangle',poly([[-.3,-.15,0],[.3,-.15,0],[.3,.15,0],[-.3,.15,0],[-.3,-.15,0]])]
])test(`${name} noisy rotated translated scale ${scale}`,()=>{const r=fitStroke(noisy(transform(points,scale),.001*scale));assert.equal(r.selected.kind,name);assert.ok(r.selected.errors.rmsMetres<.005*scale);assert.ok(r.selected.accepted);});
test('open arc is a curve, not a full circle',()=>{const p=Array.from({length:100},(_,i)=>[.2*Math.cos(i*Math.PI/99),.2*Math.sin(i*Math.PI/99),0]);const r=fitStroke(p);assert.equal(r.selected.kind,'spline2d');assert.ok(r.selected.errors.rmsMetres<.003);});
test('3D helix keeps height and fits a spatial B-spline',()=>{const p=noisy(Array.from({length:200},(_,i)=>{const t=i/199;return [.1*Math.cos(t*Math.PI*4),.5*t,.1*Math.sin(t*Math.PI*4)];}));const r=fitStroke(p);assert.equal(r.selected.kind,'spline3d');assert.ok(r.selected.errors.rmsMetres<.01);assert.ok(r.selected.path.at(-1)[1]>.49);assert.ok(r.surfaceHypotheses.some(h=>h.kind==='cylinder'));});
test('spatial S curve, endpoint constraints and seventh degree supported',()=>{const p=Array.from({length:160},(_,i)=>{const t=i/159;return [t,.2*Math.sin(t*6),.3*Math.cos(t*5)];});const r=fitStroke(p,{curveDegree:7});assert.equal(r.selected.kind,'spline3d');assert.equal(r.selected.parameters.degree,7);assert.ok(r.selected.errors.rmsMetres<.015);assert.ok(Math.hypot(...r.selected.path[0].map((v,i)=>v-p[0][i]))<1e-7);});
test('missing rectangle side and arbitrary squiggles are not forced into primitives',()=>{const r=fitStroke(poly([[-.3,-.2,0],[.3,-.2,0],[.3,.2,0],[-.3,.2,0]]));assert.equal(r.selected.kind,'spline2d');const q=fitStroke(Array.from({length:128},(_,i)=>[i*.003,.03*Math.sin(i*.3),.04*Math.sin(i*.13)]));assert.equal(q.selected.kind,'spline3d');});
test('regular pentagon has five fitted edges',()=>{const v=Array.from({length:6},(_,i)=>[.2*Math.cos(i*2*Math.PI/5),.2*Math.sin(i*2*Math.PI/5),0]);const r=fitStroke(noisy(poly(v)));assert.equal(r.selected.kind,'polygon');assert.equal(r.selected.parameters.sides,5);});
test('degenerate and malformed inputs fail safely',()=>{assert.equal(fitStroke([[1,1,1],[1,1,1]]).status,'degenerate');assert.throws(()=>fitStroke([[0,0,0],[NaN,1,1]]));});

const roughRectangle=JSON.parse(readFileSync(new URL('./fixtures/rough-rectangle-stroke.json',import.meta.url))).points;
for(const scale of [.1,1,3])test(`rough rectangle remains numerical evidence without an intent override at scale ${scale}`,()=>{const center=roughRectangle[0],points=roughRectangle.map(p=>p.map((v,i)=>(v-center[i])*scale));const result=fitStroke(transform(points));assert.equal(result.selected.kind,'spline2d');assert.equal(result.interpretation,undefined);assert.equal(result.selected.intentPreferred,undefined);assert.notEqual(result.status,'interpreted');assert.ok(result.candidates.some(c=>c.kind==='rectangle'&&!c.accepted));assert.equal(result.rawPointCount,roughRectangle.length);assert.equal(result.algorithmRevision,4);});
test('ellipses, trapezoids and open three-sided outlines retain their own geometry',()=>{
 const ellipse=Array.from({length:129},(_,i)=>[.3*Math.cos(i*Math.PI/64),.15*Math.sin(i*Math.PI/64),0]);assert.notEqual(fitStroke(ellipse).selected.kind,'rectangle');
 const trapezoid=poly([[-.3,-.15,0],[.3,-.15,0],[.14,.15,0],[-.14,.15,0],[-.3,-.15,0]]);assert.notEqual(fitStroke(trapezoid).selected.kind,'rectangle');
 assert.notEqual(fitStroke(poly([[-.3,-.2,0],[.3,-.2,0],[.3,.2,0],[-.3,.2,0]])).selected.kind,'rectangle');
});

for(const scale of [.05,1,4])test(`imperfect circle has no deterministic intent substitution at scale ${scale}`,()=>{const points=Array.from({length:145},(_,i)=>{const a=i*2*Math.PI/144,r=.2*scale*(1+.075*Math.sin(3*a)+.035*Math.cos(7*a));return [r*Math.cos(a),r*Math.sin(a),0];});const f=fitStroke(transform(points));assert.equal(f.selected.kind,'spline2d');assert.equal(f.interpretation,undefined);assert.equal(f.selected.intentPreferred,undefined);assert.ok(f.candidates.some(c=>c.kind==='circle'));assert.equal(points.length,f.rawPointCount);});
test('deliberate ellipse and incomplete circular arc remain curves',()=>{for(const [sx,sy,end] of [[.3,.15,2*Math.PI],[.2,.2,Math.PI*1.7]]){const p=Array.from({length:129},(_,i)=>[sx*Math.cos(i*end/128),sy*Math.sin(i*end/128),0]);assert.notEqual(fitStroke(p).selected.kind,'circle');}});
