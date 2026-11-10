import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFile, mkdir } from "node:fs/promises";
const child = spawn("node", ["scripts/draw3d-mcp.mjs"], { stdio: ["pipe", "pipe", "pipe"] });
let seq = 0;
const pending = new Map();
createInterface({ input: child.stdout }).on("line", (line) => {
  const m = JSON.parse(line);
  pending.get(m.id)?.(m);
  pending.delete(m.id);
});
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const timeout = setTimeout(() => reject(Error("MCP timed out")), 135000);
    pending.set(id, (m) => {
      clearTimeout(timeout);
      resolve(m);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
let sessionId, browser;
async function tool(name, args = {}) {
  const r = await rpc("tools/call", {
    name,
    arguments: name === "draw3d_sessions" ? {} : { sessionId, ...args },
  });
  if (r.result?.isError) throw Error(name + ": " + r.result.content[0].text);
  const c = r.result.content;
  return c[0].type === "image" ? c : JSON.parse(c[0].text);
}
try {
  browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const pages = browser.contexts().flatMap((c) => c.pages());
  let page;
  for (const p of pages)
    if (
      p.url().startsWith("http://localhost:5173") &&
      (await p.locator("#workspace-sculpt").count())
    )
      page = p;
  if (!page) throw Error("No active Draw3D tab");
  await rpc("initialize", {});
  const s = (await tool("draw3d_sessions")).sessions.filter((s) => s.label.includes("Quest 3"));
  if (s.length !== 1) throw Error("Need one awake Quest session, found " + s.length);
  sessionId = s[0].id;
  const before = await tool("agent_status");
  console.log("Quest MCP session connected");
  await tool("workspace_select", { workspace: "cad" });
  await tool("cad_create_project", { name: "Quest MCP verification", units: "mm" });
  const d = (await tool("cad_document")).document;
  await tool("cad_execute", {
    operation: "addPrimitive",
    payload: {
      name: "Quest MCP block",
      primitiveKind: "box",
      dimensions: { width: 40, height: 30, depth: 20 },
    },
    expectedVersion: d.version,
  });
  console.log("Quest CAD primitive created");
  const models = (await tool("scene_models")).models;
  const box = models.find((m) => m.source === "cad" && m.owner === d.projectId);
  if (!box?.triangleCount) throw Error("Quest CAD geometry missing");
  await tool("model_transfer", { modelId: box.id, target: "sculpt" });
  console.log("Quest CAD mesh transferred to SculptGL");
  const state = await tool("sculpt_document");
  const mesh = await tool("sculpt_create", {
    shape: "sphere",
    name: "Quest MCP sculpt",
    sizeMm: [70, 70, 70],
    positionMm: [80, 0, 0],
    expectedVersion: state.revision,
  });
  const sculpted = await tool("sculpt_brush", {
    id: mesh.id,
    centerMm: [80, 0, 35],
    radiusMm: 25,
    displacementMm: [0, 0, 10],
    expectedVersion: mesh.revision,
  });
  if (!sculpted.affected) throw Error("Quest sculpt affected no vertices");
  console.log("Quest sculpt brush applied");
  await tool("agent_camera", { position: [0.3, 0.2, 0.4], target: [0.04, 0, 0] });
  const capture = await tool("agent_capture", { width: 512, height: 512 });
  const after = await tool("agent_status");
  if (JSON.stringify(before.userCamera) !== JSON.stringify(after.userCamera))
    throw Error("User camera changed");
  if (before.userWorkspace !== after.userWorkspace) throw Error("User workspace changed");
  await mkdir("artifacts/agent", { recursive: true });
  await writeFile("artifacts/agent/quest-capture.png", Buffer.from(capture[0].data, "base64"));
  await writeFile(
    "artifacts/agent/quest-verification.json",
    JSON.stringify(
      {
        time: new Date().toISOString(),
        browser: s[0].label,
        models: await tool("scene_models"),
        sculpted,
        userPOVUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log("Quest capture and independent POV verified");
  // Show the integrated UI without moving any viewport camera.
  await page.locator("#workspace-sculpt").evaluate((el) => el.click());
} finally {
  child.kill();
  await browser?.close();
}
