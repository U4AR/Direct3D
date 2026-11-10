import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
test("native cubic spline editing, exact extrusion and STEP curves", async ({ page }) => {
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
    await page.getByRole("button", { name: "Models + agent", exact: true }).first().click();
    await expect(page.locator("#agent-connection")).toContainText("PC connected");
    sessionId = (await call("draw3d_sessions")).sessions
      .filter((s) => s.label.includes("HeadlessChrome"))
      .sort((a, b) => b.lastSeen - a.lastSeen)[0].id;
    await page.locator("#agent-close").click();
    await call("cad_create_project", { name: "Native spline acceptance", units: "mm" });
    await page.locator("#workspace-full-cad").click();
    await page.locator("#cad-new-spline").click();
    const f = page.frameLocator('iframe[title="Full parametric CAD workspace"]');
    await expect(f.getByRole("region", { name: "Native spline editor" })).toBeVisible({
      timeout: 30000,
    });
    const control = f.getByLabel("Span 1 Handle 1 X", { exact: true });
    await control.fill("30");
    await f.getByRole("button", { name: "Apply spline", exact: true }).click();
    await expect
      .poll(
        async () => {
          const d = (await call("cad_document")).document;
          return Object.values(d.nodes).find(
            (n) => n.kind === "sketch-object" && n.data?.objectKind === "spline",
          )?.data.segments[0].points[2];
        },
        { timeout: 30000 },
      )
      .toBe(30);
    const doc = (await call("cad_document")).document,
      object = Object.values(doc.nodes).find(
        (n) => n.kind === "sketch-object" && n.data?.objectKind === "spline",
      ),
      sketch = Object.values(doc.nodes).find(
        (n) => n.kind === "sketch" && n.objectIds.includes(object.id),
      );
    const solid = await call("cad_execute", {
      operation: "extrudeSketch",
      payload: {
        name: "Exact spline extrusion",
        bodyName: "Exact spline extrusion",
        sketchId: sketch.sketchId,
        distance: 10,
        operation: "new-body",
        profile: { all: true, sourceEntityIds: [object.id] },
      },
      expectedVersion: doc.version,
    });
    expect(solid.diagnostics).toEqual([]);
    expect(solid.models.length).toBeGreaterThan(0);
    const menu = f.locator("details.file-menu");
    await menu.locator("summary").click();
    const download = page.waitForEvent("download");
    await menu.getByRole("button", { name: /Export STEP/ }).click();
    const file = await download,
      chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    const step = Buffer.concat(chunks).toString("utf8");
    expect(step).toContain("B_SPLINE_CURVE");
    await mkdir("artifacts/agent/native-spline", { recursive: true });
    await file.saveAs("artifacts/agent/native-spline/exact-spline.step");
    await page.reload();await page.locator('#workspace-full-cad').click();await expect(page.locator('#cad-spline-list option')).toHaveCount(1,{timeout:30000});await page.locator('#cad-edit-spline').click();await expect(f.getByLabel('Span 1 Handle 1 X',{exact:true})).toHaveValue('30');await f.getByRole('region',{name:'Native spline editor'}).evaluate(el=>el.scrollTop=0);
    await page.screenshot({ path: "artifacts/agent/native-spline/editor.png" });
    expect(errors).toEqual([]);
  } finally {
    child.kill();
  }
});
