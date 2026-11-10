import test from "node:test";
import assert from "node:assert/strict";
import { fitPlane, angledPlane, planeAngles } from "../src/plane-fitting.js";
test("RANSAC separates outliers and offers horizontal intent without forcing it", () => {
  const points = [];
  for (let x = -10; x <= 10; x++)
    for (let z = -10; z <= 10; z++)
      points.push([x * 0.02, 1 + x * 0.0005 + Math.sin(z + x) * 0.0001, z * 0.02]);
  for (let i = 0; i < 25; i++) points.push([i * 0.01, 1.3 + i * 0.005, i * 0.02]);
  const fitted = fitPlane(points, { thresholdMetres: 0.002 });
  assert.ok(fitted.raw.errors.inlierFraction > 0.9);
  assert.ok(fitted.axisAligned);
  assert.equal(fitted.axisAligned.orientation, "horizontal");
  assert.notDeepEqual(fitted.selected.normal, [0, 1, 0]);
  assert.deepEqual(
    fitPlane(points, { thresholdMetres: 0.002, preferAxis: true }).selected.normal,
    [0, 1, 0],
  );
});
test("plane rotation is editable and underdetermined line fits are refused", () => {
  const frame = angledPlane([1, 2, 3], 95, 0);
  assert.ok(Math.abs(planeAngles(frame).yawDeg - 95) < 1e-9);
  assert.deepEqual(frame.origin, [1, 2, 3]);
  assert.throws(
    () =>
      fitPlane([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ]),
    /plane|line/,
  );
});
