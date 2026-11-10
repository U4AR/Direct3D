# Terra concept edition

This is a separate web edition; existing Meta/Gemini deployment is unchanged.

## Flow

Open `/concepts.html`. Draw in 3D with hands/controllers, then speak (or type) what you want. Local preview remains visible. After the speech pause, the backend transcribes the saved WAV with `gpt-transcribe`. Three parallel `gpt-image-2.5-flare` edits at low draft quality receive the front/top/right drawing views and matching scene views, plus the transcript and world-space size reference. Each makes a distinct plausible interpretation, not three views of an already chosen design.

Three cards appear side by side on a world-anchored VR board and in the webpage. Select with point/pinch or controller trigger, or say “choose two”. Selection highlights the card; it does not create geometry. Then say “confirm” or activate **Confirm & build**. Say “regenerate” for more alternatives, or describe a correction to regenerate with that constraint. Cancel/Stop preserves the sketch.

The confirmed image, original drawing views, world coordinates, component fits, transcript, native operation catalog and current scene are given to `gpt-6.1-terra` with `reasoning.effort: medium` on every modeling move. It creates editable FreeCAD/Blender objects and receives native errors/result images for subsequent corrections. Further moves are model-requested. Follow-up modifications without new ink edit the current object directly. New ink requires another confirmed concept. Automatic sketch-only AI calls wait for a description in this edition.

Confirmation is checked on the backend and bound to the browser capability, instruction, original stroke points and body placements. A changed drawing requires regeneration. Selected concept images and choice metadata are saved in session assets/history. API keys stay in backend Docker secrets.

## Internet deployment (no USB or desktop process required)

Use a Linux server with Docker Compose, a public DNS name, and ports 80/443 reachable. Copy the project excluding `.secrets`, `.env*`, `.runtime`, `.build`, node_modules and private sessions; provision credentials directly on the server. Use Docker Compose 2.24.4 or later. Create `.secrets/openai_api_key` and `.secrets/modeling_token`; do not commit them. Docker builds both native engines and the web assets. No local Blender/FreeCAD/ADB installation is used.

Create a private `.env` file:

```dotenv
DRAW3D_DOMAIN=cad.example.com
DRAW3D_AGENT_ORIGINS=https://cad.example.com
DRAW3D_AUTH_HASH=<bcrypt hash from caddy hash-password>
DRAW3D_PORT=18889
```

```sh
docker compose -p draw3d-terra -f compose.yaml -f deploy/compose.terra.yaml --profile https up -d --build
```

Visit `https://cad.example.com/concepts.html` in Quest Browser or any supported desktop browser and log in as `designer` using the password corresponding to the configured Caddy hash. Caddy obtains HTTPS certificates. Microphone and WebXR require a secure origin. All browser API requests use the same origin; browser capabilities use a separate header to preserve the HTTPS gateway login; native workers communicate over the private container network. The domain/origin must match exactly. Do not expose worker ports. USB reverse forwarding is optional local testing only, not part of this deployment.

Local isolated test URL: `http://localhost:18889/concepts.html` (localhost secure-context exception). Container DNS can reach OpenAI even when this Windows host's DNS resolver cannot. Image generation latency and available API limits depend on the OpenAI account; no fallback silently substitutes another model.

## Models and official references

- Modeling: https://developers.openai.com/api/docs/models/gpt-6.1-terra
- Candidate images: https://developers.openai.com/api/docs/guides/image-generation (Flare, low quality for drafts)
- Transcription: https://developers.openai.com/api/docs/guides/transcription

No license circumvention is used. Existing open-source CAD workers and their notices remain included; paid OpenAI API usage is subject to the account's billing and model access.

## Validation on 2026-10-30

Real OpenAI pipeline, with synthetic recorded speech and three synthetic 3D strokes, passed through an HTTPS Caddy gateway with login. Three concept images were ready in 8.6–9.9 seconds. Selecting an image created no bodies. Explicit confirmation produced two wheels and a straight axle as three separate valid one-solid FreeCAD bodies, then a final inspection. Four Terra medium calls took about 6.1–7.2 seconds each (public operation labels for construction appeared after about 2.4–3.3 seconds). Total test duration was 49.1 seconds including webpage setup and capture. No browser errors. This was not a physical hand/controller test. Measurements are not latency guarantees.

The HTTP production-container check also passed secret/source isolation, native worker health, actual CAD boolean creation and STEP/STL export. Browser picker tests covered ray targets, selection vs confirmation, cancellation/regeneration and fixed world placement. Validation summaries and screenshots are in `artifacts/terra-concepts-validation.json`, `artifacts/terra-three-concepts.png` and `artifacts/terra-confirmed-cad.png`.

## AI visualization tool, selection and hands

Terra can call the real Responses function `generate_design_visualizations({reason,prompt})` when a significant visible design change needs confirmation. This captures the entire current CAD scene (overview/front/top/right) plus original drawing views, not just a close crop of the new stroke or selected face. It generates three alternatives, waits without a two-minute apply timeout, and sends the chosen image and a tool-result receipt into the same modeling goal. No geometry changes while the review is pending. Cancellation preserves current geometry. Minor changes can proceed directly. The initial sketch still gets its first concept review; later changes are model-directed.

Hands have explicit roles: Draw hand defaults to right; Grab hand defaults to left. The Draw hand setting swaps both roles. Grab-hand pinch/trigger: once body, twice face, three times edge in the same region. Lock Edges/Faces in the native menu to toggle individual selections and select multiple faces/edges. Draw-hand Pen stays active during VR geometry selection. Grab-hand fist or controller lower grip inside a body moves and rotates that exact body; its coordinate parent is no longer substituted as the grab target. Geometric containment and view-based drawing guards remain enabled. Speech start/end selection references include model ID/version, native face/edge IDs and selected point, so the AI can interpret “this face” from current evidence.

Click/select a body for dimension labels. In VR their text uses a stable angular size independent of the body's scale and sits beside its silhouette with faint leaders. Only the current body is annotated by default; All bodies remains optional. Revolved bottle profiles show full diameter rather than half-width/radius, and wall thickness stays visible. Existing double-click dimension editing is retained.

Bottle log diagnosis: run `bfedf692-f84b-4198-8b6e-5c5a3f2c7ed3` created the cap and body with distinct native IDs. Later run `94fe7b43-301e-49c0-9e19-160959c4a007` finished with exactly two visible one-solid bodies: body+handle and cap+latch. The cap retained a coordinate reference to the body. The old grab routine walked that reference to the parent, so a cap grab moved the bottle; this was an interaction bug, not a failed FreeCAD split. Separate bodies can now be grabbed independently. Their stable design-frame relationship remains available to the AI.

## Hollow-body grabbing and display colors

Separate native bodies now receive contrasting persistent display colors (the saved bottle body is blue; the cap orange). Display colors identify CAD parts and do not change native geometry. Desktop result focus preserves body color differences instead of turning every non-focused body the same gray.

Grab containment now includes the interior volume of known shelled/solidified/subtracted vessels. The underlying material-only geometry test remains unchanged. A cavity must have enclosing wall support on all three axes and opposed walls on at least two; ordinary through-holes and empty bounding-box corners remain excluded in regression tests. Closing a fist/grip outside and moving into a body retries acquisition; ray-hovering a distant UI panel alone does not block a local body grab. Real UI select presses retain priority.

Validated with 105 unit checks, three browser checks including actual FreeCAD hollow shells and saved color restoration, and non-mutating probes in the original headset bottle scene. Both saved body and cap cavity probes resolve to their own IDs. Physical hand motion has not been observed. See `artifacts/hollow-grab-validation.json`.


Native action harness (October 30):
- New FreeCAD edits load the exact prior native checkpoint rather than rebuilding old topology first. Edge/face selections carry geometric anchors; a rebuild resolves those anchors uniquely or rejects without replacing scene geometry. Numeric topology IDs alone are not persistent identities.
- Native responses include an input-document SHA-256 digest, actual operation parameters, requested/resolved selection, native status and measured geometry effects. The browser checks the digest, operation and validity before replacing a scene mesh. The next AI move receives the receipt and fresh views.
- `parameterFrame` supports native/part/world; each body exposes its stable creation datum. `focus_part` switches the AI's inspection target, while `transform_body` moves/assembles instances in world space. `remove_feature` and `edit_modifier` retain editable recipes.
- Analytic line/arc/B-spline sketch segments, real helical `thread` and `create_helix` operations are exposed to the model. Internal/external threads use explicit pitch, depth, nominal root and clearance; dimensions remain editable.
- Freeform questions accept voice/text directly, with no action buttons. `questionOptions` supplies 2–4 buttons only for actual option selections. Transcribed answers release the transcription flag before resuming and persist an answer checkpoint.
- `/inspector.html?recording=<session UUID>` is a separate authenticated chat-style viewer. It shows saved exact wire requests (for new OpenAI calls), raw responses, images and application receipts. Earlier calls are accurately labeled as saved pre-transport requests. API credentials are redacted; capability checks scope runs to the requested recording. Same HTTPS/login origin as the app.
