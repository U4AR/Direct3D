import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
test("MCP operates both editors, transfers geometry and leaves user POV alone", async ({
  page,
}) => {
  test.setTimeout(240000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const process = spawn("node", ["scripts/draw3d-mcp.mjs"], { stdio: ["pipe", "pipe", "pipe"] });
  let seq = 0;
  const pending = new Map();
  createInterface({ input: process.stdout }).on("line", (line) => {
    const m = JSON.parse(line);
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => reject(Error("MCP timeout " + method)), 135000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  let sessionId;
  async function tool(name, args = {}) {
    const m = await rpc("tools/call", {
      name,
      arguments: name === "draw3d_sessions" ? {} : { sessionId, ...args },
    });
    if (m.result?.isError) throw Error(name + ": " + m.result.content[0].text);
    if (m.error) throw Error(m.error.message);
    const c = m.result.content;
    if (c[0]?.type === "image") return c;
    return JSON.parse(c[0].text);
  }
  try {
    expect((await rpc("initialize", {})).result.capabilities.tools).toBeTruthy();
    expect((await rpc("tools/list", {})).result.tools.length).toBeGreaterThan(15);
    await page.goto("http://localhost:5173/");
    await expect(page.locator("#workspace-sculpt")).toBeVisible();
    await page.getByRole("button", { name: "Models + agent", exact: true }).first().click();
    await expect(page.locator("#agent-connection")).toContainText("PC connected", {
      timeout: 15000,
    });
    const sessions = await tool("draw3d_sessions");
    sessionId =
      sessions.sessions.find((s) => s.label.includes("HeadlessChrome"))?.id ||
      sessions.sessions.at(-1).id;
    await tool("workspace_select", { workspace: "cad" });
    expect((await tool("agent_status")).userWorkspace).toBe("sketch");
    await tool("cad_create_project", { name: "MCP verification", units: "mm" });
    let d = (await tool("cad_document")).document;
    await tool("cad_execute", {
      operation: "addPrimitive",
      payload: {
        name: "Agent box",
        primitiveKind: "box",
        dimensions: { width: 40, height: 30, depth: 20 },
      },
      expectedVersion: d.version,
    });
    // A committed feature can still fail geometry building. Surface the native
    // warnings immediately so the agent can repair its profile before continuing.
    d = (await tool("cad_document")).document;
    const openSketch = await tool("cad_execute", {
      operation: "addSketch",
      payload: {name: "Open profile test", planeRef: {type: "canonical", plane: "XY", offset: 0},
        objects: [{objectKind: "line", x1: 0, y1: 0, x2: 10, y2: 0}]},
      expectedVersion: d.version,
    });
    const failedExtrusion = await tool("cad_execute", {
      operation: "extrudeSketch",
      payload: {name: "Incomplete extrusion", sketchId: openSketch.command.payload.ids.sketchId,
        distance: 5, operation: "new-body"},
      expectedVersion: openSketch.version,
    });
    expect(failedExtrusion.warnings.length).toBeGreaterThan(0);
    expect(failedExtrusion.diagnostics.some(d => failedExtrusion.warnings.includes(d.message))).toBe(true);
    let undoResult = await tool("cad_undo", {expectedVersion: failedExtrusion.version});
    await tool("cad_undo", {expectedVersion: undoResult.version});
    let models = (await tool("scene_models", { includeGeometry: true })).models;
    expect(models.some((m) => m.source === "cad" && m.triangleCount > 0)).toBeTruthy();
    const box = models.find((m) => m.source === "cad");
    const extent = (v) =>
      [0, 1, 2].map((a) => {
        const coords = v.filter((_, i) => i % 3 === a);
        return Math.max(...coords) - Math.min(...coords);
      });
    for (const [i, size] of [0.04, 0.02, 0.03].entries())
      expect(extent(box.vertices)[i]).toBeCloseTo(size, 5);
    const transferred = await tool("model_transfer", { modelId: box.id, target: "sculpt" });
    const copied = (await tool("scene_models", { includeGeometry: true })).models.find(
      (m) => m.source === "sculpt" && m.nativeId === transferred.id,
    );
    for (const [i, size] of [0.04, 0.02, 0.03].entries())
      expect(extent(copied.vertices)[i]).toBeCloseTo(size, 5);
    let sculpt = await tool("sculpt_document");
    expect(sculpt.meshes.length).toBeGreaterThan(0);
    const sphere = await tool("sculpt_create", {
      shape: "sphere",
      name: "Agent organic form",
      sizeMm: [80, 80, 80],
      positionMm: [100, 0, 0],
      expectedVersion: sculpt.revision,
    });
    const brush = await tool("sculpt_brush", {
      id: sphere.id,
      centerMm: [100, 0, 40],
      radiusMm: 30,
      displacementMm: [0, 0, 15],
      expectedVersion: sphere.revision,
    });
    expect(brush.affected).toBeGreaterThan(0);
    await tool("sculpt_undo", { expectedVersion: brush.revision });
    sculpt = await tool("sculpt_document");
    await tool("sculpt_redo", { expectedVersion: sculpt.revision });
    models = (await tool("scene_models")).models;
    const organic = models.find((m) => m.source === "sculpt" && m.nativeId === sphere.id);
    await tool("model_transform", {
      modelId: organic.id,
      position: [0.1, 0.05, 0],
      rotationDeg: [0, 30, 0],
      scale: [1, 1.2, 1],
      expectedVersion: organic.version,
    });
    await tool("model_transfer", { modelId: organic.id, target: "cad" });
    await page.locator("#agent-pause").click();
    const denied = await rpc("tools/call", {
      name: "sculpt_create",
      arguments: {
        sessionId,
        shape: "box",
        expectedVersion: (await tool("sculpt_document")).revision,
      },
    });
    expect(denied.result.isError).toBe(true);
    await page.locator("#agent-pause").click();
    const before = await tool("agent_status");
    await tool("agent_camera", { position: [0.3, 0.2, 0.4], target: [0.05, 0, 0] });
    const capture = await tool("agent_capture", { width: 512, height: 512 });
    expect(capture[0].type).toBe("image");
    expect(Buffer.from(capture[0].data, "base64").length).toBeGreaterThan(1000);
    const after = await tool("agent_status");
    expect(after.userWorkspace).toBe(before.userWorkspace);
    expect(after.userCamera).toEqual(before.userCamera);
    await mkdir("artifacts/agent", { recursive: true });
    await writeFile("artifacts/agent/capture.png", Buffer.from(capture[0].data, "base64"));
    await writeFile(
      "artifacts/agent/verification.json",
      JSON.stringify(
        {
          tools: (await rpc("tools/list", {})).result.tools.map((t) => t.name),
          models: await tool("scene_models"),
          errors,
        },
        null,
        2,
      ),
    );
    await page.locator("#agent-close").click();
    await page.locator("#workspace-sculpt").click();
    await expect(page.locator('iframe[title="Non-parametric sculpting workspace"]')).toBeVisible();
    await page.screenshot({ path: "artifacts/agent/sculpt-workspace.png" });
    const priorModels = await tool("scene_models");
    await page.reload();
    await expect(page.locator("#workspace-sculpt")).toBeVisible();
    await page.locator("#workspace-sculpt").click();
    await expect(page.locator('#agent-connection')).toContainText('PC connected');
    const newSessions = await tool('draw3d_sessions');
    sessionId = newSessions.sessions.filter(s=>s.label.includes('HeadlessChrome'))
      .sort((a,b)=>b.lastSeen-a.lastSeen)[0].id;
    const immediateRestore = await tool('sculpt_document');
    expect(immediateRestore.meshes.some(m=>m.id===sphere.id)).toBeTruthy();
    const f = page.frameLocator('iframe[title="Non-parametric sculpting workspace"]');
    const restored = await f.locator("body").evaluate(() => window.__draw3dSculpt.status());
    expect(restored.meshes.some((m) => m.id === sphere.id)).toBeTruthy();
    await page.getByRole("button", { name: "Models + agent", exact: true }).last().click();
    await page.locator("#agent-models").selectOption(organic.id);
    await expect(page.locator('[data-vector="position"][data-axis="0"]' )).toHaveValue("0.1");
    await expect(page.locator('[data-vector="scale"][data-axis="1"]' )).toHaveValue("1.2");
    await page.locator('#agent-close').click();
    const sf=page.frames().find(f=>f.url().includes('/sculpt/index.html'));
    await sf.evaluate(()=>window.__switchMarker='preserved');
    await page.locator('.cad-topbar').getByRole('button',{name:'CAD',exact:true}).click();
    await page.locator('.cad-topbar').getByRole('button',{name:'Sculpt',exact:true}).click();
    expect(await sf.evaluate(()=>window.__switchMarker)).toBe('preserved');
    expect(errors).toEqual([]);
  } finally {
    process.kill();
  }
});
