# Exact native regions and independent parts

`extract_region` copies an exact native region into a new body (or selected native faces into an independent surface). The original body's geometry, version, artifact and placement stay unchanged. `split_region` atomically publishes the source remainder and a separate extracted solid; native volume conservation and both outputs are checked before either replaces the visible scene. A missing/invalid secondary receipt rejects publication. Publication failures restore the original scene/history.

Both operations target an existing visible FreeCAD model at its expected version, with no tool bodies. Convert a mesh to CAD first. Parameters use the normal explicit native/part/world frame contract.

- `regionType:box`: `center`, positive `sizeMetres`, optional right-handed `axes`.
- `regionType:halfspace`: `pivot`, nonzero plane-normal `direction`, `regionSide:positive|negative`.
- `regionType:solids`: current one-based `solidIndices` from `metrics.solidRegions`.
- Extract only, `regionType:faces`: exact current one-based `faceIndices` (anchored across native replays).

Selectors are mutually exclusive. Empty selections, invalid solids and a split that leaves no source remainder fail without changing the source. Box/halfspace selectors perform exact OpenCASCADE intersections, not bounding-box meshes. A new part has a frozen input snapshot, its own editable extraction recipe/datum at its native bounds centre, and no assembly/coordinate parent. Moving the old body cannot move the new part. Later operations use its new model ID and refreshed topology.

Exact native edge/face bounds and solid-region bounds are returned for feature ownership and selection. The trusted-only `document.collaborationValidation={artifactId,bounds:{min,max}}` guard compares the current saved solid to the candidate through native symmetric Boolean difference. An operation that changes geometry outside its assigned native bounds is rejected and must be consolidated/replanned; unknown/non-solid influence is not accepted as independent. The guard is absent from the model response schema and runs only on collaboration commits. Its measured changed bounds appear in `verification.collaboration`.

Regression tests: `tests/native-region.test.mjs`, `native-region-worker.py`, `native-region-engine.mjs`, `native-region-browser.spec.js`. Real worker tests run in a disposable networkless container without credentials or production volumes. The engine test also verifies separate exported FCStd/BRep files and editing the new part through a checkpoint without accidentally re-importing the whole original body.
