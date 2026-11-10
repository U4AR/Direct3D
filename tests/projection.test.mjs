import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { planeFrame, projectStrokes, traceProjection } from "../src/sketch-projection.js";
const s = [
  {
    id: "a",
    radius: 0.001,
    points: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
];
const c = new T.PerspectiveCamera(45, 1, 0.01, 100);
c.position.set(0, 0, 3);
c.lookAt(0, 0, 0);
c.updateMatrixWorld(true);
const view = {
  cameraToWorld: c.matrixWorld.toArray(),
  projectionMatrix: c.projectionMatrix.toArray(),
};
const plane = { origin: [0, 0, 1], normal: [0, 0, 1] };
test("perspective projection preserves camera rays, orthographic preserves dimensions", () => {
  const p = projectStrokes(s, { view, plane });
  assert.ok(Math.abs(p.paths[0].points[1][0] - 2 / 3) < 1e-9);
  assert.equal(p.depthDeviation.rmsMetres, 1);
  const o = projectStrokes(s, { plane, mode: "orthographic" });
  assert.deepEqual(o.paths[0].points[1], [1, 0]);
  assert.throws(
    () => projectStrokes(s, { view, plane: { ...plane, origin: [0, 0, 3] } }),
    /Viewpoint/,
  );
});
test("arbitrary frames map correctly to native CAD and closed editable profiles", () => {
  const p = projectStrokes(s, { plane, mode: "orthographic" }),
    r = traceProjection(p, { closed: true });
  assert.equal(r.entityCount, 4);
  assert.deepEqual(r.payload.planeRef.frame.origin, { x: 0, y: -1000, z: 0 });
  assert.equal(r.payload.objects[0].x2, 1000);
  const frame = planeFrame({ origin: [1, 2, 3], normal: [0, 1, 0] });
  assert.ok(Math.abs(new T.Vector3(...frame.xAxis).dot(new T.Vector3(...frame.normal))) < 1e-9);
});
test("ranges split 3D intent, smooth traces and regular shapes are explicit", () => {
  const p = projectStrokes(s, {
    plane,
    mode: "orthographic",
    ranges: [{ strokeId: "a", start: 0, end: 2 }],
  });
  assert.equal(p.paths[0].points.length, 3);
  assert.throws(
    () =>
      projectStrokes(s, {
        plane,
        mode: "orthographic",
        ranges: [{ strokeId: "a", start: 0, end: 50 }],
      }),
    /ranges/,
  );
  const smooth = traceProjection(p, { kind: "smooth" });
  assert.equal(smooth.entityCount, 1);
  assert.equal(smooth.payload.objects[0].objectKind, "spline");
  assert.match(smooth.nativeCurveType, /exact/);
  const rect = traceProjection(p, { kind: "rectangle" });
  assert.equal(rect.payload.objects[0].width, 1000);
  assert.equal(rect.closed, true);
});


test("one noisy stroke cleans to a measured editable spline without changing other strokes or source points",()=>{
 const points=Array.from({length:81},(_,i)=>[i*.001, .01*Math.sin(i/80*Math.PI)+.0008*(i%2?1:-1),0]);
 const strokes=[{id:"curve",points},{id:"other",points:[[9,9,9],[10,10,10]]}],original=structuredClone(strokes);
 const p=projectStrokes(strokes,{strokeIds:["curve"],plane:{origin:[0,0,0],normal:[0,0,1]},mode:"orthographic"});
 const clean=traceProjection(p,{kind:"spline",smoothingIterations:2,toleranceMetres:.0003});
 assert.deepEqual(p.strokeIds,["curve"]);assert.deepEqual(strokes,original);
 assert.equal(clean.entityCount,1);assert.ok(clean.traces[0].spanCount<15);
 assert.ok(clean.traces[0].fit.maxMetres<.002);assert.ok(clean.traces[0].fit.reverseMaxMetres<.002);
 assert.deepEqual(clean.previewPaths[0][0],points[0].slice(0,2));
 assert.deepEqual(clean.previewPaths[0].at(-1),points.at(-1).slice(0,2));
 assert.throws(()=>traceProjection(p,{smoothingIterations:99}),/Invalid/);
});

test("closed circle regularization preserves the spatial plane and reports closure/fit error",()=>{
 const pts=Array.from({length:97},(_,i)=>{const a=i*Math.PI/48,r=.05+.0002*Math.sin(7*a);return [1+r*Math.cos(a),2+r*Math.sin(a),3]});
 const p=projectStrokes([{id:"ring",points:pts}],{plane:{origin:[1,2,3],normal:[0,0,1]},mode:"orthographic"});
 const trace=traceProjection(p,{kind:"circle"});
 assert.equal(trace.closed,true);assert.ok(trace.traces[0].fit.maxMetres<.0005);
 assert.ok(trace.traces[0].fit.closureGapMetres<1e-9);
 assert.deepEqual(trace.payload.planeRef.frame.origin,{x:1000,y:-3000,z:2000});
});
