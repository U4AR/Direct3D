import { test, expect } from "@playwright/test";
test.beforeEach(async({page})=>{await page.route("**/api/agent/ai-run?*",route=>route.fulfill({json:{ready:true,model:"gpt-6-luna",reasoning:"medium",run:{id:"speech-test",state:"completed",step:1,activity:"Finished",events:[],answer:"Test acknowledged"}}}));});

test("uses browser speech with local VAD, without a Gemini audio request", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await page.addInitScript(() => {
    window.SpeechRecognition = class {
      constructor() {
        window.testRecognition = this;
      }
      start() {
        setTimeout(() => this.onstart?.(), 0);
      }
      stop() {
        this.onend?.();
      }
    };
  });
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/transcribe")) requests.push(request);
  });
  await page.goto("http://localhost:5173");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.locator("#mic").click();
  await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#speech-status")).toContainText("browser speech");
  await page.evaluate(() => {
    const result = [
      { transcript: "A vase with two handles", confidence: 0.96 },
    ];
    result.isFinal = true;
    window.testRecognition.onresult({ resultIndex: 0, results: [result] });
  });
  await expect(page.locator("#transcripts")).toContainText(
    "A vase with two handles",
  );
  await page.locator("#mic").click();
  await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "false");
  expect(requests).toHaveLength(0);
});

test("when browser recognition is absent, sends WAV to Gemini and saves audio locally", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
    });
  });
  let audioHeader;
  await page.route("**/api/transcribe", async (route) => {
    audioHeader = Buffer.from(
      route.request().postDataJSON().audio,
      "base64",
    ).toString("ascii", 0, 4);
    await route.fulfill({
      json: { text: "A rounded bowl", model: "models/gemini-3.5-flash-lite" },
    });
  });
  await page.goto("http://localhost:5173");
  const result = await page.evaluate(async () => {
    const { SpeechCapture } = await import("/src/speech.js");
    const assets = [],
      transcripts = [];
    const speech = new SpeechCapture(
      {
        session: {}, flush:async()=>{},
        elapsed: () => performance.now(),
        log() {},
        asset: async (name, blob) => assets.push({ name, size: blob.size }),
      },
      () => {},
      (value) => transcripts.push(value),
      () => {},
    );
    await speech.start();
    speech.enqueue(new Float32Array(16000));
    const deadline = performance.now() + 10000;
    while (speech.busy && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    await speech.stop();
    return { assets, transcripts, engine: speech.engine };
  });
  expect(audioHeader).toBe("RIFF");
  expect(result.engine).toBe("gemini");
  expect(result.transcripts[0].text).toBe("A rounded bowl");
  expect(result.assets.some((a) => a.name.endsWith(".f32"))).toBeTruthy();
  expect(result.assets.some((a) => a.name.endsWith(".wav"))).toBeTruthy();
  expect(
    result.assets.some((a) => a.name.startsWith("audio/") && a.size > 0),
  ).toBeTruthy();
});


test("VAD diagnostics emit live levels and release disconnected microphone resources",async({page,context})=>{
  await context.grantPermissions(["microphone"]);
  await page.addInitScript(()=>{Object.defineProperty(window,"SpeechRecognition",{value:undefined});Object.defineProperty(window,"webkitSpeechRecognition",{value:undefined});});
  await page.goto("http://localhost:5173");
  const result=await page.evaluate(async()=>{
    const {SpeechCapture}=await import("/src/speech.js");
    const diagnostics=[];
    const speech=new SpeechCapture({session:{},flush:async()=>{},elapsed:()=>performance.now(),log(){},asset:async()=>{}},()=>{},()=>{},()=>{},()=>{},d=>diagnostics.push(d));
    await speech.start();
    const audio=speech.audioContext;
    const until=performance.now()+6000;
    while(!diagnostics.some(d=>d.frames) && performance.now()<until) await new Promise(r=>setTimeout(r,50));
    const track=speech.stream.getAudioTracks()[0];track.stop();track.dispatchEvent(new Event("ended"));
    const deadline=performance.now()+5000;
    while(audio.state!=="closed" && performance.now()<deadline) await new Promise(r=>setTimeout(r,50));
    return {diagnostics,active:speech.active,context:audio.state};
  });
  expect(result.diagnostics.some(d=>d.frames && Number.isFinite(d.level) && Number.isFinite(d.probability))).toBeTruthy();
  expect(result.active).toBe(false);expect(result.context).toBe("closed");
  expect(result.diagnostics.at(-1).phase).toBe("error");
});
