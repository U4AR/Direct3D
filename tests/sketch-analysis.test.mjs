import test from "node:test";
import assert from "node:assert/strict";
import { selectedSketchPoints, sketchAnalysis } from "../src/sketch-analysis-tools.js";
const strokes=[{id:"a",points:Array.from({length:30},(_,i)=>[Math.cos(i/29*Math.PI*2)*.1,1,Math.sin(i/29*Math.PI*2)*.1])},{id:"b",hidden:true,points:[[9,9,9],[9,9,8],[9,8,8]]}];
test("regional analysis preserves source indices and hidden strokes require explicit selection",()=>{
 const r=sketchAnalysis(strokes,"sketch_fit_primitive",{strokeIds:["a"],ranges:[{strokeId:"a",start:3,end:21}],kind:"plane"});
 assert.equal(r.coverage,1); assert.equal(r.inlierSamples.length,19); assert.equal(r.inlierSamples[0].pointIndex,3);
 assert.deepEqual(sketchAnalysis(strokes,"sketch_regions",{}).strokeIds,["a"]);
 assert.equal(selectedSketchPoints(strokes,{strokeIds:["b"]}).points.length,3);
 assert.throws(()=>selectedSketchPoints(strokes,{strokeIds:["a"],ranges:[{strokeId:"b",start:0,end:2}]}),/outside/);
 assert.throws(()=>selectedSketchPoints(strokes,{strokeIds:["a"],ranges:[{strokeId:"a",start:0,end:40}]}),/range/);
});
