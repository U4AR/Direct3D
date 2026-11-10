# Draw3D spatial studio

Draw3D is a harness for human and AI collaboration on CAD design. Sketch, type
or speak the next design step, inspect the result, and continue editing the same
2D profiles and 3D bodies. Existing geometry, dimensions and inferred symmetry
remain editable throughout the workflow.

[Live app](https://draw3d-313721568883.us-central1.run.app) ·
[Cloud deployment and authentication](deploy/cloud/README.md) ·
[Noncommercial license](LICENSE.md) · [License scope and exceptions](NOTICE.md)

The hosted app requires Google sign-in and an invitation code, with a private
workspace per account and a maximum of two active users. Credentials are kept
on the server. The application source is available under **PolyForm
Noncommercial 1.0.0**; independently licensed components retain their licenses.

## Server modeling (Blender + FreeCAD)

The production backend runs Blender 4.5.9 LTS and FreeCAD 1.1.4 in separate Linux containers. Desktop and Quest display the same native results after each AI or manual operation. Voice audio and drawings go directly to the model with measured scene context; no transcription service is required. Features, dimensions, undo/history and native/interchange exports are supported. See [server deployment](deploy/README.md), [container configuration](compose.yaml) and [open-source notices](deploy/OPEN-SOURCE.md). For a remote Quest use the authenticated HTTPS deployment. The local development instructions below remain available.


Quest 3 WebXR prototype: draw with hands or controllers, describe the object, capture calibrated sketch depth, generate candidate object depths with Gemini, and inspect a reconstructed surface. The workflow intentionally stops at **surface review**, before finalization, color rendering, or Meshy.

## Run

Requires Node 20.17+ (or Node 22). From this directory:

```powershell
npm install
npm run dev
```

Open http://localhost:5173 on desktop. Drag to draw on the selected Z plane, change the plane to add depth, and use **Orbit** to inspect. **Load sample sketch** loads a real spatial stroke model for exercising the depth pipeline. It replaces the current drawing; historical strokes remain in the event log.

Prepared CAD assets and native runtimes are not committed. Use the setup and
deployment scripts to install them; the locked manifests and pinned upstream
revisions identify the dependencies. Private recordings, runtime data and
credentials are excluded from this repository.

## Quest 3

WebXR and microphone access require a secure context. Two development options:

1. **USB / ADB**: enable Quest developer mode and USB debugging, connect the headset, run `adb reverse tcp:5173 tcp:5173`, and open `http://localhost:5173` in Quest Browser. Keep the development server running on the PC. Localhost is a secure context.
2. **Trusted HTTPS**: obtain a certificate trusted by the headset for the PC's LAN address, set `HTTPS_KEY` and `HTTPS_CERT` environment variables to the certificate file paths, then run `npm run dev`. Open that HTTPS address on Quest. Plain HTTP at a LAN IP is insufficient. Accepting an untrusted certificate may not enable WebXR.

Click **Enter VR**. The session requests `local-floor` and optional `hand-tracking`.

- Hands: fingertip pinch draws using the native hand select signal when exposed; otherwise distance hysteresis (22/32 mm) is used. The point is the thumb/index midpoint in world metres. Tracking loss ends the stroke.
- Meta microgestures: slightly curl the fingers, touch the thumb to the side of the index middle segment, slide, and lift. Native `oculus-hand` buttons 5/6 provide swipe-left (undo) / swipe-right (redo); Single native thumb tap toggles the menu after a 500 ms double-tap window. Two taps 100–500 ms apart toggle pen/eraser without opening the menu. The menu remains open until another single tap or Close; fist detection is disabled. Hidden menus do not intercept drawing and their pointer rays are hidden. Up/down thumb swipes (native forward/backward, buttons 7/8) increase/decrease diameter by 2 mm, bounded to 2–24 mm. The menu has size buttons too. The eraser removes whole touched strokes with pinch/lower grip; Undo restores an eraser pass and Redo removes it again. Palette choices also switch back to the pen. On the right hand, toward the fingertip is left/undo and away is right/redo; directions reverse on the left hand. Side-of-index contact reserves input before the native completion event, preventing accidental pinch strokes. A normal native pinch release immediately rearms drawing; no 4 cm separation or post-swipe cooldown is required. The obsolete palm-swipe heuristic has been removed. See [Meta gesture instructions](https://developers.meta.com/vr/documentation/unity/unity-microgestures/) and the [WebXR profile](https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/oculus/oculus-hand.json).
- Controllers: hold the lower grip/squeeze button (WebXR gamepad button 1). Drawing uses the grip pose, with a default local tip offset of `[0, -0.11, 0.025]` metres. This approximates the controller bottom; select 9–15 cm in the desktop settings to tune it to the physical grip. The visible nib follows that offset.
- A world-space panel displays transcripts and Undo, Redo, Capture, Rebuild, and Mic buttons. Aim the visible controller/hand ray; a green ray and highlighted button confirm the target. The front trigger (button 0) / pinch activates once per press. Aiming at panel padding consumes the press without drawing.
- Controller shortcuts: X (left) / A (right) undo; Y (left) / B (right) redo. Flick either thumbstick left to undo or right to redo. Release to neutral before repeating; holding the stick or a button does not repeat. Undo during a stroke ends it and prevents more drawing until the grip is released.
- Reconstructed geometry appears to the right of the sketch, with its bottom at the virtual review surface height. Original coordinates are retained in exported meshes; placement translation is recorded separately.

The input code targets Quest 3, but **physical headset hand/controller alignment, sustained frame rate, mic behavior, and thermal performance need on-device testing**. This implementation uses a virtual surface; it does not scan a real tabletop or access passthrough camera frames. Captured images are renders of the sketch.

## Speech

**Enable microphone** requests access and records audio locally. Silero VAD v5 runs on-device through ONNX Runtime WASM. Its model/worklet/WASM assets are served locally by `scripts/copy-vad.mjs`. There is no Whisper dependency or model download.

Transcription prefers `SpeechRecognition` / `webkitSpeechRecognition` when the browser exposes it. Native interim and final captions are displayed; an already-installed on-device English language pack is preferred when the browser can verify its availability. Otherwise platform recognition may use a network service. Quest system voice dictation and the native Meta Voice SDK do not guarantee access from WebXR; the implementation detects the actual browser API rather than relying on a user-agent string. Permission denials are surfaced, not bypassed.

When the browser API is absent, or its service fails without a permission denial, VAD speech segments are sent as mono PCM16 WAV to `/api/transcribe`. The server defaults to **`models/gemini-3.5-flash-lite`**, with minimal thinking and a 2,048-token output cap. This is a low-cost current model: as checked on 2026-10-07, standard audio input is $0.30 / million tokens and text output $2.50 / million tokens. Gemini 2.5 Flash-Lite has cheaper output but Google restricts access to prior users; `GEMINI_AUDIO_MODEL` can select it if the API key is eligible. See [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [availability guidance](https://ai.google.dev/gemini-api/docs/deprecations).

Nano Banana 2.1 does **not** list audio input support. The fallback therefore uses Flash-Lite to produce the transcript, then Nano Banana receives text plus sketch views. The same server-only `GEMINI_API_KEY` is used for both. Cloud transcription requires that key; until configured, raw audio remains local and pending speech can be retried by restarting the microphone in the same tab. Reload preserves audio assets, but not the in-memory upload queue. Each provider request is limited to 20 seconds of speech, and silence is filtered by local VAD.

Continuous microphone chunks preserve audio including silence; VAD speech segments are also saved as mono 16 kHz float32 PCM, with WAV copies for cloud requests. Stop the microphone before final session export. Typed descriptions remain available without microphone/API access. Native recognition currently requests English; the Gemini fallback preserves the spoken language.

## Gemini bridge — add the key later

Private backend credentials were excluded from this transfer. Existing `.env` files may still refer to the old machine; configure credentials separately using `.env.example` or the Docker deployment instructions before using AI. Never put private keys in a `VITE_*` variable or browser code. In another terminal:

```powershell
npm run bridge
```

The Vite server proxies `/api/depth` to the loopback bridge on port 8788. The bridge uses the equivalent of the supplied Python Interactions call:

```python
client.interactions.create(
    model='models/gemini-3.1-flash-lite-image',
    input=calibrated_sketch_images_and_description,
    generation_config={'max_output_tokens': 32768, 'thinking_level': 'medium'},
    response_modalities=['image'],
)
```

The implementation calls the documented REST endpoint the v1 Interactions endpoint for transcription and v1beta for Nano Banana images. Model name is configurable through `GEMINI_MODEL`. It reads image parts from `steps[type=model_output].content`. The supplied example's 65,536 output cap was reduced to the model's documented 32,768 maximum. Image-generation calls happen only when you click **Generate object depth**; enabled Gemini transcription sends VAD speech segments as they finish. Missing keys are reported explicitly; there is no fabricated model output.

For each target view, Gemini receives its sketch render, sparse measured depth preview, camera calibration, all other sketch views, and the accumulated description. One sequential call per target view encourages a known correspondence between output and camera. Raw requests, model input, responses, and failures are retained under `SESSION_DIR` (default `sessions/`, ignored by Git). Browser storage also keeps raw generated images, including images rejected during calibration. This sends those images and descriptions to Google; audio is sent separately only when Gemini fallback transcription is used. Headset pose logs are never sent to either model.

**Live verification (2026-10-07):** the PC backend successfully transcribed a synthetic spoken sentence with Gemini 3.5 Flash-Lite. Nano Banana 2.1 is listed for this credential but its v1beta request returns a zero Free Tier input-token quota (429); image generation requires quota/billing to be enabled by the account owner. The stable v1 endpoint returns model-not-found for this model. Requests use the current `response_format` field and `user_input` content wrapper. All provider calls and authentication stay on the PC. The dev server blocks `.env`, private files, session archives, and hardware reports; neither client code nor returned health data contains the credential.

## Depth contract and reconstruction

- Captures contain only stroke tubes, excluding hands, grid, stage, and reconstructed objects.
- 256×256 perspective views preserve `intrinsics` and `cameraToWorld` (column-major). Camera convention is Three.js right/up/back, viewing along local -Z. Image origin is top left; pixel centres are at `(x + 0.5, y + 0.5)`.
- `depth` is positive **camera Z depth in metres**, not Euclidean ray distance. Background has `mask=0, depth=0`. The custom RGBA shader encodes measured depth at 0.1 mm resolution; JSON retains the numeric depth independent of the PNG preview.
- Auto coverage uses bounding-box thickness: one view for nearly planar geometry, six sides for volumetric geometry. Manual 6- and 10-view modes are available. This is an extent heuristic, **not a convexity estimator**; it cannot guarantee coverage of concavities or occluded cavities.
- Gemini grayscale images are **relative geometric estimates, not measured metric depth**. A robust affine fit uses visible stroke-depth anchors to estimate scale. Calibration requires sufficient intensity variation, a negative slope (near-white), enough anchors, and residual RMSE ≤35 mm. Invalid aspect ratios and failed fits are rejected. Even a passing fit does not prove the inferred object is geometrically correct or consistent across views.
- The browser backprojects valid pixels into the shared world frame, triangulates each depth grid while rejecting discontinuities, welds samples into 4 mm voxels, and deduplicates faces. This produces one review mesh, potentially with disconnected components, holes, or overlap. It does not guarantee a watertight manifold. Captured sparse strokes reconstruct strokes; they cannot uniquely determine a filled object.
- Generated object depths are used only if calibration succeeds. Otherwise raw captured depths remain available; the UI identifies which source is being reconstructed. Editing the sketch invalidates the capture for further processing until recaptured.

Export a depth bundle, then run the same deterministic reconstruction without the browser:

```powershell
npm run reconstruct -- draw3d-depth.json review.obj
```

For dense multi-view maps, optional desktop TSDF integration:

```powershell
python -m pip install open3d numpy
python scripts/fuse_tsdf.py draw3d-depth.json review.ply --voxel 0.005 --truncation 0.025
```

The TSDF script converts the camera axes to Open3D conventions and integrates metric depths at known poses. It cannot repair inconsistent generated views. Open3D is optional and is not installed by `npm install`.

## Local recording and recovery

IndexedDB stores the active session; reload restores strokes, descriptions, and the latest depth assets. A Web Lock prevents a second tab from overwriting that active session; close the original tab before using another. Persistent storage is requested where supported. **Export session** produces a ZIP containing:

- `session.json`: stroke geometry, timestamps, descriptions, revision and capture references.
- `events.jsonl`: ordered actions, stroke samples, camera moves, brush changes, workflow events, and headset/controller/hand poses at up to 30 Hz while in immersive mode, including tracked joints, button states, and axes.
- `assets/`: measured/generated depth bundles, review meshes, microphone recording chunks, and VAD utterances.
- `assets.json`: asset metadata, recording IDs, sample rates, timing and MIME types.

Concatenate continuous audio chunks **in filename order within the same recording ID** to recover that recording's WebM/MP4 container; chunks are not necessarily independently playable. All app-level events are logged, not the entire OS or headset screen. No passthrough video is recorded. Page closure can lose the last uncommitted one-second event batch or unflushed audio chunk; export after stopping the mic for a durable copy. Browser data can be removed by the user or OS; storage errors remain visible. Long pose/audio sessions consume substantial storage.

## Checks

```powershell
npm test
npm run build
# With npm run dev running:
npm run test:browser
```

Browser tests use an installed Chrome (`CHROME_PATH` can override its location), verify desktop strokes/undo/redo, six-view capture, metric values and masks, surface reconstruction, ZIP export, reload recovery, and mobile width. Physical Quest input and live microphone/model inference require hardware/network checks beyond these tests.

Additional checks exercise real Silero v5 inference, native speech events with a simulated browser recognizer, WAV upload and transcript handling through a mocked Gemini endpoint, GPU capture of a plane at a known camera distance, pinch hysteresis/controller grip transforms, and Open3D TSDF fusion of six synthetic sphere views. Run the optional Open3D check with `python -m unittest discover -s tests -p test_tsdf.py`. These checks do not measure physical Quest performance, real native-service availability, or live Gemini transcription accuracy.

References: [Three.js WebXRManager](https://threejs.org/docs/pages/WebXRManager.html), [Silero browser VAD](https://docs.vad.ricky0123.com/user-guide/browser/), [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API), [Gemini Interactions API](https://ai.google.dev/api/interactions-api-v1), [Nano Banana 2.1](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image).

## Connected Quest diagnostics

On 2026-10-07, a physical Quest 3 running Quest Browser 149.1 / Chromium 149 successfully entered immersive VR and recorded controller-trigger strokes, hand-pinch strokes, and head/hand poses. Neither `SpeechRecognition` nor `webkitSpeechRecognition` was exposed by this browser. Live backend transcription is now verified with a synthetic spoken sentence. Native Meta swipe-left/right undo/redo was observed on the physical headset. Nano Banana image generation reaches the provider but is blocked by zero Free Tier quota.

For USB diagnostics, forward the browser debugger with `adb forward tcp:9223 localabstract:chrome_devtools_remote`, keep the headset awake, and run `node scripts/quest-monitor.mjs`. The script attaches only to an already open localhost:5173 Draw3D tab, reads app events and asset metadata for one minute, and saves a report under `artifacts/quest/`. These reports can contain descriptions and poses; that directory is ignored by Git.

Microphone startup creates and resumes its AudioContext before asynchronous permission/model loading, passes that context to Silero, and logs frame levels, context state, and track mute events. Enter VR also starts the microphone; the Mic button can stop it. Gemini transcription continues through the PC backend only.

The PC bridge calls Nano Banana 2 Lite (`models/gemini-3.1-flash-lite-image`) directly as its primary image model, with 1K output, minimal thinking, and 4096 output tokens. No fallback is enabled by default. An optional `GEMINI_FALLBACK_MODEL` can be configured server-side for provider access/quota/unavailability errors. Requests, responses, and actual model selection are archived locally. Image generation requires available Google API quota.

The VR audio strip remains visible independently of the menu, showing microphone level, VAD confidence, speech detection, transcription and disconnected/no-signal states.


## Full CAD on Quest Browser

Choose **Full CAD** in Draw3D. If currently drawing in immersive VR, the CAD menu action ends that XR session and opens the editor in the browser window. **Spatial drawing** returns to the drawing workspace without unloading the CAD project.

The full editor is OpenZCAD, pinned to `ae6553b498d5ba04d8c7b5cc43d97682bd5f94a3`, with its Remus WebAssembly engine computing in a worker on the headset. The PC serves static assets; full CAD operations do not call the PC CadQuery endpoint or Gemini. Its browser interface includes sketches/constraints, parameter expressions, feature history, extrude/revolve, booleans, transforms, fillets/chamfers, patterns, and STEP/project import/export. This is the upstream beta editor, not a claim of complete FreeCAD feature parity.

**Drawing + speech** keeps a sketch snapshot and transcript beside CAD and offers microphone control and an agent-context JSON export. Sketch coordinates remain in metres; CAD project units are explicit. Automatic drawing/speech-to-CAD execution is not connected yet. A future agent can consume `draw3d.agent-context.v1`, the stroke data/transcripts, and the OpenZCAD project revisions without needing provider credentials on the headset.

OpenZCAD autosaves editable projects in the headset's IndexedDB (`openzcad-v2`). Draw3D also records editor pointer/key/change interactions and committed project revisions with the drawing session. The CAD **File → Export project** command makes a complete editable backup including imported source files. Draw3D's session export includes recorded project revisions and sketch/speech context; use the CAD project backup to preserve all imported source blobs. These browser stores are local to each device; they are not automatically a PC disk backup. The OpenZCAD account/cloud/AI controls are not configured in this local integration and show offline/unavailable. Draw3D speech/image model requests still use only the existing PC backend.

Install/build with `npm run cad:setup`; all caches, source checkout, dependencies and the isolated Node 22 toolchain stay on D:. This builds the pinned vendor source without modifying it and packages static assets under `public/cad`, plus root font/PDF assets required by its loaders. `npm run cad:bundle` repackages an already-built vendor editor. Standard `npm run build` includes these assets once setup has run. `npm run test:browser` includes the integration regression for device-side solid creation, metric STEP export, history, sketch context, recording and reload.

OpenZCAD and Remus use Apache-2.0. Full license, NOTICE and third-party notices are retained in the CAD **Licenses** link; npm dependency license files are bundled under `/cad/licenses/`. OCCT used for optional FreeCAD import has its own LGPL/exception terms, documented there. See https://github.com/esaueng/OpenZCAD for upstream source. Integration modifications are the hosting base and the local Draw3D recorder script injected into the built HTML.


Validation (2026-10-13): 30 unit tests and 9 browser tests passed; the final CAD/context test and production build also passed after UI cleanup. On the connected physical Quest 3 (Oculus Browser 152), created a 40 × 30 × 20 mm part, reopened its locally saved document, and exported STEP using the headset's WASM engine. Parsed STEP extents were exactly `[40, 30, 20]` mm. Normal proximity-sleep behavior was restored after the device test. This verifies the browser CAD workflow, not a new immersive CAD controller interaction layer.


## CAD, sculpting and MCP agents

Spatial drawing, full OpenZCAD, and full SculptGL are available through the workspace tabs. Models + agent provides shared mesh previews, metric position/rotation/scale, transfer between editors, agent activity and pause controls. Native projects remain saved locally.

The stdio MCP connector in [mcp.draw3d.json](mcp.draw3d.json) exposes both editors plus 3D sketch/transcript context and an independent camera. See [AGENT_API.md](AGENT_API.md) for setup, tool schemas, coordinate conversions and concurrency rules. The agent's workspace/camera do not move the user. A separate reasoning agent must be connected to these tools.


**Typed instructions and sketch placement:** Use **Type instructions**, or the text field in either editor's **Drawing + speech** panel. The VR **Type** action opens the browser field after leaving immersive VR. The agent can now obtain annotated multiview sketch images, six metric extrema, a proposed build box, native CAD/Sculpt construction coordinates, and version-checked assembly alignment. Model-overlay captures let it compare results against the drawing without moving the user's camera. See the sketch-guided workflow in [AGENT_API.md](AGENT_API.md).


**POV sketches, surfaces and completion:** New drawing and prompt records retain camera views. MCP tools render those views, project whole strokes or sample ranges onto arbitrary planes, preview regular profiles or native cubic splines, and create native CAD sketches ready for extrusion. **Select drawing surface** / **Free-space drawing** constrain or release spatial annotations on shared CAD/sculpt meshes. Agents explicitly complete prompts to hide only the associated strokes; **Show completed drawings** restores them. See [AGENT_API.md](AGENT_API.md) for approximation limits and the full workflow.


**Native spline extension:** CAD now has **+ Spline**, **Edit spline**, draggable control handles, and exact curved extrusion/STEP output. Agent tools fit reference planes with RANSAC, compare optional axis-aligned interpretations, and expose editable position/yaw/pitch. **Snapping preferences** add magnetic sliders and optional round-value suggestions while preserving exact typed input. See [AGENT_API.md](AGENT_API.md) for native spline scope and current constraint limitations.


## In-app modeling AI

Open **Models + agent**, type an instruction (or use the latest saved speech transcript), then press **Run AI**. The typed draft is saved automatically. **Stop AI** cancels further reasoning and queued commands; an edit already executing can finish. Existing CAD projects and native undo histories remain available. The answer and tool activity appear in the same panel. Use **Show agent workspace** to switch your own editor explicitly; the agent never moves your camera.

The PC backend runs **GPT-6 Luna** (`OPENAI_AGENT_MODEL=gpt-6-luna`, `OPENAI_AGENT_REASONING=medium`) through the OpenAI Responses API, separately from the image model (`gemini-3.1-flash-lite-image`) and speech model (`gemini-3.5-flash-lite`). Model selection is backend-only and the API key never goes to the browser. Run AI sends the instruction and tool-requested drawing/model context, including independent rendered views, to OpenAI. The agent can operate CAD and SculptGL, inspect multiple sketch views, fit/project planes, trace native splines, and align models. It is a general tool-using model, so inspect its result and use undo when necessary.

Each run is bound to the initiating browser capability, limited to 48 orchestrator turns, 40 turns per specialist, 160 shared turns and 30 minutes of active work (waiting for a design answer is excluded). Tool arguments are validated against the same MCP schemas and edits retain version conflict checks. Raw prompts, responses, tool calls, results and images are recorded under `SESSION_DIR/agent-runs/<id>/events.jsonl` on the PC. Browser session exports also record run summaries and tool activity. Provider errors are shown explicitly; a completed run means the model finished responding, not an independent guarantee of design correctness.

Try: “Create a new CAD project with a 40 × 30 × 20 mm box, then inspect it from two angles.” For drawing-driven tests, draw a closed outline, describe its intended thickness, then Run AI.

`npm run test:ai` checks validation, image feedback, cancellation, and session isolation without paid model calls. The optional live end-to-end test uses real OpenAI calls: set `DRAW3D_LIVE_AI=1`, then run `npx playwright test tests/model-agent-live.spec.js` while Vite and the backend are running.

The modeling agent reads `OPENAI_API_KEY` from this machine’s environment; no copying into the web project is needed. Gemini continues to handle the existing image-generation and fallback transcription flows.


### Automatic speech handoff and replay logs

Finished microphone transcripts now run the modeling agent automatically after a 1.8-second quiet interval. Interim text never starts a run. Adjacent final segments are grouped, repeated transcript IDs are ignored, and requests spoken during an active run wait in a queue. Stop AI clears queued speech as well as stopping the current run. Turn off **Automatically act on finished speech** to return to manual dispatch. Previously saved transcripts are not replayed automatically on reload; use Run AI to retry one deliberately.

The persistent desktop status card and the VR voice HUD show received/queued speech, thinking steps, current tool, completion, and failures. Audio recording status is separate. Continuous microphone chunks stay in headset IndexedDB; each VAD utterance also becomes a playable mono PCM16 16kHz WAV. WAVs are copied through a session-authenticated endpoint to `SESSION_DIR/audio/<recording-id>/`, with timing/transcript metadata. Failed PC copies stay queued on the headset and retry when connected. `/api/transcribe` jobs also contain `audio.wav`. No audio is captured while the microphone is off.

Use `node scripts/replay-speech.mjs <saved.wav>` while the bridge is running to replay a saved utterance through transcription. This script prints the transcript and saves the response beside the WAV; it does not edit models or automatically replay old commands.


### Intent-aware modeling harness

The agent receives stable per-stroke variables and labeled, independently colored inspection views. Its skill distinguishes design intent from drawing noise and chooses native extrude/revolve, curved spline surfaces or mesh paths. It can create equation/loft surfaces, fit stroke samples with regularization, trim projected outlines, mirror geometry and place patterns along surfaces. These tools support interpretation; they do not guarantee semantic correctness.

A consequential ambiguity produces a **Design question** popup in the browser and a selectable VR panel. Speak an answer, choose an option or type a response to continue the same task. Microphone transcription must be enabled for speech answers. Stop AI cancels a waiting question. Browser reloads retain the session capability; restarting the PC backend interrupts in-memory runs while preserving saved edits and question records.

Spline surface commits are open meshes with editable mathematical source, without automatic thickness/caps. Trimming approximates UV boundaries; mirrored/patterned copies are mesh components without Boolean fusion. Use native CAD features for exact solids.

Validation: `npm test`, `npm run test:ai`, and `npx playwright test tests/harness.spec.js tests/agent.spec.js`. Browser tests exercise real editors and simulated transcript events; they do not judge a live AI-generated butterfly's artistic quality.


## Desktop sketch studio

Open **http://localhost:5173/desktop.html** for the separate mouse/pen desktop version; `/` remains the spatial/VR studio. Both entries are included in production builds. Desktop recordings use a separate IndexedDB database and active-session key, so opening this version does not replace the VR drawing.

The desktop opens in 3D CAD. Select a reference plane or body face, then click Sketch; the orthographic 2D board is also available. Each completed stroke is fitted locally to lines, circles, rectangles, polygons or splines, preserving the original. Use Fit drawing, scroll to zoom, D/E for draw/erase, V to inspect in 3D, and Ctrl+Z / Ctrl+Shift+Z for undo/redo. Export fitted SVG downloads metric planar geometry without an AI call.

Choose Refined 2D drawing or 3D CAD model, describe the intent and dimensions, and click Build from sketch. Start `npm run bridge` for the existing modeling backend; provider credentials remain server-side. Review the agent result using Model tools & placement / Show agent workspace, give a further instruction to refine it, then accept the draft. Desktop edits receive complete drawing evidence and apply structured output locally. Simple edits normally finish in one request; the model can explicitly request further moves when needed. Local sketch fitting and SVG export work without the backend.


### Desktop automatic AI and CAD selection

**Enable AI** is the master switch (off initially). Once enabled, completed drawing changes and typed instructions dispatch after a 2.2-second quiet interval; finished speech uses the existing 1.8-second speech handoff. Text and speech are optional: a drawing-only request asks for a sensible editable draft using the measured evidence. Additional drawing/text changes wait while the agent runs. Stop AI also disables automatic dispatch. Disable Enable AI to return to local fitting and manual Build. The app shows fitting, queuing, provider progress, completion and errors on the canvas. Reload does not replay old strokes as new requests.

Every desktop run gathers the full active drawing before its first provider call. Strokes are batched in groups of 16, each with a separate image from its recorded view, local geometric estimates, parameters, residuals, surface attachment and fitted/combined views. Fits are supplied directly with the drawings; saved sketch outputs can also be requested by ID. Orthographic camera matrices are preserved. The agent receives the selected model edge/surface/body and its version as context. Provider calls, input evidence and results are retained in the existing session logs.

In **3D CAD**, click near an edge once, double-click a surface, or triple-click a body. A surface selection enables **Draw on surface**; D also keeps the 3D view and starts drawing on that selected surface. **Select** returns to selection. Middle-button drag rotates, Ctrl+middle-button drag pans, Ctrl+wheel translates, normal wheel zooms, and Escape clears selection. Surface strokes stay on the selected connected mesh patch; changes to its model version invalidate the selection. This viewport operates on tessellated geometry: crease edges and connected smooth triangle patches approximate native CAD topology, and imported mesh bodies use the same controls. Exact native feature/topology editing remains in Full CAD.

Validation on 2026-10-15: a real configured AI provider built a native CAD body from a drawing-only rectangle, then edited that same feature from a typed follow-up to 20 mm thickness. The measured outline stayed 174.4966 × 134.2282 mm; mesh thickness was 19.9999996 mm. Evidence and results are recorded under `artifacts/desktop-live-result.json` and the corresponding session agent-run logs. Run `DRAW3D_LIVE_AI=1 npx playwright test tests/desktop-live.spec.js` to repeat with paid provider access. Automated tests also cover queued edits, the master switch, speech handoff, per-stroke images, mesh topology, click selection, surface drawing, recovery and SVG export.


### Interpreting rough drawings

Design interpretation is defined in the model prompt at `scripts/model-intent-prompt.mjs` and the modeling agent's workflow skill. It asks the model to infer familiar intended figures from the raw images and user instructions: rough rectangles may become clean rectangles, and imperfect circular loops may become circles. It preserves meaningful ellipses, arcs, rounded details, organic shapes and asymmetry. The model must state significant assumptions and verify the resulting native geometry.

The deterministic fitter supplies numerical measurements and alternative primitive/spline candidates under its existing geometric tolerances. It does not use rectangle/circle intent priors or override a spline because a shape looks familiar. A local preview can therefore remain a spline while the model creates a clean circle or rectangle. Existing cached heuristic interpretations are recomputed from the original samples without replaying AI requests. Tests retain the user's rough-rectangle fixture and verify both unchanged spline evidence and the intent rules sent to the provider.

### Live AI activity

The desktop canvas now includes an always-visible **Live activity** panel. It labels local fitting separately from AI requests, shows the submitted instruction, evidence counts, tool names with plain-language actions, expandable arguments/results, elapsed waiting time, model replies and completion/failure/cancellation. Collapse logs reduces it to its header. Recent activity is saved with the browser session and restored after reload. Backend JSONL logs now include structured activity and terminal run states, so a provider or browser failure does not look like a silently unfinished edit. Raw geometry blobs, image payloads and credential fields are excluded from public tool details. The feed reports observable operations and provider status, not hidden model reasoning.


### CAD sketch tools and scope

The default output is **Follow instructions · 2D by default**. The model prompt preserves the user's requested scope: a circle/rectangle drawing is a planar figure, with no inferred thickness or invented assembly parts. Explicit text overrides workspace preferences; selecting 3D CAD or asking for a solid authorizes that dimensionality. Local fitting remains geometric evidence and may show a spline; only the model interprets intent.

The canvas toolbar exposes Select, Freehand, Line, Rectangle, Circle, Dimensions and Full CAD. Exact figure tools create editable native OpenZCAD sketches, show on-canvas millimetre dimension labels, and expose Radius/Width/Height/Length in Geometry & dimensions. The direct AI response supplies the intended geometry and dimensions; local drawing operations create or update the native sketch. Their native-sketch and image checks allow a 2D review without creating a solid. Apply dimensions updates the native sketch; Extrude explicitly asks for thickness before creating a solid. SVG export includes exact circle/rectangle entities from the drawing.

In 3D, hold the middle mouse button (scroll wheel) and drag to rotate; wheel scrolling zooms and right-drag pans. Body selection shows measured X/Y/Z extents in the properties panel. Full CAD opens the underlying native editor for advanced features and constraints.


### Desktop direct AI edits

The desktop board uses `POST /api/agent/desktop-edit`, rather than the MCP command/tool loop. Each model move receives the current instruction, recent text/speech context, selected surface/body, all active strokes with raw world-metre coordinates, local fit candidates and residuals, a separate recorded-view image for every stroke, combined reference images, and existing editable figures with their dimensions and versions. The original deterministic fit is evidence only: human drawing priors and scope rules live in the model prompt.

The model returns a strict JSON drawing response in that same request. The browser validates it and creates or updates exact native circle, rectangle, line or planar cubic spline figures with visible dimensions. An explicitly requested extrusion is applied locally. It reports local verification through `desktop-applied`; that acknowledgement makes no AI request. Unsupported modeling operations or consequential ambiguities produce a focused question, without a fallback tool loop. Responses based on changed geometry are rejected before application; newly drawn strokes remain queued for the next turn. Extra moves happen only when the model returns `continuation: {reason, nextMove}`. After applying the current edits, the browser sends refreshed images, geometry, versions, dimensions and previous application outcomes within the same run. `continuation: null` ends the run. An output-limited partial JSON response or a structurally parsed response rejected by geometry validation can receive one repair request (two provider requests maximum for the move). Geometry-validation feedback is sent to the model before any edits are applied; malformed JSON and tool calls still fail directly. New user input takes priority over pending extra moves.

The on-canvas activity log shows evidence preparation, each AI move and its continuation reason, the returned interpretation and parameters, local application, verification, and errors. Exact request/response JSON and event logs are saved under `sessions/desktop-edits/<run-id>/`. API credentials stay on the local backend. The VR/advanced tool agent retains its existing protocol.


For substantial requests the model can choose automated mode with `automation: {goal, reason, steps}`. It carries out the requested plan through direct edits and model-requested continuation moves, updating step progress with refreshed images and measurements. The mode, reason and plan are visible in the live activity and AI plan. Simple stroke cleanup remains direct. New input takes priority, Stop AI interrupts the run, and automation grants no permission to invent extra features or unsupported operations.

Every model move includes per-stroke engineering drawing priors: near-horizontal/vertical alignment in the actual drawing plane, sensible whole-number and common engineering angles, collinearity, parallelism, perpendicularity, shared endpoints, symmetry and concentricity where supported by the drawing. These remain prompt instructions only. Explicit fractional angles, dimensions, intentional oblique/asymmetric shapes and surface frames take precedence; the numerical fitter and raw strokes are unchanged.


### Unified desktop CAD workflow

The desktop now opens in the 3D CAD workspace. Choose Front/Top/Right or a saved custom reference plane before sketching; one offset moves a plane along its normal. Create another plane as a parallel copy or at an angle around either sketch axis; Drag offset provides a single normal handle. Attached sketches move with their reference plane. Double-click a body face to sketch on it. Middle-button drag rotates the view, Ctrl+middle-button drag pans, Ctrl+wheel translates and normal wheel zooms; a separate Orbit mode is unnecessary.

The Model/History sidebar lists editable elements and recorded CAD states. Select an element to edit its name, position, dimensions, line angle or reference status, or give an element-specific AI prompt. Reference lines are dashed native construction geometry and cannot be extruded. The history panel restores native documents, figures, strokes and saved reference planes while retaining later snapshots. The advanced native CAD editor has explicit plane and face sketch controls plus a return to the AI freehand workspace.

Desktop AI context is retained per drawing across separate strokes and backend restarts. New/changed stroke evidence is appended; unchanged geometry is not duplicated on each turn. A size-triggered checkpoint retains current geometry/versions, instructions, spatial stroke summaries, application results and recent images. Full raw drawings remain saved. Coordinate samples sent to the model are compacted copies; local fitting and original geometry are not modified. The direct provider has a larger output allowance and lower processing effort; an output-limited JSON response is discarded and gets one bounded recovery request with a smaller batch and larger output allowance. A parsed response rejected by drawing validation can instead use that single recovery attempt to receive its exact validation error and correct the intended geometry. Rejected geometry is never applied or recorded as an accepted drawing decision. Malformed JSON and tool calls fail directly.


### Named sketches and multi-sketch 3D

Choose a plane → Sketch → enable AI or click Build to refine it. Each named sketch retains its stable ID, plane frame, raw strokes, native refined figure references and dimensions. New strokes on another plane become a separate sketch. Use New sketch on this plane for independent sketches sharing a plane. Rename and reopen sketches in the left library; check the inputs you want and use **Build 3D from selected sketches**, optionally typing the intended relationship first.

Selected sketch outputs are attached directly to each AI move: exact figure geometry, native IDs, dimensions, plane placement and an isolated plane image. The complete catalog remains visible to the model. It can request missing saved outputs using `requestedSketchIds` and an explained continuation; the browser supplies them in the next move without MCP discovery calls. A new raw sketch may be refined first, then used for a model-requested 3D move once its native IDs exist.

Multi-sketch direct output supports exact native lofts between ordered cross-sections and intersection/union/subtraction of extruded closed profiles. Orthographic silhouettes are not automatically treated as loft sections. The model follows your requested interpretation and asks about consequential ambiguity. Source sketches remain editable, and dependent CAD features rebuild after dimension changes. This is a focused desktop CAD workflow, not complete SolidWorks feature parity.

Checks: `npm test`, `npm run test:ai`, and `npx playwright test tests/desktop-cad-workflow.spec.js tests/desktop-drawing.spec.js tests/desktop-continuation.spec.js`. Opt-in synthetic live test: `DRAW3D_LIVE_AI=1 npx playwright test tests/desktop-multi-sketch-live.spec.js` (PowerShell: `$env:DRAW3D_LIVE_AI='1'`). This uses only newly generated drawings in empty recordings, with no saved user fixtures sent to the provider.


Live validation on 2026-10-15: a fresh synthetic recording produced two circles of radii 40 mm and 20 mm on planes 80 mm apart, then one native ruled loft of volume 234572.25 mm³. Each edit used one provider request and no model tool calls. The second stroke appended to the same persistent context while preserving the first refined output. Results: `artifacts/live-shared-context-loft.json` and `.png`. Browser checks also verify on-demand saved output retrieval, loft rebuild after a source dimension changes, orthographic intersection, native mouse drawing and history restore.

The temporary Gemini adapter constrains a shallow JSON response envelope to avoid expensive nested geometry grammars; local contract validation checks every edit field, current ID/version, plane, dimension, axis and solid profile before native application. OpenAI receives the full response schema. Geometry interpretation and engineering priors remain model prompt instructions.


### Direct plane and sketch selection

In desktop 3D CAD, the Front, Top and Right planes and all saved custom planes appear as translucent, clickable patches with name labels. Click a plane to select it. Double-click a plane to create or reopen its sketch; double-click a sketch outline or raw stroke to edit that same sketch. Drawn sketch geometry has priority over its plane, and visible body geometry keeps its edge/face/body selection behavior.

Sketch editing aligns an orthographic camera to the plane, centered on the sketch bounds or the plane origin when empty. Other solids stay visible with temporary transparency; neither their CAD geometry nor their visibility is changed. Middle-button rotation and Ctrl+middle-button/wheel panning remain available. **Finish sketch** returns to the 3D view and restores solid materials. The separate Front 2D board keeps its own camera and drawing plane. Sketch inputs and editable native outputs keep their existing IDs when reopened.

Check `npx playwright test tests/desktop-plane-picking.spec.js` for direct viewport picks, angled planes, centering, drawing on reopened sketches, transparent model context, material restoration and camera transitions.


After a desktop AI edit, the latest result stays bright while older sketch figures, original strokes, local fitted previews and other models are greyed for context. Multi-move outputs from the same run stay highlighted together. New pen strokes remain bright; grey geometry remains selectable. **Show all geometry** restores normal colors, and result focus survives reload. Reference images sent for subsequent AI edits use normal materials so visual emphasis does not change the evidence. The toolbar now starts with a prominent **Pen** button and D shortcut, with the same Pen action in the left tools. Check `tests/desktop-result-focus.spec.js` for 2D/3D response emphasis and its interaction with transparent sketch editing.

For a rough angular outline, including a chamfered tag or stepped profile, the AI prompt explicitly asks for connected native straight-line edits with shared endpoints. The numerical spline remains reference evidence; the deterministic fitter does not choose design intent. Intentional curved contours remain supported as numeric local-plane cubic splines. A rejected geometry response gets one visible, bounded model repair attempt without changing the user drawing.

AI interpretation preserves the intended mix of straight and curved regions, including rounded ends and tangent transitions. Geometry-validation repair fixes encoding/parameters while preserving that interpretation. A flat cubic coordinate list is reported with the exact edit field and nested-array format; it must not be replaced by facets to bypass validation.

Routine desktop sketch/dimension edits use LOW reasoning and concise direct output. Larger assembly/layout/pattern tasks, selected solid output, sketch-build requests and active automated plans use MEDIUM; routing does not make a separate model call. Live activity records the actual reasoning setting and provider duration for every request. Current temporary Gemini 3.8 Flash supports LOW as its lowest thinking level. The single validation repair remains a fallback for invalid output, not a required second step.

The direct desktop editor also supports exact native circular arcs via centre, radius and counter-clockwise start/end angles. Rounded circular caps can be emitted as an arc alongside straight edges, avoiding cubic control calculations; radius and angles are editable, visible and included in sketch outputs/history/SVG. A packed numeric cubic coordinate list is losslessly decoded locally into eight-coordinate segments without another model call. Missing or genuinely invalid curve data still fails validation; no shape is inferred by this decoder.

Double-click a canvas dimension to edit its actual CAD value. Individual width/height, diameter, line length/angle, arc radius/sweep, spline length and extrusion-depth values are stable clickable targets. Enter or Apply commits; Escape or Cancel discards. Millimetres and degrees are explicit, invalid/stale input is rejected before mutation, and each successful edit updates native CAD and history without an AI call. Spline length editing scales its local control points uniformly around its origin.


### Spatial VR drawing and direct AI refinement

Open `/` for VR (the desktop CAD version remains `/desktop.html`). Draw freely in world XYZ with the existing hand/controller pen. The **3D drawing to shape** panel fits all active strokes together: oriented cuboids, spheroids, finite cylinders, exact circular curves placed in 3D, 3D interpolating curves and editable cubic spline surface patches. Original ink is retained. A pale blue candidate is a numerical reference, not a committed AI result. Its weighted residual and alternatives are visible. Default priorities are corners **8**, edges **4**, surface proximity **1**, averaged within each feature class so dense surface guides cannot dominate by sample count. Change the priorities or mark new/latest strokes as edges, surface guides or corner marks. Sharp corners and joined edge endpoints provide extra corner constraints. Smooth curves are preserved.

Use **Refine 3D with AI** once, or switch on **Enable AI** for refinement after drawing pauses (optional text/speech). The headset menu also has **Enable AI** and an **Ink** role button. Each direct request supplies the user instruction, original XYZ samples, per-stroke numerical fits/images, collective candidate parameters/errors/weights, front/top/right orthographic views and current object versions/placements. The spatial model prompt applies human CAD priors while respecting deliberate curves and explicit dimensions. It can reuse a precise candidate by ID, override parameters or return new 3D geometry; no MCP round trip is needed. Simple changes use low reasoning; substantial coordinated tasks may use a model-requested plan and extra moves. Appended drawing context is compacted as it grows.

AI results are shared, selectable 3D meshes with saved parametric definitions. They can be moved/rotated/scaled with the existing object tools, selected as drawing surfaces, modified by later AI requests, or edited in **Editable 3D objects**. That panel exposes base world-metre parameters (sizes/radii, axes, XYZ curve interpolation points or cubic control nets) and **Undo last 3D edit**. Up to 32 parameter-edit snapshots are retained. Spline curves use a small tube only for display; spline surface patches are open surfaces, and these spatial outputs do not claim native CAD B-rep/STEP topology. New drawing, role/weight changes or object edits while a model request is running prevent stale application. Live logs distinguish local fitting, evidence capture, model work and applied edits. No automatic model request is sent until AI is enabled or explicitly run.

VR-specific checks: `node --test tests/spatial-fitting.test.mjs tests/spatial-direct.test.mjs` and `node node_modules/@playwright/test/cli.js test tests/vr-spatial-workflow.spec.js`. Browser tests inject fresh synthetic spatial pen input; physical headset tracking remains a device check.


### Supervision and geometric relationships (desktop and VR)

**AI supervision**, beside Enable AI, is shared across both versions and remembered in this browser. **High** asks before uncertain design choices or meaningful assumptions; **Balanced** infers obvious CAD relationships and asks about consequential ambiguity; **Low** proceeds with reasonable editable assumptions and asks only when conflicting requirements, essential missing information or unsupported operations block a valid result. The setting applies to the next AI request; explicit text/speech instructions can override it for a task. In VR, **Ask: HIGH / MED / LOW** cycles the setting from the headset menu. This setting controls human involvement independently of reasoning effort and Enable AI.

Every direct edit receives the current preference together with the drawing evidence. The model prompt applies object-level perpendicularity, parallelism, collinearity, mirrored or rotational symmetry, shared centres and equal repeated dimensions where supported, preserving explicit unequal dimensions, fractional angles, deliberate asymmetry and curved transitions. The numerical fitter is not forced to snap to these priors. Inferred relationships must be expressed in the returned geometry and explained briefly.

When the chosen policy calls for a question, the model returns a question with no edits. AI pauses, displays the question and waits for an actual answer. Use the answer box, saved text or speech; VR also exposes Type answer, Microphone and Stop AI. Answers continue the same run using fresh geometry and current supervision, and are retained through context checkpoints. Stop cancels a pending question. Automated moves and automatic drawing edits remain paused while an answer is pending.
