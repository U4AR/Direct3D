import "./style.css";
import { Studio } from "./studio.js";
import { SessionStore, download } from "./storage.js";
import { captureSketch, decodeGeneratedImage } from "./capture.js";
import {
  fuseDepthFrames,
  calibrateGeneratedDepth,
  meshToOBJ,
} from "./depth.js";
import { SpeechCapture } from "./speech.js";

document.querySelector("#app").innerHTML = `
 <header><a class="brand" href="${import.meta.env.BASE_URL}" aria-label="Draw3D home"><span class="brand-mark">◈</span> DRAW<span>3D</span></a><span class="project-name">Untitled spatial sketch <span class="tag">WORK IN PROGRESS</span></span><div class="header-actions"><span id="save-status">Opening local session…</span><button id="export">Export session</button><button id="vr" class="primary">Enter VR <span>◉</span></button></div></header>
 <main><aside class="left-panel"><div class="section-label">01 / CREATE</div><h1>Shape your idea.</h1><p class="muted intro">Draw in space. Say what it is.<br>Build a surface from your sketch.</p>
 <div class="tool-tabs" role="group" aria-label="Desktop tool"><button id="draw" class="selected">✎ Draw</button><button id="orbit">⤧ Orbit</button></div>
 <section><div class="label-row"><h2>Stroke</h2><span id="brush-value">8 mm</span></div><input id="brush" aria-label="Stroke diameter" type="range" min="2" max="24" value="8"/><div class="swatches" role="group" aria-label="Stroke color">${["#bcf477", "#8cbcff", "#ffbd78", "#ed96be", "#f0f4f8"].map((c, i) => `<button class="swatch ${i ? "" : "active"}" data-color="${c}" style="--swatch:${c}" aria-label="${["Lime", "Blue", "Orange", "Pink", "White"][i]} stroke"></button>`).join("")}</div><div class="two-buttons"><button id="undo">↶ Undo</button><button id="redo">↷ Redo</button></div></section>
 <section><div class="label-row"><h2>Drawing plane</h2><span id="plane-value">−0.60 m</span></div><input id="plane" type="range" min="-130" max="20" value="-60" aria-label="Desktop drawing plane depth"/><p class="hint">Desktop only. In VR, your hand or controller moves freely in 3D.</p></section>
 <section><h2>Quest 3 input</h2><div class="input-guide"><span>◌</span><div><b>Hands</b><small>Pinch index + thumb to draw</small></div></div><div class="input-guide"><span>⌁</span><div><b>Controllers</b><small>Hold trigger · bottom is the pen</small></div></div><label class="offset-label">Pen offset below grip <select id="pen-offset"><option value="0.09">9 cm</option><option value="0.11" selected>11 cm</option><option value="0.13">13 cm</option><option value="0.15">15 cm</option></select></label></section>
 <div class="left-bottom"><button id="demo">Load sample sketch</button><button id="clear" class="text-button">Clear drawing</button><span class="hint">Your sketches stay on this device.</span></div></aside>
 <div class="workspace"><div id="viewport" aria-label="Interactive 3D drawing canvas"></div><div class="viewport-top"><span class="canvas-title"><i></i> SPATIAL CANVAS</span><span class="view-badge" id="view-mode">PERSPECTIVE · DRAW</span></div><div id="empty-state"><div class="empty-symbol">✳</div><h2>A little space for a big idea.</h2><p>Drag to sketch, or enter VR to draw around you.</p></div><div class="canvas-bottom"><span id="geometry-count">0 strokes · 0 points</span><span>1 unit = 1 metre <span class="axis">X <b>Y</b> Z</span></span></div><div id="notice" role="status" aria-live="polite"></div>
 <div class="speech-panel"><div class="speech-top"><div><span class="section-label">LIVE DESCRIPTION</span><span id="speech-status">Microphone off</span></div><button id="mic" aria-pressed="false">♩ Enable microphone</button></div><div id="transcripts" aria-live="polite"><p class="transcript-placeholder">“I'm drawing a rounded vase with a narrow opening…”</p></div><form id="description-form"><input id="description" aria-label="Add a typed description" placeholder="Or type a description of your object…" autocomplete="off"/><button type="submit" aria-label="Add description">Add</button></form><div class="speech-footer"><span id="vad-indicator">○ VAD idle</span><span>Local VAD · browser speech / Gemini fallback</span></div></div></div>
 <aside class="right-panel"><div class="section-label">02 / RECONSTRUCT</div><h2 class="panel-title">From lines to form</h2><div class="pipeline"><div class="step active"><span>1</span><div><b>Capture depth</b><small>Calibrated sketch views</small></div></div><div class="step" id="generation-step"><span>2</span><div><b>Infer the surface</b><small>Gemini Nano Banana 2.1</small></div></div><div class="step" id="review-step"><span>3</span><div><b>Review in 3D</b><small>Fuse views into one surface</small></div></div></div>
 <section><label for="views">Capture coverage</label><select id="views"><option value="auto">Auto · adapt to shape</option><option value="single">Single view</option><option value="six">6 views · all sides</option><option value="ten">10 views · extra coverage</option></select><p class="hint">Auto uses one view for a flat sketch, six for volume. Use extra views for complex shapes.</p><button id="capture" class="primary full">Capture sketch depth</button></section>
 <div id="captures" class="capture-grid"><div class="capture-placeholder">Depth views will appear here</div></div><p id="capture-status" class="hint">Empty pixels are masked. Drawn pixels retain their depth in metres.</p>
 <section><button id="generate" class="full" disabled>Generate object depth</button><p class="hint" id="model-status">Sends captured views + description to Gemini. API key configured on local server.</p><button id="reconstruct" class="full" disabled>Reconstruct captured strokes</button><button id="download-depth" class="text-button full" disabled>Download depth bundle</button></section>
 <div class="review-summary"><span class="section-label">SURFACE REVIEW</span><p id="review-status">No reconstruction yet.</p><button id="download-mesh" disabled class="text-button">Export review mesh (.obj)</button></div><div class="scope-note"><span>PAUSED BEFORE FINALIZATION</span><p>Refine your sketch and inspect the surface. Color and final 3D generation come later.</p></div></aside></main>
 <footer><span><i class="record-dot"></i> LOCAL SESSION RECORDING <span id="session-time">00:00</span></span><span>Strokes · poses · actions · enabled mic audio</span><span id="session-id"></span></footer>`;

const $ = (s) => document.querySelector(s);
let studio,
  store,
  speech,
  capture,
  generated,
  review,
  busy = false,
  noticeTimer;
function notice(message, error = false) {
  $("#notice").textContent = message;
  $("#notice").className = error ? "show error" : "show";
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => ($("#notice").className = ""),
    error ? 14000 : 6500,
  );
  if (studio) studio.updateHUD(undefined, message);
}
function currentFrames() {
  return generated?.frames?.length ? generated.frames : capture?.frames;
}
function changed() {
  const strokes = store.session.strokes,
    points = strokes.reduce((n, s) => n + s.points.length, 0);
  $("#geometry-count").textContent =
    `${strokes.length} strokes · ${points.toLocaleString()} points`;
  $("#empty-state").hidden = points > 0;
  const stale = capture && capture.revision !== store.session.revision;
  $("#capture").disabled = busy || !points;
  $("#generate").disabled = busy || !capture || stale;
  $("#reconstruct").disabled = busy || !capture || stale;
  $("#download-depth").disabled = !capture;
  $("#download-mesh").disabled = !review;
  $("#undo").disabled = busy || !strokes.length;
  $("#redo").disabled = busy || !studio.redoStack.length;
  if (stale)
    $("#capture-status").textContent =
      "Sketch changed. Capture again before generating or rebuilding.";
}
async function run(action) {
  if (busy) return;
  busy = true;
  studio.endAll();
  changed();
  try {
    await action();
  } catch (e) {
    console.error(e);
    store.log("app.error", { message: e.message });
    notice(e.message, true);
  } finally {
    busy = false;
    changed();
  }
}
async function makeCapture() {
  notice("Capturing calibrated depth views…");
  capture = await captureSketch(
    studio.renderer,
    studio.drawing,
    store.session.strokes,
    $("#views").value,
    store.session.revision,
  );
  generated = null;
  review = null;
  studio.setReview(null);
  await store.asset(
    `captures/${capture.id}.json`,
    new Blob([JSON.stringify(capture)], { type: "application/json" }),
    { kind: "measured-depth" },
  );
  store.session.latestCapture = capture.id;
  delete store.session.latestGenerated;
  store.log("depth.capture", {
    id: capture.id,
    count: capture.frames.length,
    plan: capture.plan,
    revision: capture.revision,
  });
  renderCaptures(capture.frames);
  $("#capture-status").textContent =
    `${capture.frames.length} views · 256 × 256 · measured metres. ${capture.plan.reason}.`;
  $("#reconstruct").textContent = "Reconstruct captured strokes";
  $("#review-status").textContent =
    "Depth captured. Generate object depth, or inspect the original strokes.";
  await store.flush();
  notice(`${capture.frames.length} depth views saved locally.`);
}
function renderCaptures(frames) {
  $("#captures").replaceChildren();
  for (const frame of frames) {
    const card = document.createElement("figure"),
      img = document.createElement("img"),
      caption = document.createElement("figcaption");
    img.src = frame.depthImage;
    img.alt = `Depth capture ${frame.id}`;
    caption.textContent = frame.id.replace("view-", "VIEW ");
    card.append(img, caption);
    $("#captures").append(card);
  }
}
async function generate() {
  if (!capture || capture.revision !== store.session.revision)
    throw new Error("The sketch changed. Capture fresh depth views first.");
  const description = store.session.transcripts.map((t) => t.text).join("\n");
  if (!description.trim())
    throw new Error(
      "Describe your object by speaking or typing before generating its surface.",
    );
  const frozen = capture;
  notice("Generating object depths. Each view may take a minute…");
  $("#model-status").textContent =
    "Generating with Gemini… keep this tab open.";
  store.log("generation.request", {
    captureId: frozen.id,
    model: "models/gemini-nano-banana-2.1",
    description,
  });
  // One request per target view; all the other sketch images provide shape context.
  const frames = [],
    failures = [],
    jobId = crypto.randomUUID();
  for (let i = 0; i < frozen.frames.length; i++) {
    const source = frozen.frames[i];
    $("#model-status").textContent =
      `Gemini · generating view ${i + 1} of ${frozen.frames.length}…`;
    studio.updateHUD(undefined, $("#model-status").textContent);
    const response = await fetch("/api/depth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        frame: source,
        context: frozen.frames.map((f) => ({
          id: f.id,
          sketchImage: f.sketchImage,
          cameraToWorld: f.cameraToWorld,
        })),
      }),
      signal: AbortSignal.timeout(240000),
    });
    if (!response.ok) {
      let message;
      try {
        message = (await response.json()).error;
      } catch {
        message = "Start the local model bridge with npm run bridge.";
      }
      throw new Error(message || `Model request failed (${response.status}).`);
    }
    const result = await response.json();
    await store.asset(
      `generated/${jobId}-${source.id}-raw.json`,
      new Blob([JSON.stringify(result)], { type: "application/json" }),
      { captureId: frozen.id, view: source.id },
    );
    store.log("generation.response", {
      jobId,
      view: source.id,
      interactionId: result.interactionId,
    });
    try {
      const rgba = await decodeGeneratedImage(
          result.image,
          source.width,
          source.height,
        ),
        frame = calibrateGeneratedDepth(source, rgba);
      frame.depthImage = result.image;
      frames.push(frame);
    } catch (e) {
      failures.push({ view: source.id, error: e.message });
    }
  }
  generated = {
    ...frozen,
    id: jobId,
    sourceCaptureId: frozen.id,
    frames,
    failures,
    provenance: "generated-estimate",
  };
  await store.asset(
    `generated/${jobId}.json`,
    new Blob([JSON.stringify(generated)], { type: "application/json" }),
    { kind: "generated-depth" },
  );
  store.session.latestGenerated = jobId;
  await store.flush();
  if (!frames.length)
    throw new Error(
      "Generated images were saved, but none passed depth calibration. Refine the sketch or inspect the raw images in the session export.",
    );
  renderCaptures(frames);
  $("#reconstruct").textContent = "Reconstruct generated surface";
  $("#generation-step").classList.add("active");
  $("#model-status").textContent =
    `${frames.length} calibrated estimates · ${failures.length} rejected. Scale fitted to sketch anchors.`;
  notice("Generated depth is ready for surface review.");
}
async function reconstruct() {
  if (!capture || capture.revision !== store.session.revision)
    throw new Error("The sketch changed. Capture fresh depth views first.");
  const frames = currentFrames();
  if (!frames?.length) throw new Error("Capture depth first.");
  notice("Fusing calibrated views…");
  await new Promise((r) => setTimeout(r, 30));
  review = fuseDepthFrames(frames);
  if (!review.vertices.length)
    throw new Error("No valid depth samples to reconstruct.");
  studio.setReview(review);
  $("#review-step").classList.add("active");
  $("#review-status").textContent =
    `${review.vertices.length.toLocaleString()} vertices · ${review.triangles.length.toLocaleString()} faces · ${frames.length} views. ${generated?.frames.length ? "Estimated object surface" : "Measured stroke surface"}. Placed beside your sketch.`;
  store.log("depth.reconstruct", {
    vertices: review.vertices.length,
    faces: review.triangles.length,
    source: generated?.id || capture.id,
  });
  await store.asset(
    `meshes/${crypto.randomUUID()}.obj`,
    new Blob([meshToOBJ(review)]),
    { kind: "review-mesh", units: "metres" },
  );
  notice(
    "Review surface placed beside your sketch. Switch to Orbit to inspect.",
  );
}
function addTranscript(item) {
  store.session.transcripts.push(item);
  store.log("transcript", item);
  renderTranscripts();
  store.flush().catch(() => {});
}
function renderTranscripts() {
  const entries = store.session.transcripts;
  if (!entries.length) return;
  $("#transcripts").replaceChildren();
  for (const item of entries) {
    const p = document.createElement("p");
    p.textContent = item.text;
    $("#transcripts").append(p);
  }
  $("#transcripts").scrollTop = $("#transcripts").scrollHeight;
  studio.updateHUD(
    entries
      .slice(-2)
      .map((t) => t.text)
      .join(" "),
  );
}
async function toggleMic() {
  const button = $("#mic");
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (speech.active) await speech.stop();
    else await speech.start();
  } catch (e) {
    notice(e.message, true);
  } finally {
    button.disabled = false;
    button.textContent = speech.active
      ? "◼ Stop microphone"
      : "♩ Enable microphone";
    button.setAttribute("aria-pressed", String(speech.active));
  }
}
async function init() {
  store = new SessionStore((text, error) => {
    $("#save-status").textContent = text;
    $("#save-status").classList.toggle("error-text", error);
  });
  await store.open();
  studio = new Studio(
    $("#viewport"),
    store,
    () => {
      if (studio) changed();
    },
    (action) => {
      if (action === "mic") toggleMic();
      else if (action === "undo" && !busy) studio.undo();
      else if (action === "capture") run(makeCapture);
      else if (action === "reconstruct") run(reconstruct);
      else if (action === "xr-start") $("#vr").textContent = "In VR";
      else if (action === "xr-end") $("#vr").textContent = "Enter VR ◉";
    },
  );
  speech = new SpeechCapture(
    store,
    (text) => {
      $("#speech-status").textContent = text;
      studio.updateHUD(undefined, text);
    },
    addTranscript,
    (active) => {
      $("#vad-indicator").textContent = active
        ? "● Speech detected"
        : "○ VAD listening";
      $("#vad-indicator").classList.toggle("speaking", active);
    },
    (text) => {
      let line = $("#interim-transcript");
      if (!line) { line = document.createElement('p'); line.id = 'interim-transcript'; line.className = 'transcript-placeholder'; $("#transcripts").append(line); }
      line.textContent = text;
      store.log('transcript.interim', { text });
      studio.updateHUD(text || store.session.transcripts.slice(-2).map(t => t.text).join(' '));
    },
  );
  $("#session-id").textContent =
    `SESSION ${store.session.id.slice(0, 8).toUpperCase()}`;
  setInterval(() => {
    const t = Math.floor(store.elapsed() / 1000);
    $("#session-time").textContent =
      `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }, 1000);
  for (const mode of ["draw", "orbit"])
    $("#" + mode).onclick = () => {
      studio.setMode(mode);
      $("#draw").classList.toggle("selected", mode === "draw");
      $("#orbit").classList.toggle("selected", mode === "orbit");
      $("#view-mode").textContent = `PERSPECTIVE · ${mode.toUpperCase()}`;
    };
  $("#brush").oninput = (e) => {
    studio.radius = Number(e.target.value) / 2000;
    $("#brush-value").textContent = `${e.target.value} mm`;
    store.log("brush.radius", { radius: studio.radius });
  };
  document.querySelectorAll(".swatch").forEach(
    (b) =>
      (b.onclick = () => {
        studio.color = b.dataset.color;
        studio.cursor.material.color.set(studio.color);
        document
          .querySelectorAll(".swatch")
          .forEach((s) => s.classList.toggle("active", s === b));
        store.log("brush.color", { color: studio.color });
      }),
  );
  $("#plane").oninput = (e) => {
    studio.planeZ = Number(e.target.value) / 100;
    $("#plane-value").textContent = `${studio.planeZ.toFixed(2)} m`;
    store.log("drawing.plane", { z: studio.planeZ });
  };
  $("#pen-offset").onchange = (e) => {
    studio.penOffset[1] = -Number(e.target.value);
    for (let i = 0; i < 2; i++)
      studio.renderer.xr
        .getControllerGrip(i)
        .userData.nib.position.fromArray(studio.penOffset);
    store.log("controller.pen-offset", { offset: studio.penOffset });
  };
  $("#views").onchange = (e) =>
    store.log("capture.coverage", { mode: e.target.value });
  $("#undo").onclick = () => studio.undo();
  $("#redo").onclick = () => studio.redo();
  $("#clear").onclick = () => {
    if (!busy) {
      capture = generated = review = null;
      delete store.session.latestCapture;
      delete store.session.latestGenerated;
      studio.clear();
      $("#captures").replaceChildren();
      $("#capture-status").textContent = "Draw something to capture new depth views.";
      $("#review-status").textContent = "No reconstruction yet. Previous assets remain in the session archive.";
      changed();
    }
  };
  $("#demo").onclick = () => {
    if (!busy) studio.demo();
  };
  $("#vr").onclick = async () => {
    try {
      await studio.enterVR();
    } catch (e) {
      notice(e.message, true);
    }
  };
  $("#capture").onclick = () => run(makeCapture);
  $("#generate").onclick = () => run(generate);
  $("#reconstruct").onclick = () => run(reconstruct);
  $("#mic").onclick = toggleMic;
  $("#description-form").onsubmit = (e) => {
    e.preventDefault();
    const text = $("#description").value.trim();
    if (text) {
      addTranscript({
        id: crypto.randomUUID(),
        text,
        start: store.elapsed(),
        end: store.elapsed(),
        source: "typed",
      });
      $("#description").value = "";
    }
  };
  $("#export").onclick = () =>
    run(async () => {
      if (speech.recorder?.state === "recording") {
        speech.recorder.requestData();
        await new Promise((r) => setTimeout(r, 200));
        await Promise.allSettled(speech.assetWrites);
      }
      download(
        await store.export(),
        `draw3d-${store.session.id.slice(0, 8)}.zip`,
      );
      notice("Session exported with events, geometry, audio and depth assets.");
    });
  $("#download-depth").onclick = () =>
    download(
      new Blob(
        [JSON.stringify(generated?.frames.length ? generated : capture)],
        { type: "application/json" },
      ),
      "draw3d-depth.json",
    );
  $("#download-mesh").onclick = () =>
    download(
      new Blob([meshToOBJ(review)], { type: "text/plain" }),
      "draw3d-review.obj",
    );
  document.addEventListener("visibilitychange", () => {
    store.log("page.visibility", { state: document.visibilityState });
    if (document.hidden) {
      studio.endAll();
      store.flush().catch(() => {});
    }
  });
  window.addEventListener("pagehide", () => {
    studio.endAll();
    store.log("page.hide");
    store.flush().catch(() => {});
  });
  window.addEventListener("keydown", (e) => {
    if (
      ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) studio.redo();
      else studio.undo();
    }
  });
  if (store.session.latestCapture) {
    const asset = await store.get("assets", [
      store.session.id,
      `captures/${store.session.latestCapture}.json`,
    ]);
    if (asset) {
      capture = JSON.parse(await asset.blob.text());
      renderCaptures(capture.frames);
      $("#capture-status").textContent =
        `Recovered ${capture.frames.length} measured depth views.`;
    }
  }
  if (store.session.latestGenerated) {
    const asset = await store.get("assets", [
      store.session.id,
      `generated/${store.session.latestGenerated}.json`,
    ]);
    if (asset) {
      generated = JSON.parse(await asset.blob.text());
      if (generated.frames.length) {
        renderCaptures(generated.frames);
        $("#reconstruct").textContent = "Reconstruct generated surface";
      }
    }
  }
  renderTranscripts();
  changed();
  navigator.storage?.persist?.().catch(() => {});
}
init().catch((e) => {
  console.error(e);
  notice(`Startup failed: ${e.message}`, true);
  $("#save-status").textContent = "Local session unavailable";
});
