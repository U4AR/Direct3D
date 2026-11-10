import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
test("live OpenAI creates and inspects CAD and sculpt models", async ({ page }) => {
  test.skip(
    process.env.DRAW3D_LIVE_AI !== "1",
    "Explicit opt-in: calls the configured paid OpenAI API",
  );
  test.setTimeout(900000);
  await page.goto("http://localhost:5173/");
  await page.getByRole("button", { name: "Models + agent", exact: true }).first().click();
  await expect(page.locator("#ai-model")).toContainText("gpt-6-luna");
  await page
    .locator("#agent-instruction-text")
    .fill(
      "Create a new CAD project called AI connection test. Create one 40 by 30 by 20 mm box in CAD. Also create one 30 mm sphere in SculptGL at world position [0.08,0,0] metres. Read tool help where needed. Set your independent camera to [0.18,0.14,0.22] looking at [0.04,0,0], capture an image and inspect the two objects before finishing. Keep the user viewpoint unchanged.",
    );
  await page.locator("#ai-run").click();
  await expect(page.locator("#ai-status")).toContainText(/finished|failed|stopped/, {
    timeout: 850000,
  });
  const status = await page.locator("#ai-status").innerText(),
    answer = await page.locator("#ai-answer").innerText(),
    events = await page.locator("#ai-events").textContent();
  await mkdir("artifacts/agent/live-ai", { recursive: true });
  await writeFile(
    "artifacts/agent/live-ai/result.json",
    JSON.stringify({ status, answer, events }, null, 2),
  );
  await page.screenshot({ path: "artifacts/agent/live-ai/result.png" });
  expect(status).toContain("finished");
  expect(events).toContain("cad_execute");
  expect(events).toContain("sculpt_create");
  expect(events).toContain("agent_capture");
  const options = await page.locator("#agent-models option").count();
  expect(options).toBeGreaterThanOrEqual(2);
});
