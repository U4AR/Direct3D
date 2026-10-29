# Draw3D spatial studio

Quest 3 WebXR prototype: draw with hands or controllers, describe the object, capture calibrated sketch depth, generate candidate object depths with Gemini, and inspect a reconstructed surface. The workflow intentionally stops at **surface review**, before finalization, color rendering, or Meshy.

## Run

Requires Node 20.17+ (or Node 22). From this directory:

```powershell
npm install
npm run dev
```

Open http://localhost:5173 on desktop. Drag to draw on the selected Z plane, change the plane to add depth, and use **Orbit** to inspect. **Load sample sketch** loads a real spatial stroke model for exercising the depth pipeline. It replaces the current drawing; historical strokes remain in the event log.

The active application lives at **`D:/Projects/Draw3d`**. Build dependencies and generated VAD/build assets use `D:/CodexBuild/Draw3d` through junctions; browser test temporary files use that D: directory too. A fresh checkout can use ordinary local directories. Server-side session archives default to `D:/Projects/Draw3d/sessions`. IndexedDB storage on a Quest remains on the headset itself; a desktop browser's storage location follows its profile.

## Quest 3

WebXR and microphone access require a secure context. Two development options:

1. **USB / ADB**: enable Quest developer mode and USB debugging, connect the headset, run `adb reverse tcp:5173 tcp:5173`, and open `http://localhost:5173` in Quest Browser. Keep the development server running on the PC. Localhost is a secure context.
2. **Trusted HTTPS**: obtain a certificate trusted by the headset for the PC's LAN address, set `HTTPS_KEY` and `HTTPS_CERT` environment variables to the certificate file paths, then run `npm run dev`. Open that HTTPS address on Quest. Plain HTTP at a LAN IP is insufficient. Accepting an untrusted certificate may not enable WebXR.

Click **Enter VR**. The session requests `local-floor` and optional `hand-tracking`.

- Hands: index/thumb distance below 22 mm begins a stroke; above 32 mm ends it. Strokes use the pinch midpoint in world metres. Tracking loss ends the stroke.
- Controllers: hold the primary trigger (WebXR gamepad button 0). Drawing uses the grip pose, with a default local tip offset of `[0, -0.11, 0.025]` metres. This approximates the controller bottom; select 9–15 cm in the desktop settings to tune it to the physical grip. The visible nib follows that offset.
- A world-space panel displays transcripts and buttons for undo, capture, reconstruction, and microphone. Point a controller/hand ray at a button, then trigger/pinch to activate it.
- Reconstructed geometry appears to the right of the sketch, with its bottom at the virtual review surface height. Original coordinates are retained in exported meshes; placement translation is recorded separately.

The input code targets Quest 3, but **physical headset hand/controller alignment, sustained frame rate, mic behavior, and thermal performance need on-device testing**. This implementation uses a virtual surface; it does not scan a real tabletop or access passthrough camera frames. Captured images are renders of the sketch.

## Speech

**Enable microphone** requests access and records audio locally. Silero VAD v5 runs on-device through ONNX Runtime WASM. Its model/worklet/WASM assets are served locally by `scripts/copy-vad.mjs`. There is no Whisper dependency or model download.

Transcription prefers `SpeechRecognition` / `webkitSpeechRecognition` when the browser exposes it. Native interim and final captions are displayed; an already-installed on-device English language pack is preferred when the browser can verify its availability. Otherwise platform recognition may use a network service. Quest system voice dictation and the native Meta Voice SDK do not guarantee access from WebXR; the implementation detects the actual browser API rather than relying on a user-agent string. Permission denials are surfaced, not bypassed.

When the browser API is absent, or its service fails without a permission denial, VAD speech segments are sent as mono PCM16 WAV to `/api/transcribe`. The server defaults to **`models/gemini-3.5-flash-lite`**, with minimal thinking and a 2,048-token output cap. This is a low-cost current model: as checked on 2026-10-07, standard audio input is $0.30 / million tokens and text output $2.50 / million tokens. Gemini 2.5 Flash-Lite has cheaper output but Google restricts access to prior users; `GEMINI_AUDIO_MODEL` can select it if the API key is eligible. See [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [availability guidance](https://ai.google.dev/gemini-api/docs/deprecations).

Nano Banana 2.1 does **not** list audio input support. The fallback therefore uses Flash-Lite to produce the transcript, then Nano Banana receives text plus sketch views. The same server-only `GEMINI_API_KEY` is used for both. Cloud transcription requires that key; until configured, raw audio remains local and pending speech can be retried by restarting the microphone in the same tab. Reload preserves audio assets, but not the in-memory upload queue. Each provider request is limited to 20 seconds of speech, and silence is filtered by local VAD.

Continuous microphone chunks preserve audio including silence; VAD speech segments are also saved as mono 16 kHz float32 PCM, with WAV copies for cloud requests. Stop the microphone before final session export. Typed descriptions remain available without microphone/API access. Native recognition currently requests English; the Gemini fallback preserves the spoken language.

## Gemini bridge — add the key later

Copy `.env.example` to `.env` and fill `GEMINI_API_KEY`. Do not put the key in a `VITE_*` environment variable or in the browser. In another terminal:

```powershell
npm run bridge
```

The Vite server proxies `/api/depth` to the loopback bridge on port 8788. The bridge uses the equivalent of the supplied Python Interactions call:

```python
client.interactions.create(
    model='models/gemini-nano-banana-2.1',
    input=calibrated_sketch_images_and_description,
    generation_config={'max_output_tokens': 32768, 'thinking_level': 'medium'},
    response_modalities=['image'],
)
```

The implementation calls the documented REST endpoint `https://generativelanguage.googleapis.com/v1/interactions`. Model name is configurable through `GEMINI_MODEL`. It reads image parts from `steps[type=model_output].content`. The supplied example's 65,536 output cap was reduced to the model's documented 32,768 maximum. Image-generation calls happen only when you click **Generate object depth**; enabled Gemini transcription sends VAD speech segments as they finish. Missing keys are reported explicitly; there is no fabricated model output.

For each target view, Gemini receives its sketch render, sparse measured depth preview, camera calibration, all other sketch views, and the accumulated description. One sequential call per target view encourages a known correspondence between output and camera. Raw requests, model input, responses, and failures are retained under `SESSION_DIR` (default `sessions/`, ignored by Git). Browser storage also keeps raw generated images, including images rejected during calibration. This sends those images and descriptions to Google; audio is sent separately only when Gemini fallback transcription is used. Headset pose logs are never sent to either model.

**Generation has not been exercised against the live API because no key was supplied.** The bridge transport, input construction, and missing-key behavior are testable without a key.

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

IndexedDB stores the active session; reload restores strokes, descriptions, and the latest depth assets. Persistent storage is requested where supported. **Export session** produces a ZIP containing:

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

References: [Three.js WebXRManager](https://threejs.org/docs/pages/WebXRManager.html), [Silero browser VAD](https://docs.vad.ricky0123.com/user-guide/browser/), [Transformers.js](https://huggingface.co/docs/transformers.js), [Gemini Interactions API](https://ai.google.dev/api/interactions-api-v1), [Nano Banana 2.1](https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1).
