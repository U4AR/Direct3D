# Drawing recognition and CAD drafts

The local fitter now runs before AI interpretation in the spatial workflow. Desktop strokes receive the same confidence/regularization analysis and nearby-object feature evidence. It uses geometric rules and scored hypothesis search; it is not a pretrained semantic classifier.

## Pipeline

1. Retain raw XYZ samples, timestamps, original POV, stroke roles and object attachments. Detect isolated tracking spikes, record their reduced reliability, and resample by arc length so pauses/dense samples do not dominate.
2. Approximate each gesture with connected lines and fitted cubic B-splines. Preserve corners and genuine curved portions. Small deviations can snap to the reference object's axes and 45-degree diagonals, within an error budget; an intentional 12.5-degree line remains oblique.
3. Build a junction graph and report parallelism, perpendicularity and similar lengths. Solid candidates use these line directions as orientation seeds. Regularity priors favor simpler regular shapes when measured fit is comparable.
4. Compare cuboids, spheres/spheroids, ellipsoids, cylinders, circles/ellipses, line/polygon profiles, matching-profile extrusions, coaxial revolutions, measured circular sweeps, curves and spline surfaces. Scores include weighted robust residual, complexity, unexplained strokes and observed open topology. Default corner:edge:surface priorities are 8:4:1, normalized within each class. A subset spline cannot win merely by ignoring the rest of the drawing. A bounded surface with interior guides is not treated as a closed solid.
5. Send the AI original images/strokes plus compact regularization, candidate parameters/errors, ambiguity, native recipes, object frames and contextual features. Well-supported geometry can be reused unchanged. Explicit user instructions and original geometry remain authoritative.

A spatial spiral proposes a cylinder envelope while retaining a spline alternative. A separate circular cross-section can establish a tube sweep and its radius. A lone outline does not invent extrusion depth. Matching closed polygon profiles determine extrusion depth; varying coaxial circles determine a piecewise turned profile. Spline surface patches remain open surfaces.

## Native CAD and previews

Fitting and previews happen locally without a model request. **Keep fitted CAD** builds native FreeCAD boxes, spheres, cylinders, circle sketches and regularized rectangle sketches. Matching polygon profiles create an actual sketch and extrusion; coaxial profiles create an actual sketch and revolution. Native features and dimensions stay editable. Other recognized surfaces/curves/ellipsoids/sweeps can be kept as editable parameterized spatial geometry; they are not falsely described as native parametric BReps. Native conversion and AI modeling tools remain available.

New strokes automatically select the current best classification. A user-chosen alternative is retained only for the same drawing. Keeping an unchanged draft twice reuses its existing body. AI receives the kept model ID so it can refine that body instead of duplicating it.

## Nearby geometry

Planar native faces (and bounded mesh-box supports) are transformed into the drawing's world frame. A curved stroke tangent to two nearby perpendicular faces proposes a fillet radius and surface preview. Exact shared native edge IDs are used only when supplied by the current BRep. The suggested radius is converted to the body's native frame for scaled instances. Separate solids are explicitly marked as needing union and fresh topology first. A hypothesis does not apply a destructive feature automatically.

## Record demonstrations

Open **Creation workflow → Teach drawing examples · record & replay**. Choose the intended shape, optionally name/explain it, then **Record example**. Draw normally and choose **Save example**. The VR tool panel also has **Record example / Save example**. Voice controls support “start recording drawing” and “save drawing example” through the existing direct-audio model path or exact transcript interface commands.

Only new gestures are captured. Recording saves raw points, point times, views, attachments and nearby object context, and can recover after reload. Automatic drawing-triggered AI edits wait while an example is being recorded; explicit user requests remain available. Saving does not train a model automatically.

Use **Replay fit** to run the current fitter on a separate overlay without changing the design. Export/import labelled JSON examples. To replay a dataset outside the UI:

```powershell
npm run drawing:replay -- examples.json report.json
npm run test:drawing
```

The CLI returns a failing exit code for labelled mismatches, making demonstrations usable as regression fixtures. Complete geometry, scores and alternatives remain in the saved report; model packets omit verbose per-sample arrays to limit latency/context size.

## Validation and limits

The synthetic corpus in `artifacts/drawing-fit-synthetic-corpus.json` covers box edges, sphere loops, cylinder rims, a spiral, a triangular extrusion, a varying-radius revolution, a curved sheet and an inside-corner fillet. `artifacts/drawing-fit-benchmark-report.json` records measurements and timings. These fixtures do not establish an accuracy percentage for real people. Complex assemblies, incomplete observations and ambiguous sweeps still need image/voice context and AI refinement. Human demonstrations should expand the replay corpus before claiming that most real drawings require no correction.
