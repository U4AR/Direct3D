# Native analytic geometry in model evidence

FreeCAD `metrics.faces[*].analytic` and `metrics.edges[*].analytic` describe the exact BRep support surface/curve, never a fitted preview mesh. Existing compact evidence retains these small objects and removes edge polylines.

All points are stable **native metres, Y-up**. `axis`/`direction` are unit vectors in that frame. The axis can point either way; use its reported sign. `center` is the analytic surface origin (or exact circle/sphere/torus centre), and may differ from the face area centroid already reported as the outer `center` field.

- Cylinder / circle / sphere: `radiusMetres`, `center`, `axis`.
- Cone: reference-plane `radiusMetres`, `center`, `axis`, signed `semiAngleRad`, and `apex`. `radialRangeMetres` reports the minimum/maximum radius over its trimmed axial extent.
- Torus: `majorRadiusMetres`, `minorRadiusMetres`, `center`, `axis`.
- Line: exact `origin` at the trimmed edge start and `direction`.
- Faces: `axialRangeMetres:{min,max}` is the trimmed BRep extent **relative to center, measured along axis**. A world-native point on the axis is `center + axis * distance`. Rigid alignment plus OCC optimal bounds use analytic geometry with triangulation disabled; tolerances may leave microscopic padding.

For cylinders, cones and spheres belonging to a single solid, `boundaryRole: exterior | cavity` and `radialMaterialSide: smallerRadius | largerRadius` appear only when two-sided solid-containment checks at a verified trimmed-face point prove the material side. Open surfaces, toroidal patches, multiple solids or uncertain checks omit these fields. Omission means unknown. Cavity denotes the local concave/radial material side, including concave fillets; it does not prove a closed cavity or through-hole. Cylindrical descriptors do not imply a complete untrimmed cylinder and must not replace topology selection.

In the reconstructed logged bottle, the neck's outer cylinder is radius **66 mm**, its cavity radius **63 mm**, both spanning native Y **1.110–1.120 m**, with shoulder cone descriptors below. The earlier proposed 64 mm thread root plus 1.5 mm crest never reached the outer wall; the prior BRep comparison proved it added only internal material. The new fields expose the necessary measurement in existing evidence without another tool request.

This change adds observations only; it does not fit geometry, change models, or reject/alter threading operations. Real-kernel regression: `tests/native-analytic-worker.py`.

Body, solid-region, edge, face and collaboration difference bounds now use non-triangulated `optimalBoundingBox(False,False)` too, with the former `BoundBox` only as a fallback if the kernel cannot compute optimal bounds. This prevents cached tessellation from shrinking a true 20 mm radius to 19.99378 mm in reported extents. No source geometry changes.
