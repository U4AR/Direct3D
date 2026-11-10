# Measured desktop sketch refinement

Automatic desktop drawing cleanup starts with a harness-computed contour. It no longer asks the model to reproduce every coordinate from an image or fit label. Explicit typed redesigns and 3D CAD requests retain their broader authoring tools.

`src/desktop-measured-draft.js` projects planar ink into its recorded frame, samples by arc length, retains corners, and selects connected line, endpoint-constrained circular arc, or cubic spans by measured residual and complexity. Full circles are retained as primitives when supported. Gently aligned shared endpoints remain bounded by source deviation. Nonplanar body ink is excluded from this planar workflow.

`scripts/desktop-measured-tool.mjs` gives the model a versioned measured draft and prevalidated local choices. The model identifies the intended figure and selects useful `candidateId` values; it does not generate coordinates. The harness fits and evaluates each choice, preserves omitted segments, rejects overlaps/stale IDs, and checks the combined contour before publishing an editable preview. Large-deviation proposals retain the measured contour and produce explicit diagnostic feedback. Normal local edits have a maximum deviation budget of 1.5 times the fitted tolerance; listed whole-path circle/rectangle alternatives have a separately measured 6% diagonal bound. Regular primitive choices can also be offered for an endpoint gap up to 15% of the drawing diagonal, provided the full bidirectional contour error passes the primitive bound; this does not close the default faithful draft automatically. The model must select that alternative. These are geometric tolerances, not calibrated intent probabilities. They intentionally constrain automatic cleanup rather than explicit redesigns.

The input also includes an enlarged original-ink crop and a plane-aligned, segment-labelled draft image. Crop metadata maps pixels back to the original calibrated image; draft metadata supplies the UV-to-image transform. These images go only to the model/log, not to the human drawing UI. Original inputs remain unchanged in backend recording storage. The model receives compact coordinates and IDs, not raw point arrays.

Automatic cleanup offers only `refine_measured_sketch`, with direct-coordinate arrays capped at zero in the provider schema. Runtime finalization also retains the measured draft if a provider bypasses that contract. Explicit questions, voice commands, and necessary continuation/data requests remain separate. The existing preview/Accept/discard flow and VR workflow are preserved.

## Recorded regression, 2026-11-03

One recent angular, narrow-waist sketch was replayed against Luna low without applying to the user's scene. Its drawing diagonal is approximately 496 mm. The old free-coordinate response substituted five broad arcs and deviated up to 105.8 mm from the source. The final measured-draft route produced 14 editable native features with maximum deviation 3.28 mm.

| Input variant | Model time | Input tokens | Output tokens | Maximum contour deviation |
| --- | ---: | ---: | ---: | ---: |
| Earlier free-coordinate reconstruction | Not compared | 9,142 | 795 | 105.79 mm |
| Measured graph + validated choices, original images | 4.854 s | 8,061 | 124 | 3.85 mm |
| Same graph + enlarged ink and labelled draft | 5.589 s | 8,250 | 121 | 3.28 mm |

The second variant retained the distinctive angular contour and made no unnecessary candidate substitutions in this replay. These are individual observations, not a statistical claim that images always improve the model. Exploratory runs before restricting choices attempted invalid merges; the harness rejected them. The final interface exposes only already validated candidates.

Verification includes 53 unit checks and seven browser checks: original recorded geometry rendered and accepted in an isolated project, real automatic mouse drawing through Luna, exact circle regression, preview staging, discard, native model isolation, and reload recovery. The live automatic test took 12.585 s to finish all 15 editable features, with 2.09 mm maximum deviation and one model request. Model latency and native per-feature publication remain above the earlier two-second target.

Replay with `scripts/replay-desktop-intent.mjs <backend-request.json>` or stdin. It logs a new isolated model run and reports contour deviation and token usage without modifying the user's scene. `DRAW3D_DRAFT_IMAGES=0` disables the additional crop/labelled inputs for comparison. Keep original request data and credentials in existing protected backend volumes; do not copy them into the source workspace.

## Intent priors follow-up

The latest rectangular-looking drawing was described as freeform/asymmetric and had no rectangle choice because its endpoint gap was about 11% of its diagonal. `scripts/sketch-intent-priors.mjs` now reaches the actual compact desktop model route: infer reflection/rotational symmetry, parallel opposite sides, local horizontal/vertical alignment, perpendicular corners, equal repeated sizes/radii, and common angles when justified. Ordinary wobble, small corner softness, seams and tails are not automatically deliberate styling. Explicit fractional dimensions, real asymmetry and clear rounded features still win. Do not claim arbitrary symmetry was imposed by engineering alignment alone.

Regular primitive choices now admit bounded small closure errors as above. The initial contour and local-change tolerance are unchanged; this is an offered alternative, not a deterministic substitution. On two isolated replays of the rectangular-looking logged input, Luna chose to straighten the long lower edge and right end but retained some corner curvature. These tests demonstrate useful local corrections, not perfect rectangle recognition. 29 focused checks passed, including a rough rectangle with an accidental gap and a genuinely open U that must remain open.
