# Project handoff

## Run the workspace

The active Windows checkout is `I:/Projects/Draw3d`. From the repository root run `node scripts/handoff.mjs` for a readiness check. `npm run handoff -- --test` also runs the default regression suite. With dependencies and the CAD bundle available, run `npm run build`, configure the server-side provider credentials, then `npm run handoff -- --serve`. The foreground server serves the compiled site and API from the same origin. Set `BRIDGE_PORT` to choose a different port. The default is 8788. An already-running instance can be checked at `/api/health`.

For a new machine run `npm ci`. If the native assets are missing, follow the CAD setup and bundle instructions in the root README before building. Server deployment and HTTPS for remote microphone and Quest access are documented in [the deployment guide](../deploy/README.md). The workspace checker does not export credentials or recordings. Browser IndexedDB and backend recordings are separate stores.

## How a desktop edit works

| Stage | Main files | Result |
| --- | --- | --- |
| Draw and speak | `src/desktop.js`, `src/speech.js`, `src/speech-stroke-context.js` | Stroke IDs, original view and plane, audio and transcript |
| Interpret | `scripts/decision-sketch-api.mjs`, `src/decision-sketch/` | Decisions plus numerical fitting into editable geometry |
| Choose the deliverable | `src/decision-sketch-lab.js`, `scripts/sketch-refinement.mjs`, `scripts/sketch-task.mjs` | A sketch by default. Create 3D supplies authorization for a body or material change |
| Execute | `src/desktop-direct.js`, `src/desktop-drawing.js` | Native feature execution, checked geometry, rollback and repair feedback |
| Review and modify | `src/part-workspace.js`, `src/part-chat.js`, `src/desktop-history.js` | Body or sketch selection, original inputs, model replies and undoable design state |

Web scene coordinates use meters; the native CAD document declares its own units. Plane-local axes and the capture camera travel with the drawing. Native bodies have stable IDs. Use those IDs for transforms and verify the published body after a kernel operation. The numerical fit supplies a reference and the construction instructions live in `agent-skills/build-from-sketches/SKILL.md`.

## Verify changes

Use `npm test` for default and cross-stage contracts. The isolated browser origin is normally port 5191. Use `npm run test:workflow:browser` and `npm run test:workflow:native` for browser and native geometry checks. A mock response can test the compiler; testing intent additionally needs a provider replay. The [recorded workflow guide](../deploy/DECISION-SKETCH-EXPERIMENT.md#diagnosing-a-desktop-sketch-to-cad-regression) describes session selection and stage receipts. Set `DRAW3D_MANUAL_BUILD=1` in a live recording replay to check sketch acceptance first, click Create 3D, and inspect the committed body. For usage see [the desktop guide](DESKTOP-WORKSPACE.md).
