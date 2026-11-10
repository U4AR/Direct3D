# Stroke-first modeling

Normal mode is **Stroke by stroke**. Completing a stroke schedules deterministic geometry fitting in a browser worker; no model request occurs merely because the user draws. Raw points, timing, color, drawing POV and selected surface remain saved. A blue fitted reference overlays the original, with its measured RMS error. Approximate fits are orange. Controls allow original/fitted visibility, curve degree, tolerance and refitting the latest stroke.

## Local geometry

Input is ordered XYZ in world metres, Y up. Arc-length resampling reduces bias from hand speed. PCA supplies the local frame and dimensionality. Deterministic RANSAC and least-squares estimate lines and circles; bounded planar template alignment fits rectangles and regular polygons with 3 or 5–8 sides. A square is represented as a rectangle. Planar candidates are attempted for roughly planar closed strokes; a boundary fit must explain both the recorded path and the proposed boundary, so an open arc is not silently completed to a circle. Acceptance uses coverage, residuals, closure and scale-relative tolerance. These are geometric heuristics, not semantic classification.

When no primitive is adequately supported, an adaptive B-spline fit uses 6–24 control points and degree 1–7 (default cubic), robust residual weighting and a small curvature penalty. Open endpoints are constrained; sufficiently planar strokes can be projected into the PCA plane; non-planar strokes keep all three coordinates. Closed curves enforce closure and tangent continuity. The original samples, fitted coefficients/knots, sampled path and diagnostic errors remain available. Inadequate fits are marked approximate rather than called exact.

Non-planar inputs also try sphere/cylinder surface hypotheses. Cylinder axes are restricted to PCA candidates; this is not a general cylinder optimizer. A single curve does not establish a closed volume: the curve remains the default reference until the user's intent supports a surface or solid. We use RANSAC/PCA, least squares and bounded template optimization where appropriate; this implementation does not claim a general ICP solver or automatic recognition of every primitive.

## Prompt-driven edits

A typed or transcribed instruction starts the existing modeling agent. Its first context call includes the latest stroke's fitted geometry and three separate calibrated images from the recorded user POV: raw stroke; fitted geometry with the selected object(s), or all objects if none are selected; and the combined visible scene. Each frame has its layer label, camera matrices, source IDs and object versions. These are independent render cameras; the user camera and agent inspection camera are unchanged.

`stroke_reference` retrieves the same packet for explicit stroke IDs (up to 16). Curves retain world-unit size, orientation and position. `sculpt_tube` accepts `strokeId`, `useLocalFit: true`, `expectedFitVersion`, editor version and radius in metres to directly build along a saved fitted spatial path. It checks for stale fits and rejects fits beyond tolerance. Existing projection, CAD sketch/extrusion/revolve, surface/loft, fitting, transform and capture tools remain available. A fitted reference itself is not yet a CAD solid.

The model acts on the requested next feature, verifies it and stops; no routine clarification or regional planning is required. Complex whole-object design is a separate **Full object** mode, exposing the existing manual CAD/Sculpt editors, AI workflow and depth-to-mesh generation pipeline. No new third-party Meshy account or integration is implied.

## Backend and expiration

The modeling backend now calls Vertex `gemini-3.8-flash` with medium thinking, following the user's latest-Flash request. The initial replay tests below used the previously supplied `gemini-3.5-flash` endpoint. Secrets are in the PC's private env file, outside the repository and browser bundle. Gemini thought signatures, images, function IDs and tool results are preserved through multiple turns.

The temporary provider is allowed only before **2026-10-16 00:00 Asia/Kolkata** (2026-10-15 18:30 UTC). The guard executes on every provider call, including retries and delegated calls. An in-flight Gemini run stops if it crosses the deadline. New runs then use the existing OpenAI backend configuration. No request to the temporary model is started after the cutoff.

## Verification and artifacts

- `tests/stroke-fitting.test.mjs`: noisy, scaled and rotated line/circle/rectangle, regular pentagon, open/missing boundaries, 3D helix, seventh-degree spatial curve, malformed/degenerate inputs.
- `tests/agent-provider.test.mjs`: exact expiry boundary with no post-expiry network call, thought-signature/function-ID/image preservation, incomplete response handling.
- `tests/stroke-workflow.spec.js`: real browser drawing triggers local fitting without AI, persists geometry, toggles modes, produces three distinct calibrated layers without moving POV, and creates a tube from a saved fitted curve.
- Live recorded-pentagon replay: `dc283395-c333-45e0-9dfa-0db49d073cb1`, Gemini 3.5 Flash. Valid seven-face CAD solid with positive volume and STEP export support. Four tool calls, one API timeout/retry. Evidence: `artifacts/stroke-first/pentagon.png` and `pentagon-validation.json`.

These checks do not substitute for physical hand/controller feel or headset performance testing.

## Initial verification status (superseded by the end-to-end runs below)

The complete unit suite passed 107 checks before the additional watchdog regression (108 with it). The agent/broker suite passed 14 checks; the browser workflow test passed, including saved-fit tube creation. Production build passed. The Quest Browser was reloaded in its existing session and reported incremental mode and MCP connected; physical gesture feel and headset fitting latency have not been measured.

A second live Gemini replay (`e330a882-94b6-49a3-8a23-ceea0dcb43af`) used a spatial helix. It created a 4 mm radius tube directly from the saved 3D spline (2.39 mm sampled RMS fit error), after correcting an excessive extra-smoothing request. Google then returned HTTP 429 Resource exhausted on all retries, preventing completion of its visual review. Do not label this second run a fully reviewed success. No more paid retries were made. The local/browser tube test succeeded independently of API availability.

The replay harness now leaves the app page before seeding a fixture: this prevents the app's save-on-exit handler from overwriting the test data during reload. Existing user sessions were not replaced with test geometry.

## End-to-end verification on October 14, 2026

Both live Gemini 3.8 Flash / medium replays completed through the application's UI in isolated desktop browser sessions:

- Typed instruction → local 3D B-spline fit → Sculpt tube → scene and image verification → reviewed draft. Run `b0358c6d-c283-4fd6-b03d-00f650f43a7f`. Radius 4 mm; 3,086 vertices / 6,168 triangles, capped watertight topology, preserved endpoints. Fitting RMS 2.39 mm. 11 tool calls / 12 model turns; correct but still more inspection overhead than desirable for a simple operation.
- Synthetic microphone audio → local Silero VAD → real Gemini Flash-Lite transcription → automatic modeling-agent handoff → native CAD pentagon → verified draft. Run `879022c9-7324-4117-b5a9-bd6e82e381ea`. Thickness 5 mm, seven faces, positive volume 147,260.54 mm³, STEP exportable, no native diagnostics. Four tool calls / five model turns, including one combined fitting/creation call. Synthetic audio was used, not a physical wearer microphone test. The opening words were clipped while capture initialized; the complete shape, thickness and placement instruction was transcribed and acted on.

Results, screenshots, tool-rendered views and the synthetic input WAV are in `artifacts/stroke-first/e2e/`. Captured audio was also saved by the normal backend under `sessions/audio/500e60f4-63ad-4913-8eb5-6b7ae621db99/`.

The tests exposed and fixed Gemini 3.8 rejecting tool images sent beside function responses: images now live in `functionResponse.parts`, retaining IDs and thought signatures. Function calls use VALIDATED mode. Initial context now carries sparse labeled point previews and full fitted parameters rather than duplicate dense samples; exact points and fit paths remain accessible by tools. Rate-limit retries wait 30/60 seconds and report the delay. A further review bookkeeping fix retains source-stroke IDs for direct fitted tubes, enabling placement validation and source-stroke hiding after human acceptance.

Six browser tests passed for local fitting, saved-fit tube creation, separate image layers, speech routing, microphone recovery and automatic handoff. Unit/agent regression results are saved alongside the report. Actual Quest Browser connectivity was checked over USB: incremental mode, Gemini 3.8 Flash / medium, MCP connected. No physical hand/controller or wearer microphone test was performed in these runs. Real user sessions and cameras were preserved.

## Board and XR menu recovery

VR entry and tracking-origin resets recenter the workspace in front of the wearer through an offset XR reference space. Existing model/stroke coordinates and scale are unchanged. Both input and rendering use the same offset. A head-relative recovery strip provides Menu, Recenter board and Exit VR, and clicking a controller thumbstick also recovers the menu. Menu selection no longer uses the side-of-index drawing guard; actual active microgestures still suppress conflicting clicks.

Holding both open palms down, approximately coplanar and stationary for 1.4 seconds aligns the board top to their estimated contact plane and brings the menu into view. It requires valid joints for all four fingers on both hands, consistent normals/heights, continuous tracking, and release before retriggering. A progress indicator shows the hold. This infers contact from hand posture; it does not sense a physical table or use scene-depth contact detection. Stored geometry is not transformed or destructively changed.

Calibration and input tests cover moving/curled/missing/upward hands, dwell/release/tracking loss, reference transforms, menu recovery and menu pinch routing. The build and browser fitting/microphone checks passed; the updated app was reloaded in the existing Quest session. Actual wearer palm calibration still needs physical confirmation.

Hand-first interaction: Menu/Recenter/Exit now use larger targets with hover highlighting and point-and-pinch labels. The menu opens 65 cm in front of the wearer. Near-index-finger hovering and pinch selection work without a native target ray or hand gamepad; distant pointing still uses the native hand ray. Recovery controls stop following the head while targeted. Native select-event frames that cannot query viewer pose defer menu placement to the next animation frame. No controller shortcut is required. Thirty input/calibration checks and the browser stroke workflow pass; physical wearer confirmation remains separate.
