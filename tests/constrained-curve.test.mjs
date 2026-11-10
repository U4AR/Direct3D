import test from "node:test";
import assert from "node:assert/strict";
import {fitCurve,evaluateCurve} from "../scripts/constrained-curve.mjs";
const pts=Array.from({length:151},(_,i)=>{const t=i/150;return [2*t-1,1-(2*t-1)**2+.025*Math.sin(i*1.7),.006*Math.sin(i)]});
test("degree five curve enforces reflection and planarity continuously despite noisy input",()=>{
 const r=fitCurve(pts,{degree:5,controlCount:12,fairnessWeight:.00001,constraints:{symmetryPlane:{origin:[0,0,0],normal:[1,0,0]},plane:{origin:[0,0,0],normal:[0,0,1]},anchors:[{t:0,point:[-1,0,0]},{t:1,point:[1,0,0]}]}});
 assert.equal(r.curve.degree,5);assert.equal(r.curve.order,6);assert.ok(r.diagnostics.rmsMetres<.07);
 for(const t of [.013,.124,.338,.499,.722,.943]){const a=evaluateCurve(r.curve,t),b=evaluateCurve(r.curve,1-t);assert.ok(Math.abs(a[0]+b[0])<1e-9);assert.ok(Math.abs(a[1]-b[1])<1e-9);assert.ok(Math.abs(a[2])<1e-12);}
 assert.ok(Math.abs(evaluateCurve(r.curve,0)[0]+1)<1e-7);
});
test("conflicting symmetry and anchors fail explicitly",()=>assert.throws(()=>fitCurve(pts,{constraints:{symmetryPlane:{origin:[0,0,0],normal:[1,0,0]},anchors:[{t:0,point:[-1,0,0]},{t:1,point:[2,0,0]}]}}),/Incompatible/));
test("safe custom basis fits a function and rejects executable expressions",()=>{
 const points=Array.from({length:101},(_,i)=>{const t=i/100;return [Math.cos(Math.PI*t),Math.sin(Math.PI*t),0]});
 const r=fitCurve(points,{kind:"functions",terms:["1","cos(pi*t)","sin(pi*t)"],fairnessWeight:0});
 assert.ok(r.diagnostics.rmsMetres<1e-7);
 assert.throws(()=>fitCurve(points,{kind:"functions",terms:["1","globalThis.process.exit()"]}),/Unknown|Invalid/);
});
test("closed positional and tangent constraints produce a loop",()=>{
 const p=Array.from({length:101},(_,i)=>[Math.cos(2*Math.PI*i/100),Math.sin(2*Math.PI*i/100),0]);
 const r=fitCurve(p,{controlCount:16,fairnessWeight:0,constraints:{closed:true,closedTangent:true}});
 assert.ok(Math.hypot(...evaluateCurve(r.curve,0).map((x,i)=>x-evaluateCurve(r.curve,1)[i]))<1e-8);
 assert.ok(r.diagnostics.constraintMaxResidual<1e-7);
});
