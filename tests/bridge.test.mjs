import test from "node:test";
import assert from "node:assert/strict";
import { buildInput, startBridge } from "../scripts/model-bridge.mjs";
test("Gemini payload preserves target calibration and sends other views as context", () => {
  const image = "data:image/png;base64,YWJj";
  const input = buildInput({
    description: "A vase",
    frame: {
      id: "view-1",
      near: 1,
      far: 3,
      sketchImage: image,
      depthImage: image,
      intrinsics: { fx: 100 },
      cameraToWorld: [1],
    },
    context: [{ id: "view-2", sketchImage: image, cameraToWorld: [2] }],
  });
  assert.equal(input.filter((x) => x.type === "image").length, 3);
  assert.match(input[0].text, /CAMERA-Z/);
  assert.match(input[0].text, /A vase/);
  assert.throws(() => buildInput({ description: "", frame: {}, context: [] }));
});
test("bridge clearly reports an absent key without making an upstream request", async () => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const server = await startBridge(0);
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/depth`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /GEMINI_API_KEY/);
  } finally {
    await new Promise((r) => server.close(r));
    if (old) process.env.GEMINI_API_KEY = old;
  }
});
