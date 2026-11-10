# Generated-image fitting tests

Open http://localhost:5173/benchmarks/decision-images-v1/index.html to compare the source images, extracted paths and fitted geometry, and load a case into a fresh isolated experiment with **Try this sketch**. Loading does not call the model; Preview does. Each generated case uses a fresh session; the existing desktop project is not replaced.

## Assets and reproduction

The source sheet was made with the built-in image_gen tool, not a hand-authored vector substitute. It contains 12 sketches: circle, ellipse, rotated rectangle, rounded tab, L bracket, vase, open U, car with two independent wheels, keyhole, S curve, star and asymmetric leaf. Source image, per-case crops, extracted XYZ paths, mappings and the exact generation prompt are in `tests/fixtures/generated-sketches-v1/`. The underlying image model identifier/cost was not returned by the built-in tool; neither is invented here.

The generator prompt is `tests/fixtures/generated-sketches-v1/generation-prompt.txt`. Labels/expected classes/generation prompts are evaluator metadata and are never sent as decision-model instructions. The API receives unlabeled source ink, the cleaned planar ink image, normalized measurements and local/world frames, with the same generic refinement instruction for every case.

Optional image-analysis dependencies: `python -m pip install -r requirements-sketch-tests.txt`. They are not required by the production web/backend pipeline. Commands, from I:/Projects/Draw3d:

```
python scripts/extract-generated-sketches.py
node scripts/test-generated-sketches.mjs --execute
node scripts/audit-generated-sketches.mjs
python scripts/report-generated-sketches.py
node --test tests/generated-sketches.test.mjs tests/decision-sketch.test.mjs
```

The `--execute` command makes paid Decisions API calls using the backend environment key. Omit it to prepare cases without inference. Raw API bodies/responses are retained under the configured `SESSION_DIR/decision-sketches`. Set SESSION_DIR to an ignored runtime directory for development. `--only=case1,case2 --variant=name` writes a separate evaluation without replacing baseline results. `audit-generated-sketches.mjs` combines the documented baseline/reflection variants and performs offline contract/coordinate checks. It makes no model requests.

## What extraction means

Threshold dark ink, remove tiny isolated components, skeletonize, prune endpoint spurs shorter than six pixels, and trace graph chains/cycles. RDP thinning is bounded to 0.65 pixels and samples are densified at approximately two pixels. A fixed 0.5 mm/pixel plane scale is explicit. This recovered 14 paths across 12 images: one per image except the car's body and two wheels. U and S remain open; the other outlines are closed. The source/extraction overlay is saved so errors from tracing can be distinguished from fitting.

**A raster image cannot recover original pen timing, direction or stroke order.** These are simulated paths with explicit synthetic timestamps. Crossings/overtracing would need separate ambiguity handling; this first sheet does not establish performance there. Tiny spur pruning and shape labels were checked against the generated source, not inferred as ground truth from the fitting model.

## Results and limitations

Baseline: 12 API attempts, 11 completed, one upstream HTTP 504. All completed cases met component/type/closure/contour checks, but the U and star lacked expected reflection symmetry. Measured candidate-axis evidence and a clearer reflection question were then added to the generic harness. Rounded-tab/U/star were retested; U encountered another 504 and was explicitly retried once. All original attempts/errors remain in `artifacts/generated-sketches-v1/` and the public report's originalRuns. This is **development evaluation after inspecting failures**, not a fresh holdout or a human-drawing accuracy estimate.

Latest usable outputs: 12/12 meet the defined geometry/native-edit-contract/rigid-frame checks; expected symmetry 9/9. Native contract audit also verifies stored symmetry/closure/straight-segment metadata. Maximum contour error ranges from 0.32% to 3.43% of bounding diagonal (6% test budget). This threshold is a coarse geometric criterion, not proof of design quality. The car remains three components. Numerical translation/rotation of the whole drawing plane preserves output world placement within 1 µm when replaying the same decisions.

16 total API attempts, 14 completed. Known Decisions cost: **$0.00399305**; the two upstream 504 attempts have unknown usage. Image generation, audio, CAD-agent calls and hosting are excluded. Completed latest case times were **3.73–7.26 seconds**; the two-second target remains unmet. Mean known inference cost per completed call was about $0.000285, implying about $0.034/hour or $5.48/160-hour month at 120 similar calls/hour; cache behavior and larger drawings change this.

`tests/generated-sketches.test.mjs` replays all 12 saved decision sets with no API calls. Native edit contracts/constraint metadata are checked for all cases; actual CAD kernel publication is not established by that audit alone. The browser test separately loads the generated car through the report and checks its three editable accepted figures (including two circles) using saved decisions and current coordinates, without another paid request.

The web app now receives each stroke's recorded drawing view as well as its plane and current viewport. The numerical mirror candidate is only evidence for the model; it does not force symmetry in deterministic code. No hard-coded car/star/U classifier was added.
