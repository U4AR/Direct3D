import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {polygonFromPoints} from "../src/fitted-polygon.js";
import {completeLineProfile} from "../src/cad-profile.js";
const fixture=JSON.parse(readFileSync(new URL('./fixtures/pentagon-stroke.json',import.meta.url)));
test('the recorded Quest pentagon fits exactly five equal edges at drawing scale',()=>{
 const f=polygonFromPoints(fixture.stroke.points,{sides:5,thicknessMetres:.01});
 assert.equal(f.polygon.vertices.length,5);assert.equal(f.size[1],.01);assert.ok(f.polygon.rmsMetres<.02);assert.ok(f.size[0]>.15&&f.size[0]<.3);assert.ok(f.size[2]>.15&&f.size[2]<.3);
 const lengths=f.polygon.vertices.map((p,i)=>{const q=f.polygon.vertices[(i+1)%5];return Math.hypot(p[0]-q[0],p[1]-q[1]);});assert.ok(Math.max(...lengths)-Math.min(...lengths)<1e-9);
});
test('missing extrusion profile selects a connected line loop but rejects open or disconnected geometry',()=>{
 const pts=[[0,0],[1,0],[1,1],[0,1]],nodes={sketch:{kind:'sketch',sketchId:'s',objectIds:pts.map((_,i)=>'e'+i)}};
 pts.forEach((p,i)=>{const q=pts[(i+1)%4];nodes['e'+i]={id:'e'+i,data:{objectKind:'line',x1:p[0],y1:p[1],x2:q[0],y2:q[1]}};});
 const payload={sketchId:'s',distance:10},result=completeLineProfile('extrudeSketch',payload,{nodes});assert.equal(result.profile.all,true);assert.equal(result.profile.sourceEntityIds.length,4);assert.equal(payload.profile,undefined);
 const explicit={...payload,profile:{sourceEntityIds:['e1']}};assert.equal(completeLineProfile('extrudeSketch',explicit,{nodes}),explicit);
 nodes.e3.data.x2=.1;assert.throws(()=>completeLineProfile('extrudeSketch',payload,{nodes}),/open or branched/);
});
