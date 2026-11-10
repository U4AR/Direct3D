import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
test("typed instructions, annotated multiview references and sketch-aligned assembly via MCP", async ({
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
    await page.locator("#demo").click();
    await page.getByRole("button", { name: "Type instructions", exact: true }).click();
    await page
      .locator("#agent-instruction-text")
      .fill("Make a vase here, matching the height and location of my drawing.");
    await page
      .locator("#agent-panel .instruction-form")
      .getByRole("button", { name: "Save instruction" })
      .click();
    await expect(page.locator("#agent-panel .instruction-status")).toContainText("Saved");
    await expect(page.locator("#agent-connection")).toContainText("PC connected");
    sessionId = (await call("draw3d_sessions")).sessions
      .filter((s) => s.label.includes("HeadlessChrome"))
      .sort((a, b) => b.lastSeen - a.lastSeen)[0].id;
    const context = await call("draw3d_context");
    expect(
      context.transcripts.some((t) => t.source === "typed" && t.text.includes("Make a vase here")),
    ).toBe(true);
    const before = await call("agent_status"),
      reference = await call("sketch_analyze");
    expect(reference.pointCount).toBeGreaterThan(20);
    expect(Object.keys(reference.extrema)).toHaveLength(6);
    const proposed = await call("placement_plan", {
      expectedRevision: reference.revision,
      size: reference.bounds.size.map((v) => Math.max(0.01, v * 1.15)),
    });
    expect(proposed.comparison.insideFraction).toBe(1);
    const mapped = await call("placement_points", {
      planId: proposed.plan.id,
      points: [
        [0.5, 0.5, 0.5],
        [0, 0, 0],
        [1, 1, 1],
      ],
    });
    expect(mapped.points[0].worldMetres).toEqual(proposed.plan.center);
    expect(mapped.points[0].cadMillimetres[2]).toBeCloseTo(proposed.plan.center[1] * 1000);
    const images = await raw("sketch_views", {
      planId: proposed.plan.id,
      views: ["front", "right", "top", "perspective"],
      width: 640,
      height: 640,
    });
    expect(images.isError).toBeFalsy();
    const frames = images.content.filter((c) => c.type === "image");
    expect(frames).toHaveLength(4);
    const metadata = JSON.parse(images.content[0].text);
    expect(
      metadata.frames.every(
        (f) => f.sketchRevision === reference.revision && f.cameraToWorld.length === 16,
      ),
    ).toBe(true);
    await mkdir("artifacts/agent/sketch-reference", { recursive: true });
    for (let i = 0; i < frames.length; i++)
      await writeFile(
        "artifacts/agent/sketch-reference/" + metadata.frames[i].view + ".png",
        Buffer.from(frames[i].data, "base64"),
      );
    let doc = await call("sculpt_document");
    const left = await call("sculpt_create", {
      shape: "box",
      name: "Sketch-alignment left",
      sizeMm: [20, 30, 20],
      positionMm: [-20, 0, 0],
      expectedVersion: doc.revision,
    });
    const right = await call("sculpt_create", {
      shape: "box",
      name: "Sketch-alignment right",
      sizeMm: [20, 30, 20],
      positionMm: [20, 0, 0],
      expectedVersion: left.revision,
    });
    const parts = (await call("scene_models")).models.filter((m) =>
      [left.id, right.id].includes(m.nativeId),
    );
    expect(parts).toHaveLength(2);
    const ids = parts.map((m) => m.id);
    const result = await call("model_align_to_sketch", {
      planId: proposed.plan.id,
      modelIds: ids,
      expectedVersions: Object.fromEntries(parts.map((m) => [m.id, m.version])),
    });
    expect(result.model.centerErrorMetres).toBeLessThan(0.000001);
    expect(result.models[0].scale).toEqual(result.models[1].scale);
    const comparison = await raw("sketch_views", {
      planId: proposed.plan.id,
      modelIds: ids,
      views: ["front", "perspective"],
      width: 640,
      height: 640,
    });
    expect(comparison.isError).toBeFalsy();
    await writeFile(
      "artifacts/agent/sketch-reference/comparison.png",
      Buffer.from(comparison.content.find((c) => c.type === "image").data, "base64"),
    );
    const after = await call("agent_status");
    expect(after.userCamera).toEqual(before.userCamera);
    expect(after.camera).toEqual(before.camera);
    expect(after.userWorkspace).toBe(before.userWorkspace);
    await page.locator("#agent-close").click();
    await page.locator("#workspace-full-cad").click();
    await page.locator("#cad-context-toggle").click();
    await page.locator("#cad-instruction-text").fill("Keep the opening narrow.");
    await page
      .locator("#cad-context .instruction-form")
      .getByRole("button", { name: "Save instruction" })
      .click();
    expect(
      (await call("draw3d_context")).transcripts.some((t) => t.text === "Keep the opening narrow."),
    ).toBe(true);
    await page.locator("#cad-back").click();
    await page.locator("#undo").click();
    const stale = await call("placement_compare", { planId: proposed.plan.id });
    expect(stale.sketch.stale).toBe(true);
    expect(
      (await raw("placement_points", { planId: proposed.plan.id, points: [[0.5, 0.5, 0.5]] }))
        .isError,
    ).toBe(true);
    await writeFile(
      "artifacts/agent/sketch-reference/verification.json",
      JSON.stringify(
        {
          reference,
          plan: proposed.plan,
          result,
          userCameraUnchanged: true,
          frameCount: frames.length,
          staleGuard: true,
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
