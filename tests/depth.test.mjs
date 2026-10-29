import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4 } from "three";
import {
  unprojectPixel,
  fuseDepthFrames,
  validateFrame,
  planViews,
  calibrateGeneratedDepth,
} from "../src/depth.js";
const frame = (changes = {}) => ({
  width: 4,
  height: 4,
  depth: Array(16).fill(2),
  mask: Array(16).fill(1),
  units: "metres",
  depthConvention: "camera-z",
  intrinsics: { fx: 4, fy: 4, cx: 2, cy: 2 },
  cameraToWorld: new Matrix4().toArray(),
  near: 0.1,
  far: 5,
  ...changes,
});
test("metric unprojection honors pixel centres, top-left images and camera pose", () => {
  assert.deepEqual(unprojectPixel(frame(), 0, 0, 2), [-0.75, 0.75, -2]);
  assert.deepEqual(
    unprojectPixel(
      frame({
        cameraToWorld: new Matrix4().makeTranslation(1, 2, 3).toArray(),
      }),
      0,
      0,
      2,
    ),
    [0.25, 2.75, 1],
  );
});
test("fusion welds corresponding multi-view samples without duplicating faces", () => {
  const result = fuseDepthFrames([frame(), frame()]);
  assert.equal(result.vertices.length, 16);
  assert.equal(result.triangles.length, 18);
  assert.ok(result.counts.every((n) => n === 2));
});
test("masked pixels and depth discontinuities never bridge foreground and background", () => {
  const f = frame();
  f.mask[5] = 0;
  f.depth[5] = 0;
  const result = fuseDepthFrames([f]);
  assert.equal(result.vertices.length, 15);
  assert.ok(result.triangles.length < 18);
  const jump = frame({
    depth: Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? 1 : 2)),
  });
  const mesh = fuseDepthFrames([jump]);
  for (const face of mesh.triangles) {
    const z = face.map((i) => mesh.vertices[i][2]);
    assert.equal(Math.max(...z) - Math.min(...z), 0);
  }
});
test("reject malformed geometry, dimensions, units and matrices", () => {
  assert.throws(() => validateFrame(frame({ units: "millimetres" })));
  assert.throws(() => validateFrame(frame({ depth: [1] })));
  assert.throws(() =>
    validateFrame(frame({ cameraToWorld: Array(16).fill(0) })),
  );
  assert.throws(() => validateFrame(frame({ depth: Array(16).fill(NaN) })));
});
test("auto view planning distinguishes planar and spatial extent", () => {
  assert.equal(
    planViews([
      {
        radius: 0.002,
        points: [
          [0, 0, 0],
          [1, 1, 0],
        ],
      },
    ]).directions.length,
    1,
  );
  assert.equal(
    planViews([
      {
        radius: 0.002,
        points: [
          [0, 0, 0],
          [1, 1, 1],
        ],
      },
    ]).directions.length,
    6,
  );
  assert.equal(
    planViews(
      [
        {
          radius: 0.002,
          points: [
            [0, 0, 0],
            [1, 1, 1],
          ],
        },
      ],
      "ten",
    ).directions.length,
    10,
  );
  assert.throws(() => planViews([]));
});
test("generated depths fit known scale and reject inverted or flat outputs", () => {
  const gray = Array.from({ length: 64 }, (_, i) => 30 + i * 3);
  const f = frame({
    width: 8,
    height: 8,
    mask: Array(64).fill(1),
    depth: gray.map((x) => 3 - x * 0.005),
  });
  const rgba = Uint8ClampedArray.from(gray.flatMap((x) => [x, x, x, 255]));
  const calibrated = calibrateGeneratedDepth(f, rgba);
  assert.ok(calibrated.calibration.rmseMetres < 1e-6);
  assert.ok(Math.abs(calibrated.depth[10] - f.depth[10]) < 1e-6);
  assert.throws(() =>
    calibrateGeneratedDepth(
      f,
      Uint8ClampedArray.from(gray.flatMap(() => [100, 100, 100, 255])),
    ),
  );
  assert.throws(() =>
    calibrateGeneratedDepth(
      { ...f, depth: gray.map((x) => 1 + x * 0.005) },
      rgba,
    ),
  );
});
