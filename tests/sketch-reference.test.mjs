import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {
  sketchReference,
  makePlan,
  comparePlan,
  worldPoint,
  nativePoint,
  alignmentMatrix,
} from "../src/sketch-reference.js";
const strokes = [
  {
    id: "a",
    radius: 0.003,
    points: [
      [1, 2, -3],
      [2, 4, -1],
    ],
  },
  {
    id: "b",
    radius: 0.002,
    points: [
      [1.5, 3, -2],
      [1, 4, -1],
    ],
  },
];
test("metric bounds retain sample identities and extrema, reject missing selection", () => {
  const r = sketchReference(strokes);
  assert.deepEqual(r.bounds, {
    min: [1, 2, -3],
    max: [2, 4, -1],
    center: [1.5, 3, -2],
    size: [1, 2, 2],
  });
  assert.equal(r.extrema.maxX.strokeId, "a");
  assert.equal(r.extrema.maxX.pointIndex, 1);
  assert.equal(r.endpoints.length, 2);
  assert.throws(() => sketchReference(strokes, ["gone"]));
  assert.throws(() => sketchReference([]));
});
test("build frame maps normalized points into correct native CAD and sculpt coordinates", () => {
  const r = sketchReference(strokes),
    p = makePlan(r);
  assert.deepEqual(worldPoint(p, [0.5, 0.5, 0.5]), [1.5, 3, -2]);
  assert.deepEqual(nativePoint(worldPoint(p, [0, 0, 0])), {
    worldMetres: [1, 2, -3],
    cadMillimetres: [1000, 3000, 2000],
    sculptMillimetres: [1000, 2000, -3000],
  });
  assert.equal(comparePlan(r, p).insideFraction, 1);
  const moved = structuredClone(strokes);
  moved[0].points[0][0] = 9;
  assert.equal(comparePlan(sketchReference(moved), p).stale, true);
  assert.throws(() => makePlan(sketchReference(moved), { expectedRevision: r.revision }));
});
test("rotated frame and group fit preserve relative geometry and use uniform scale", () => {
  const r = sketchReference(strokes),
    p = makePlan(r, { center: [5, 3, 2], size: [2, 4, 2], rotationDeg: [0, 90, 0] });
  const origin = worldPoint(p, [0, 0, 0]);
  assert.ok(Math.abs(origin[0] - 4) < 1e-8);
  assert.ok(Math.abs(origin[2] - 3) < 1e-8);
  const box = new T.Box3(new T.Vector3(-1, -2, -1), new T.Vector3(1, 2, 1));
  const m = alignmentMatrix(box, p);
  assert.deepEqual(new T.Vector3().applyMatrix4(m).toArray(), p.center);
  const v1 = new T.Vector3(0, 0, 0).applyMatrix4(m),
    v2 = new T.Vector3(1, 0, 0).applyMatrix4(m);
  assert.ok(Math.abs(v1.distanceTo(v2) - 1) < 1e-8);
});
test("flat sketches explicitly report ambiguity, no NaN frame", () => {
  const r = sketchReference([
    {
      id: "flat",
      points: [
        [0, 1, 2],
        [2, 1, 2],
      ],
    },
  ]);
  assert.deepEqual(r.degenerateAxes, ["Y", "Z"]);
  const p = makePlan(r);
  assert.deepEqual(p.size, [2, 0.01, 0.01]);
  assert.ok(p.normalizedToWorld.every(Number.isFinite));
  assert.throws(() => makePlan(r, { size: [0, 1, 1] }));
});
