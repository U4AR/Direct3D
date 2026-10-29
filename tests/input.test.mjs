import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4 } from "three";
import { Studio } from "../src/studio.js";
function harness() {
  const calls = [];
  const studio = Object.create(Studio.prototype);
  Object.assign(studio, {
    inputs: new Map(),
    lastPose: 0,
    penOffset: [0, -0.11, 0.025],
    renderer: { xr: { getReferenceSpace: () => ({}) } },
    store: { log: () => {} },
    begin: (...a) => calls.push(["begin", ...a]),
    sample: (...a) => calls.push(["sample", ...a]),
    end: (key) => calls.push(["end", key]),
  });
  return { studio, calls };
}
const transform = (x, y, z) => ({
  position: { x, y, z },
  matrix: new Matrix4().makeTranslation(x, y, z).toArray(),
});
test("controller trigger uses the bottom-of-grip pose and stops on tracking loss", () => {
  const { studio, calls } = harness();
  const source = {
    handedness: "right",
    gripSpace: "grip",
    targetRaySpace: "ray",
    gamepad: { buttons: [{ pressed: true }], axes: [] },
  };
  const frame = {
    session: { inputSources: [source] },
    getPose: (space) =>
      space === "grip" ? { transform: transform(1, 2, 3) } : null,
    getViewerPose: () => null,
  };
  studio.updateXR(100, frame);
  assert.deepEqual(calls[0], ["begin", "right-controller", [1, 1.89, 3.025]]);
  frame.session.inputSources = [];
  studio.updateXR(200, frame);
  assert.deepEqual(calls.at(-1), ["end", "right-controller"]);
});
test("pinch hysteresis keeps a stroke active between 22 mm and 32 mm", () => {
  const { studio, calls } = harness();
  let gap = 0.02;
  const hand = new Map([
    ["thumb-tip", "thumb"],
    ["index-finger-tip", "index"],
  ]);
  const frame = {
    session: {
      inputSources: [{ handedness: "left", hand, targetRaySpace: "ray" }],
    },
    getPose: () => null,
    getViewerPose: () => null,
    getJointPose: (joint) => ({
      transform: transform(joint === "thumb" ? 0 : gap, 1, 0),
      radius: 0.005,
    }),
  };
  studio.updateXR(100, frame);
  gap = 0.027;
  studio.updateXR(200, frame);
  gap = 0.04;
  studio.updateXR(300, frame);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["begin", "sample", "end"],
  );
  assert.deepEqual(calls[0][2], [0.01, 1, 0]);
});
