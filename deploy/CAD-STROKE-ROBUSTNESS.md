# Complex CAD sketches and poor-stroke stress tests

Report: http://localhost:5173/benchmarks/cad-robustness-v2/index.html

This is a deliberately harder replacement for relying on the earlier simple-shape score. It covers 40 cases: four known analytic CAD profiles under nine stroke conditions, plus four built-in image_gen engineering sketches. The profiles are a six-bolt flange with bore, rounded slotted plate, dog-bone connecting link and stepped L bracket with a concave fillet. Profiles are authored as exact line/arc/circle geometry in millimetres before pen imperfections are added. They are 2D CAD profiles, not verified 3D solids or native 3D fillet features.

## Variability

Clean, wobbly, fragmented/gappy, retraced/messy, severe tremor with uneven sampling/dwell, large missing closing sections with overshoot, globally shuffled/reversed fragments with long pauses, stray marks, and omitted-hole negative controls. Frame origins and 3D plane orientations vary; the additional severe cases rotate the drawing within the plane as well. Up to 32 strokes are present. All corruption has repeatable seeds; these trajectories and timestamps are simulated, not real users. Labels/expected CAD geometry are never sent to the decision model. The default test prompt is generic; four explicitly guided gap tests are recorded separately and excluded from the unguided score.

Missing-hole controls expect only holes actually drawn. The full latent source design does not authorize creating an unseen extra hole. Generated images have manually checked component expectations but no exact dimensional truth.

## Stronger criteria

The report separately checks outline count, closed-loop count, hole containment, circular feature type, per-feature contour deviation at most 6% of that feature's diagonal, circle diameter error at most 5%, hole-center error at most 5% of its diameter, and local fillet/slot-arc error at most 20% of that arc's radius. Small fillet errors can fail even when whole-outline error looks small. A reference mark does not count as a filled boundary. Accidental-mark cases also check whether those known artificial marks were actually removed. Native drawing edit arguments must validate, but this alone does not establish valid 3D topology.

These stricter local-feature checks are applied to saved baseline outputs as well, explaining why the early coarse clean-case score differs from the report's regraded baseline. The data was inspected during development; retesting is not held-out human accuracy.

## Current findings (2026-11-04)

* 19/40 meet every defined check, versus 12/40 on the initial frozen outputs under the same stricter criteria.
* 26/40 preserve closed-outline/hole structure and valid editable drawing arguments.
* Clean CAD profiles: 4/4 pass. Mild wobble: 2/4. Fragmentation: 2/4. Messy retracing: 2/4. Generated engineering raster cases: 3/4.
* Severe tremor: 1/4. Large gaps/overshoot: 0/4. Shuffled fragments/long pauses: 2/4. Stray marks: 0/4. Omitted-hole controls: 3/4.

The program remains insufficiently robust for very poor artists. Main unresolved failures are lost closure or circularity, stray-mark classification, incomplete complex outlines, and small fillet fidelity. Guided gap prompts improve some structure but none of the four guided cases meets every dimensional/local-feature check; those results are not substituted into the unguided score.

Known Decisions inference spend for all recorded attempts: **$0.1822345**. 108 attempts were recorded: 88 returned a response, and one 20-attempt development batch failed at network fetch with unknown usage. Those errors remain in the report, not silently treated as successful calls or known-free inference. Generation, audio, CAD-agent and hosting costs are excluded. Current-stage provider-plus-fitting timings were often below two seconds, but they exclude the desktop's debounce, capture and render, and are not a guarantee of end-to-end latency. Earlier slower/cold calls are retained too. Replayed numerical fits preserve original request cost/timing with an explicit replay note rather than claiming another live model result.

## Harness changes exercised by the suite

* Numerical candidate chains allow the model to join shuffled fragments across long pen pauses. No chain is merged without its explicit Decisions choice.
* Nearby overlapping traces can be proposed as retraces. Interleaving/nesting evidence helps distinguish repeated noisy passes from separate walls. Approved retraces are aligned and averaged, preserving every source stroke ID. Nearby/concentric boundaries remain separate unless explicitly approved.
* Accidental/reference/geometry decisions let the model omit clear stray marks or preserve construction lines. Missing role answers retain geometry.
* Joined-group evidence and prompt guidance emphasize complete holes, repeated circular features, and retaining rounded corners.
* The decoder now honors an explicit closed decision instead of rejecting it through a fixed pen-gap threshold. Intentionally open outputs stay open when the model chooses open.
* Mixed profiles preserve adaptive measured points when asymmetric and use denser paired samples when symmetry is locked, improving fine-feature representation. Point-to-polyline distance evaluation was optimized without changing its geometric definition.

All of this is behind the separate Decisions sketch experiment. Automatic native publication still requires Accept. The ordinary measured-draft desktop route and VR implementation remain separate.

## Reproduce

```
python scripts/prepare-cad-robustness.py
python scripts/augment-cad-strokes.py
node scripts/evaluate-cad-robustness.mjs --execute --run=new-run
node scripts/summarize-cad-robustness.mjs
python scripts/report-cad-robustness.py
```

The evaluator makes paid API calls only with `--execute`. `--only=id1,id2` narrows the case list; `--guided` uses the explicitly labelled user-style instructions. Do not overwrite baseline filenames for new experiments. The summarizer's selected run names are explicit in its source; add a new run there when intentionally including it. Set SESSION_DIR to an ignored runtime directory and keep OPENAI_API_KEY in the backend environment. Optional Python analysis packages are in requirements-sketch-tests.txt. Source assets, seeds and exact image-generation prompt are in tests/fixtures/cad-robustness-v2. Frozen reports are in artifacts/cad-robustness-v2; public report assets are in public/benchmarks/cad-robustness-v2.

The report filters by condition/family/failure and overlays ideal truth versus raw ink versus fitted output. Try these strokes opens a fresh isolated experiment. Each case loads separately so the drawing page does not fetch the entire 40-case fixture bundle. The UI's exact request inspector, feedback and test export remain available.
