import { test, expect } from "@playwright/test";
test("desktop drawing, capture, reconstruction, local recovery and export", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:5173");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  const canvas = page.locator("#viewport canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
    steps: 30,
  });
  await page.mouse.up();
  await expect(page.locator("#geometry-count")).toContainText("1 strokes");
  await page.locator("#undo").click();
  await expect(page.locator("#geometry-count")).toContainText("0 strokes");
  await page.locator("#redo").click();
  await expect(page.locator("#geometry-count")).toContainText("1 strokes");
  await page.locator("#demo").click();
  await expect(page.locator("#geometry-count")).toContainText("15 strokes");
  await page.locator("#description").fill("A rounded sculptural vase");
  await page.locator("#description-form button").click();
  await expect(page.locator("#transcripts")).toContainText(
    "rounded sculptural vase",
  );
  await page.locator("#capture").click();
  await expect(page.locator("#captures img")).toHaveCount(6);
  await expect(page.locator("#reconstruct")).toBeEnabled();
  await page.locator("#reconstruct").click();
  await expect(page.locator("#review-status")).toContainText(
    "Measured stroke surface",
  );
  await expect(page.locator("#download-mesh")).toBeEnabled();
  await page.locator("#orbit").click();
  await page.screenshot({
    path: "test-results/studio-desktop.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const archive = await download;
  expect(archive.suggestedFilename()).toMatch(/\.zip$/);
  await archive.saveAs("test-results/session.zip");
  await page.reload();
  await expect(page.locator("#geometry-count")).toContainText("15 strokes");
  await expect(page.locator("#captures img")).toHaveCount(6);
  await expect(page.locator("#transcripts")).toContainText(
    "rounded sculptural vase",
  );
  const captured = await page.evaluate(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open("draw3d-studio", 1);
      q.onsuccess = () => r(q.result);
    });
    const assets = await new Promise((r) => {
      const q = db.transaction("assets").objectStore("assets").getAll();
      q.onsuccess = () => r(q.result);
    });
    const asset = assets.find((a) => a.name.startsWith("captures/"));
    return JSON.parse(await asset.blob.text());
  });
  expect(
    captured.frames.every(
      (f) => f.mask.some(Boolean) && f.mask.some((v) => !v),
    ),
  ).toBeTruthy();
  expect(
    captured.frames.every((f) =>
      f.depth.every((d, i) => (f.mask[i] ? d > f.near && d < f.far : d === 0)),
    ),
  ).toBeTruthy();
  await page.locator("#clear").click();
  await expect(page.locator("#geometry-count")).toContainText("0 strokes");
  await expect(page.locator("#reconstruct")).toBeDisabled();
  expect(errors).toEqual([]);
});
test("small viewport has no page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:5173");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/studio-mobile.png",
    fullPage: true,
  });
});
test("GPU depth encoding matches a plane at a known metric camera distance", async ({
  page,
}) => {
  await page.goto("http://localhost:5173");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  const result = await page.evaluate(async () => {
    const T = await import("/node_modules/three/build/three.module.js");
    const { captureSketch } = await import("/src/capture.js");
    const r = new T.WebGLRenderer(),
      group = new T.Group();
    group.add(new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial()));
    const bundle = await captureSketch(
      r,
      group,
      [
        {
          radius: 0.001,
          points: [
            [-0.5, -0.5, 0],
            [0.5, 0.5, 0],
          ],
        },
      ],
      "single",
    );
    const f = bundle.frames[0],
      measured = f.depth[128 * 256 + 128];
    r.dispose();
    return { measured, expected: bundle.plan.distance, masked: f.mask[0] };
  });
  expect(Math.abs(result.measured - result.expected)).toBeLessThan(0.00011);
  expect(result.masked).toBe(0);
});
test("local Silero v5 initializes and processes silent audio frames", async ({
  page,
}) => {
  await page.goto("http://localhost:5173");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  const result = await page.evaluate(async () => {
    const { createMicVAD } = await import("/src/vad.js");
    const ctx = new AudioContext(),
      stream = ctx.createMediaStreamDestination().stream;
    let frames = 0,
      speech = 0;
    const vad = await createMicVAD({
      getStream: async () => stream,
      onFrameProcessed: () => frames++,
      onSpeechEnd: () => speech++,
    });
    await vad.start();
    for (let i = 0; i < 8; i++) await vad.processFrame(new Float32Array(512));
    await vad.destroy();
    await ctx.close();
    return { frames, speech };
  });
  expect(result.frames).toBeGreaterThanOrEqual(8);
  expect(result.speech).toBe(0);
});
