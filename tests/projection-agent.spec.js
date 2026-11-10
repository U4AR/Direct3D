import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
test("POV projection, native CAD extrusion, surface drawing and scoped completion", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const child = spawn("node", ["scripts/draw3d-mcp.mjs"], { stdio: ["pipe", "pipe", "pipe"] });
  let sequence = 0;
  const waiting = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const m = JSON.parse(line);
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(() => reject(Error("MCP timeout")), 130000);
      waiting.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  let sessionId;
  async function raw(name, args = {}) {
    const m = await rpc("tools/call", {
      name,
      arguments: name === "draw3d_sessions" ? {} : { sessionId, ...args },
    });
    if (m.error) throw Error(m.error.message);
    return m.result;
  }
  async function call(name, args = {}) {
    const r = await raw(name, args);
    if (r.isError) throw Error(r.content[0].text);
    return JSON.parse(r.content.find((c) => c.type === "text").text);
  }
  try {
    await rpc("initialize", {});
    await page.goto("http://localhost:5173/");
    await expect(page.locator("#save-status")).toHaveText("Saved on this device");
    const canvas = page.locator("#viewport canvas"),
      box = await canvas.boundingBox();
    async function draw(points) {
      await page.mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height);
      await page.mouse.down();
      for (const p of points.slice(1))
        await page.mouse.move(box.x + p[0] * box.width, box.y + p[1] * box.height, { steps: 20 });
      await page.mouse.up();
    }
    await draw([
      [0.4, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
      [0.4, 0.6],
      [0.4, 0.4],
    ]);
    await page.locator("#description").fill("Extrude this outlined plate");
    await page.locator("#description-form button").click();
    await page.getByRole("button", { name: "Models + agent", exact: true }).first().click();
    await expect(page.locator("#agent-connection")).toContainText("PC connected");
    sessionId = (await call("draw3d_sessions")).sessions
      .filter((s) => s.label.includes("HeadlessChrome"))
      .sort((a, b) => b.lastSeen - a.lastSeen)[0].id;
    await page.locator("#agent-close").click();
    const context = await call("draw3d_context"),
      stroke = context.strokes[0],
      prompt = context.transcripts[0];
    expect(stroke.view.cameraToWorld).toHaveLength(16);
    expect(prompt.strokeIds).toContain(stroke.id);
    const fitted = await call("sketch_fit_plane", { strokeIds: [stroke.id], preferAxis: true });
    expect(fitted.fit.axisAligned.orientation).toBe("vertical");
    const planeProjection = await call("sketch_project", {
      strokeIds: [stroke.id],
      planeId: fitted.id,
      mode: "orthographic",
    });
    expect(planeProjection.planeVersion).toBe(1);
    await page.getByRole("button", { name: "Models + agent", exact: true }).first().click();
    const yaw = page.getByLabel("Plane Yaw degrees", { exact: true });
    await yaw.fill("94.8");
    expect(await yaw.inputValue()).toBe("94.8");
    await page.getByRole("button", { name: "Use 95", exact: true }).click();
    expect(await yaw.inputValue()).toBe("95");
    await page.locator("#apply-reference-plane").click();
    await expect.poll(async () => (await call("sketch_planes"))[0].version).toBe(2);
    expect((await raw("sketch_trace", { projectionId: planeProjection.id })).isError).toBe(true);
    await page.locator("#hide-reference-plane").click();
    await page.locator("#agent-close").click();
    const before = await call("agent_status"),
      pov = await raw("sketch_user_view", { strokeId: stroke.id });
    expect(pov.isError).toBeFalsy();
    expect(pov.content.some((c) => c.type === "image")).toBe(true);
    const projected = await raw("sketch_project", { strokeIds: [stroke.id], source: "recorded" });
    expect(projected.isError).toBeFalsy();
    const projection = JSON.parse(projected.content.find((c) => c.type === "text").text);
    expect(projection.paths[0].points.length).toBeGreaterThan(20);
    const preview = await call("sketch_trace", {
      projectionId: projection.id,
      kind: "polyline",
      closed: true,
    });
    expect(preview.entityCount).toBe(4);
    expect(preview.traces[0].fit.maxMetres).toBeLessThan(.002);
    const splineCandidate=await call("sketch_trace",{projectionId:projection.id,kind:"spline",closed:true,smoothingIterations:1});
    // The square's corners should remain straight: a free spline overshoots them.
    expect(splineCandidate.traces[0].fit.maxMetres).toBeGreaterThan(preview.traces[0].fit.maxMetres);
    const cleanPreview=await raw("sketch_trace",{projectionId:projection.id,kind:"rectangle",closed:true});
    expect(cleanPreview.content.some(c=>c.type==="image")).toBe(true);
    await mkdir("artifacts/agent/projection", { recursive: true });
    await writeFile(
      "artifacts/agent/projection/pov.png",
      Buffer.from(pov.content.find((c) => c.type === "image").data, "base64"),
    );
    await writeFile(
      "artifacts/agent/projection/plane.png",
      Buffer.from(projected.content.find((c) => c.type === "image").data, "base64"),
    );
    await writeFile("artifacts/agent/projection/clean-profile.png",Buffer.from(cleanPreview.content.find(c=>c.type==="image").data,"base64"));
    const doc = await call("cad_create_project", {
      name: "Projected sketch acceptance",
      units: "mm",
    });
    const created = await call("cad_trace_projection", {
      projectionId: projection.id,
      kind: "rectangle",
      closed: true,
      expectedVersion: doc.version,
    });
    expect(created.diagnostics).toEqual([]);
    expect(created.sourceEntityIds).toHaveLength(1);
    expect(created.trace.payload.objects[0].objectKind).toBe("rectangle");
    const extruded = await call("cad_execute", created.extrudeExample);
    expect(extruded.diagnostics).toEqual([]);
    const model = extruded.models.find((m) => m.nativeId === extruded.command.payload.ids.bodyId);
    expect(model).toBeTruthy();
    const after = await call("agent_status");
    expect(after.userCamera).toEqual(before.userCamera);
    expect(after.camera).toEqual(before.camera);
    // Select the front surface at the centre of the visible extruded plate, then draw on it.
    await page.locator("#surface-select").click();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.locator("#surface-status")).toContainText("Drawing on");
    await draw([
      [0.46, 0.48],
      [0.54, 0.52],
    ]);
    const surfaceContext = await call("draw3d_context"),
      surfaceStroke = surfaceContext.strokes.at(-1);
    expect(surfaceStroke.surface.modelId).toBe(model.id);
    const frame = surfaceStroke.surface.frame;
    for (const point of surfaceStroke.points) {
      const offset = point.map((n, i) => n - frame.origin[i]);
      expect(Math.abs(offset.reduce((s, n, i) => s + n * frame.normal[i], 0))).toBeLessThan(0.0001);
    }
    await page.locator("#surface-clear").click();
    await expect(page.locator("#surface-status")).toHaveText("Free-space drawing");
    const completion = await call("request_complete", {
      promptIds: [prompt.id],
      strokeIds: [stroke.id],
      expectedRevision: projection.sketchRevision,
      resultModelIds: [model.id],
      expectedModelVersions: { [model.id]: model.version },
      summary: "Traced and extruded the plate",
    });
    expect(completion.strokeIds).toEqual([stroke.id]);
    const clean = await call("draw3d_context");
    expect(clean.strokes.some((s) => s.id === stroke.id)).toBe(false);
    expect(clean.strokes.some((s) => s.id === surfaceStroke.id)).toBe(true);
    expect(clean.archivedStrokes.some((s) => s.id === stroke.id)).toBe(true);
    await page.reload();
    await expect(page.locator("#geometry-count")).toContainText("1 strokes");
    await page.getByRole("button", { name: "Models + agent", exact: true }).first().click();
    await page.locator("#restore-drawings").click();
    await expect(page.locator("#geometry-count")).toContainText("2 strokes");
    await writeFile(
      "artifacts/agent/projection/verification.json",
      JSON.stringify(
        {
          projectionId: projection.id,
          entities: preview.entityCount,
          modelId: model.id,
          surfaceSamples: surfaceStroke.points.length,
          camerasUnchanged: true,
          scopedCompletion: true,
          restoredAfterReload: true,
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
  } finally {
    child.kill();
  }
});
