---
name: native-cad-collaboration
description: Build and edit native CAD from VR sketches and speech using measured geometry, independent parts, bounded feature ownership and kernel feedback. Use for Draw3D's native modeling harness.
---

# Native CAD collaboration

Use the user's newest words, intended sketch and speech-focus images to identify the requested result. Selection is a reference, not permission to join bodies. Explicit edits to an existing part override a generic intent summary left by older ink.

## Decide what is being edited

- `drawingIntent.mode:independent-part` means current free-space ink belongs to a new part. For its native creation use `modelId:null`, `coordinateReference:null`, `combineWithSurface:false`. Preserve existing bodies. Do not extend the last body merely because it was selected or fitted earlier.
- An explicit surface-feature intent identifies its target body and plane. Use that body datum and the requested additive/subtractive operation. Do not silently turn a new separate object into an attachment.
- To modify an existing part, identify its actual visible model ID/version and current native features. `speechFocus` and the paired `speech-focus`/`speech-focus-ink` images show the user's dominant facing direction during the utterance. These are user POV evidence; fixed native views are geometry inspection views. Do not confuse either with the other's coordinates.

## Make useful native geometry directly

Rough-fit classes are spatial references for scale, position, orientation and candidate regularity, not a command to reproduce their shape. Prefer simple intended geometry when supported. Preserve deliberate curves, asymmetry and explicit dimensions. Use symmetry, equal sizes, parallel/perpendicular directions and sensible round dimensions when the sketch supports them; do not force them against user intent.

Choose a short native construction. `create_pipe` makes a round solid on a 3D B-spline in one action with `points3D` and `radiusMetres`; its center/axes define the points' local frame. A custom section uses a sketch plus sweep. Standard rounded rectangles/ellipses avoid manual arc arithmetic. Use actual curved sketch segments for mixed straight/rounded outlines. Loft/sweep can produce open surfaces with `solid:false`. Never report a wire or surface as a solid.

Native parameters use Y-up metres. Existing edits default to their native geometry frame; `parameterFrame:part` uses the target part's supplied datum. The harness converts once. Human moves/rotations do not change feature dimensions or native locations. Use world parameters for deliberate assembly placement. Copy exact measured locations/IDs instead of estimating pixel coordinates. `metrics.faces[].analytic` and `metrics.edges[].analytic` provide exact native surface/curve centers, unit axes, radii and trimmed axial spans; use them before reconstructing dimensions from old feature parameters. An axial span is relative to its analytic center along its unit axis. `boundaryRole` distinguishes an exterior from a cavity only when the kernel verified it; missing role is unknown, not permission to guess. E/F image labels belong to the named current model version and artifact; refresh or inspect after topology changes.

## Extract a region as a real independent part

`extract_region` copies source geometry without removing it. `split_region` atomically produces the source remainder and a new independent part; it does not temporarily delete the source. Use `regionType:box` with center/sizeMetres/optional axes, `halfspace` with pivot/direction/regionSide, or `solids` with measured solidIndices. `extract_region` also supports selected faces as a surface. A face extract is not a capped solid. Inspect the returned independent part ID, its own datum and both native validity receipts. Continue editing that new ID. Construction provenance is not an assembly mate.

## Collaborate without colliding

Delegate only useful independent work. Two specialists may work on different native regions/features of the SAME part. Supply `regions:[{modelId,bounds:{min,max}}]` in native coordinates when known. Actual proposed operations, dependencies and geometric influence determine interference; a declared non-overlap alone is insufficient.

The harness withholds overlapping or uncertain proposals, sends interference feedback, revokes duplicate ownership and hands all coupled tasks/proposals to one owner. Preserve all original task requirements when taking over. Other specialists must relinquish writes and report constraints rather than apply competing changes.

For coupled changes to the same body, propose the next mutation and request continuation; inspect its actual result before proposing the dependent mutation. This keeps subsequent topology and ownership current.

Checked proposals carry `proposalId`. Commit by copying it and the proposed operation/parameters; the harness refreshes versions and maps topology anchors. Do not bypass a blocked proposal by deleting its ID or changing its dimensions. Disjoint commits are serialized and the native kernel checks actual changed geometry against the claimed region. If topology or another body changed unexpectedly, reconcile ownership against fresh evidence rather than guessing IDs.

Use `continue_feature_work` to return the actual execution result to the same specialist for its next feature step. A native rejection is feedback to revise the plan. Do not start another independent specialist over a blocked reservation; let the harness transfer the coupled work to one owner.

## Finish from measured feedback

A valid solid alone does not prove mechanical intent. For external threads, inspect the current neck radius and axial span; the crest must protrude beyond the exterior while the root engages the wall. Thread height is the helical centerline span; the triangular swept profile extends by `0.32 * pitchMetres` beyond each end. Include that end clearance inside the measured support span, rather than merely placing the centerline inside the lip. Match cap clearance, pitch and handedness deliberately. A ridge inside a hollow neck is not a successful external thread. Compare measured geometry and refreshed views before claiming engagement.

A proposed action is not an applied edit. Check native execution receipts and refreshed images. On rejection, use the exact failure, selected geometry and unchanged-body feedback; correct the cause within the user's scope. A failed fillet can justify a better curved construction for a smooth grip; it does not authorize changing unrelated parts. Unknown network execution is not permission to repeat a mutation. Ask the user only for consequential missing intent or a genuine unresolved blocker, following their supervision preference. Stop when the requested result is verified; omit unrelated refinements.
