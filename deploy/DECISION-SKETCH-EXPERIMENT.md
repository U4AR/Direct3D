# Decisions-driven sketch experiment

Open `/desktop.html?experiment=decision`. This uses its own `draw3d-decision-lab` browser database, even if a main workspace `projectStore` is supplied. It does not edit the existing desktop session. Double-click the canvas to enable/disable the pen; middle-drag rotates, Ctrl-middle-drag pans, wheel zooms. Select a plane or face, or use the view plane. Draw and pause, optionally type or speak an instruction, inspect the preview, then Accept. Discard retains the original ink. Representation/closure/symmetry overrides are available for unfamiliar cases.

## Actual pipeline

1. Retain the original XYZ samples and each stroke's drawing plane/view.
2. Project to local UV. Only endpoint-near, time-near open strokes on the same plane can form a group; otherwise they remain separate components. This is a grouping heuristic, not semantic segmentation.
3. Calculate normalized geometric features and a clean PNG of the original planar ink. Include the viewport image, frame origin/basis, scale and pixel-to-UV map. No generated geometry is shown as evidence of user ink.
4. The backend calls **`POST https://api.openai.com/v1/decisions`**, model **`gpt-6-luna`**. A single request batches whole-drawing representation, per-group primitive/closure/symmetry and per-stroke choices. Clearly straight strokes skip extra individual classification; a single-stroke group's primitive answer is reused for that stroke.
5. Numerical line/circle/ellipse/rectangle/arc/profile solvers supply coordinates. Per-stroke choices route constituent strokes through different fitters. Fixed-correspondence least-squares projection imposes selected symmetry and supported edge alignments in the shape's own rotated frame. This is not a globally optimal shape/topology search. Automatic regularization exceeding 6% diagonal deviation falls back to a flexible measured profile, with a warning.
6. Render the result immediately as an uncommitted Three.js preview. Native CAD publication happens on Accept. Native publication has snapshot rollback through the existing draft review controls if it fails. Original ink is archived after successful publication.
7. Accepted sketches carry constraint metadata. `edit_decision_sketch` lets the CAD agent move/rotate/scale local frames and edit mirrored knots; validation enforces continuity, closure, straight segments and stored analytic/symmetry constraints. Arbitrary line direction changes through ordinary native dimension editing are not a full parametric constraint solver. New 3D modelling is still performed by the normal CAD agent/worker path.

There is **no local trained classifier** on this route and no Responses API fallback for representation decisions. Refusals retain a flexible measured profile and are reported. This experiment currently accepts planar ink, up to 32 active strokes / 40000 points. Nonplanar VR drawings are out of scope here.

## Records and supervision

The browser stores raw inputs, outputs, timings and human feedback as assets in the isolated database. Export test cases downloads them locally. The backend saves exact API bodies/responses under `SESSION_DIR/decision-sketches/<id>/`, with feedback in `feedback.jsonl`. The UI's Model input & output inspector fetches the exact body/response on demand, including input images. Public decisions/receipts are shown, not private model reasoning. Original/private recordings from old drives were not copied. Browser capabilities and allowed origins protect the new routes. An in-flight result is recorded for cost accounting but discarded from display if the user has added new ink; the latest strokes queue next.

Audio reuses OpenAI transcription before Decisions; transcription is a separate bill and is not included in the displayed decision cost.

## Cost and timing evidence (2026-11-04)

Official reference: https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability

USD per million tokens: uncached input $0.10, cache read $0.01, cache write $0.125; output $0. Rates are a dated estimate, not an invoice. The implementation uses returned usage counters, separates read/write tokens, and marks missing usage unknown rather than free. Token usage includes image processing. Regional/long-context premiums, hosting, audio, image generation and subsequent CAD-agent requests are outside this calculation.

The latest four synthetic image/feature checks produced rectangle, ellipse, rounded-end profile and open-U profile, taking 6.279 / 5.777 / 6.297 / 7.446 seconds respectively. Total cost $0.000468015, with cache hits on later calls. This tiny synthetic set is not a human accuracy benchmark. Symmetry recognition for the rounded-end/U cases remained `none`, so do not claim those constraints were recognized.

Two live isolated browser circle runs took 3.718 and 6.274 seconds to visible preview and cost $0.000321 and $0.000296575. Both tested native publication and explicit acceptance. The **two-second preview target remains unmet**. Fit computation is tens of milliseconds; provider/network time dominates these runs. Automatic preview adds an 800 ms quiet period after drawing. An earlier coordinate-only test misclassified a rough rectangle, motivating the planar ink image. One exploratory image request returned non-JSON upstream HTML; no geometry was changed and no automatic repair call was made.

For planning, using $0.00030/update: 30 updates/hour ≈ $0.009/hour; 120 ≈ $0.036/hour; 720 ≈ $0.216/hour. At 160 active hours/month: $1.44 / $5.76 / $34.56. Actual cost depends on strokes, images, questions and cache reuse. No inference requests run while idle.

## Run and verify

Configure `OPENAI_API_KEY` only in the backend environment. Run the existing bridge and webpage with the normal same-origin `/api` proxy. No new dependency is needed. Container deployments use the same backend modules; no USB/headset connection is required for this desktop route.

On this machine the bridge is on 18890 and the webpage on 5173. The I: development watcher stalled during testing, so `scripts/serve-desktop-test.mjs` serves the built `dist` with the same-origin API proxy. `DESKTOP_WEB_PORT=5173` selects that port; `DRAW3D_BACKEND_URL` selects the bridge. Default test-only binding is 127.0.0.1:5191. This does not start the separate FreeCAD/Blender workers.

Validation: 45 focused unit checks and six isolated browser checks passed, including live Decisions → preview → native editable geometry → acceptance, stale-result rejection, discard, native draft isolation and reload. No inspection/control of the user's localhost:5173 browser was performed. `scripts/test-decision-sketch-live.mjs` is an explicit paid synthetic API evaluation. Its report is `artifacts/decision-api-live.json`; private request bodies stay in ignored runtime storage. `tests/decision-sketch.spec.js` also contains one paid live circle test and one mocked transport race test.

Final verification: npm run build passed. The last two browser checks (including the exact input/output inspector) passed again; latest live circle visible preview was 4.920 seconds, API time 4.599 seconds, cost USD 0.00029545. The 45 focused unit checks also passed after the final geometry changes. Source view metadata is retained per stroke in the decision input.

## Diagnosing a desktop sketch-to-CAD regression

Follow one request from the recorded input to the committed document. A provider response, a displayed mesh, a verified intermediate feature, and a committed part are separate events.

| Stage | Evidence | Implementation |
| --- | --- | --- |
| Capture | Strokes, view and plane, speech intervals and target figure IDs | `src/speech-stroke-context.js`, `src/decision-sketch-lab.js` |
| Intent and fit | Requested output, local material changes, source IDs and fitted paths | `scripts/decision-sketch-api.mjs`, `scripts/sketch-instruction-intent.mjs` |
| Plan | Target-linked prior work, model output and validation or repair | `src/sketch-work-history.js`, `scripts/sketch-task.mjs`, `scripts/sketch-refinement.mjs` |
| Compile | Assignment of guide strokes to profiles and features, frame and extent | `scripts/sketch-feature-guides.mjs`, `scripts/sketch-feature-plan.mjs` |
| Execute and commit | Native feature receipts, volume change, rollback or acceptance | `src/desktop-direct.js`, `src/desktop-drawing.js`, `src/decision-sketch-lab.js` |

`npm test` includes the cross-stage contract tests. With the isolated desktop and bridge running, use `npm run test:workflow:browser` for speech, typed edits, cancellation and noise, and `npm run test:workflow:native` for the same circular input producing either a sketch or an editable bored spacer. The spacer test checks the remaining material against its analytic volume. Both browser suites use synthetic input and provider responses, and the native suite uses the application’s CAD engine.

Inspect host-local recordings with `npm run sketch:audit -- --root .runtime/decision-api/sessions --limit 30`. Filter with `--recording <id-prefix>`. Prompt text appears only with `--show-prompt`. Older recordings may lack an expected deliverable or final client receipt. A superseded request or a visible preview gives no evidence that a body was accepted.

To replay a recording that started in an empty document, set these PowerShell variables. The replay uses a fresh browser session. It compiles the archived provider plan with current code and checks the committed native features and volume. Add duplicate feature names when the operation is required twice.

```powershell
$env:DRAW3D_REPLAY_CASE = 'I:/Projects/Draw3d/.runtime/decision-api/sessions/decision-sketches/<case-id>'
$env:DRAW3D_EXPECT_FEATURES = 'revolve,join-material,join-material,pocket'
npm run sketch:replay -- --grep "recorded drawing"
```

For a 2D result set the expectation to `sketch`. For multiple recorded refinement attempts select `DRAW3D_REPLAY_REFINEMENT`. Use `DRAW3D_REPLAY_ORIGIN` to override the isolated test origin (default port 5191). Only set `DRAW3D_LIVE_REPLAY=1` when the input is authorized for transmission to the configured provider. Live mode resubmits the recorded drawing and transcription. Microphone capture and transcription are upstream of this replay. A dependent edit needs its starting document or its earlier steps reconstructed.

When a new report arrives, preserve its input and expected deliverable locally. Pair it with a nearby case where the correct outcome differs, and check the document after automatic acceptance. For a kernel failure, retain which feature last verified and the failing operands. The model’s construction instructions are in `agent-skills/build-from-sketches/SKILL.md`.

To exercise a spoken continuation following an older accepted sketch, set `DRAW3D_LIVE_FOLLOWUP` to the authorized utterance before running the recorded-drawing test. The initial recorded response is replayed locally. The new instruction and its target geometry go to the live provider and the test checks the final committed body. Clear the variable before an offline run.
