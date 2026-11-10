# Modeling harness evaluation

The model receives annotated current native views: E<n> identifies edgeIndices, F<n> faceIndices, scoped to the exact model ID/version/artifact. Visible labels are bounded, occlusion checked, and refreshed after changes. `inspect_topology` queries measured edge/face IDs or nearest native-space features. A label is not a stable name across topology changes.

`delegate_parts` starts at most two concurrent proposal-only specialists, four total per run. `DRAW3D_SPECIALIST_MODEL` optionally selects their model; default is the parent model at low reasoning. Specialists receive the original goal and current evidence, may propose native operations for assigned parts, cannot delegate or consume unowned parts, and never mutate the scene. Parent reconciles overlapping aspects, applies one native operation at a time and checks measured/visual feedback. This deliberately prevents two agents from silently overwriting one solid.

The inspector's **Export replay / evaluation task** downloads exact model requests, drawings, native receipts, errors, timings, specialist requests/results and a descriptive baseline. Native artifact/recipe IDs identify fixtures to copy into an isolated worker volume. Baseline success is not human acceptance: `humanAccepted:null` remains until reviewed.

A proposal-only evaluator supports tool ablations without touching the user's scene:

```
node scripts/evaluate-harness.mjs task.json
node scripts/evaluate-harness.mjs task.json --execute --model=gpt-6-luna --thinking=low --without-delegation --out=artifacts/luna-baseline.json
node scripts/evaluate-harness.mjs task.json --execute --without-native-views --out=artifacts/no-topology-views.json
```

Default is a dry run. API replay requires the existing backend key environment/file; credentials are not embedded in task exports. `--execute` sends up to three saved input turns and captures fresh model proposals, not native mutations. Follow with isolated native replay plus human/geometry checks; a correct schema or valid solid alone does not measure the user's design goal.

For comparisons keep the drawing, prompt, native fixtures and model constant. Record edge/face selection accuracy, kernel rejection rate, frame/placement correctness, turn/call count, first visible output, total latency and human design preference. Paired repeated trials are needed for claims about speed or smaller model reliability.

The initial four-call GPT-6 Luna low probe is in `artifacts/topology-ablation/`: two synthetic edge-selection tasks, each clean and labelled. Clean was correct1/2; labelled2/2. Mean times8.49s and8.63s respectively. This small sample suggests selection benefit; it does not demonstrate speed improvement or general task accuracy.

VR CPU diagnostics are exposed by `studio.runtimePerformance.report()` and its export control. Saving, evidence capture, model latency and native operation latency are distinct stages. Headset browser timing while XR frames are paused is not a headset FPS measurement.

See CAD-TOOL-COVERAGE.md for real supported and still unsupported feature families. Structured commands do not grant arbitrary Python execution or claim full SolidWorks parity.


Operation schemas now bind the native action and its exact parameter family in a single JSON Schema branch. Six separate sketch encodings require the selected geometric input (circle radius, points, curved segments or a specific standard profile). A create_sketch response cannot choose the helix parameter branch. Prior feature edits bind the model ID and feature index to that feature's supported parameters. This closes the observed handle failure where the old independent parameter union returned center/pitch fields without any profile.

Read-only tool results use real Responses function-call/output pairs. In a single GPT-6 Luna low native-edge trial this reduced the observed six-turn sequence to four turns; both made the requested valid fillet, and the revised sequence did not repeat pre-edit topology queries. This is diagnostic evidence, not a speed guarantee. A separate Luna low trial created and extruded an analytic rounded rectangle successfully through the browser/native pipeline in four turns with no application errors. Full raw calls/receipts remain in the isolated test recording volume.


The current bottle handle is now a recorded real task: `5a6ae9f1-0909-4f1f-a6f1-0d80f4180292` in the user's original recording. It completed eleven moves, including two confirmed fillet rejections. Feedback led the model to replace the grip with a true circular profile swept on a 3D B-spline and to replace the existing handle union input. Final bottle and unchanged cap are valid single solids. The initial run used thirteen API calls including validation repair:147.9s provider elapsed, so it is a useful optimization baseline rather than a fast-task claim. Native successful stages ranged4ms to7.6s. The new generic pipe shortcut is intended to reduce separate guide/profile/sweep setup moves.

Transport errors are distinct from CAD errors. DNS ENOTFOUND/EAI_AGAIN and connection codes now retain their network cause and retryability. A duplicate request can restart only a failed, transient provider attempt with no proposed edit; it cannot replay an applied native operation or an explicit Stop. Invalid read-only tool arguments receive bounded error feedback, current IDs and continuation for correction rather than terminating the task immediately.
