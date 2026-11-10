# Native modeling tool coverage

This is an executable capability audit, not a claim of SolidWorks feature parity. Actual engine health determines available operations. Structured operations never execute arbitrary generated Python.

| Task family | Available model tools |
|---|---|
| Primitives | Box, sphere, cylinder, torus, cone, plane |
| Sketch profiles | Circle; standard rectangle, rounded rectangle/capsule, ellipse; arbitrary polyline, analytic arcs, interpolating planar B-splines |
| 3D guide curves | Interpolating 3D B-spline, periodic smooth 3D curve, helix |
| Solid construction | Extrude, revolve, smooth/ruled loft, profile sweep with optional Frenet orientation, one-action constant-radius spline pipe |
| Surface construction | Loft and sweep with `solid:false`; plane; signed surface/body offset; surface thickening to solids |
| Mechanical edits | Exact boolean union/subtract/intersection, hole, grid/linear/circular hole pattern, edge fillet, chamfer, shell, explicit neutral-plane/pull-direction face draft, real helical thread |
| Repetition and placement | Native body mirror (arbitrary plane), linear/circular body pattern, instance translation/rotation/scale |
| Feature history | Edit prior parameters/tools, remove feature, preserved native checkpoints and topology anchors |
| Mesh modeling (Blender) | Booleans, bevel, subdivision, smooth, solidify, mirror, decimate, voxel remesh; native CAD/mesh conversion |
| Inspection | Native feature parameters, faces/edges, dimensions, valid-solid and measured-effect receipts, multi-view visual feedback |

Not yet exposed as structured tools: variable-radius/curvature-continuous fillets, arbitrary face deletion/replacement, trim/knit/fill surface workflows, full geometric/dimensional sketch constraint solving, sheet metal, weldments, assembly mate solving, configurations, simulation, CAM, and manufacturing drawing generation. A model must not claim these unavailable capabilities or silently substitute unrelated geometry. Some can be assembled through existing profiles, loft/sweep and booleans, but that is not equivalent to native dedicated features.

## Smooth-shape shortcuts

- A capsule handle outline needs one `create_sketch` with `profileType:"rounded_rectangle"`, width/height and corner radius, followed by extrusion. No hand-calculated arc points.
- A round tube/handle following a spatial curve uses one `create_pipe` action: `center`, optional `axes`, local `points3D`, `radiusMetres`, optional `closed`/`frenet`. The harness builds the B-spline, computes its start tangent, places a perpendicular circular section and sweeps a valid solid. This avoids two setup model moves. Its radius and guide points stay editable. For custom non-circular profiles use separate `create_bspline`, profile and `sweep`; loft across section sketches models varying cross sections.
- `loft:{solid:false}` produces a native surface; it deliberately has no enclosed volume. Open surfaces must not be treated as failed solids.
- `body_pattern` duplicates the entire current body. `hole_pattern` cuts repeated holes. These tools are distinct.
- `mirror` in FreeCAD accepts a plane normal and point; Blender's existing mirror is axis-only and rejects unsupported plane parameters.

## Native regression replay

`node --test tests/native-smooth-tools.test.mjs` checks strict contracts and frame conversion.

`tests/native-smooth-worker.py` runs sixteen real-kernel cases in a disposable FreeCAD container, without credentials/network/production volumes: mirrored cube, linear pattern, circular pattern, cone, 3D spline sweep, smooth open loft, periodic spline, standard rectangle extrusion, capsule extrusion ellipse extrusion, anchored-face draft, planar surface offset, surface thickening, open one-action pipe, changed pipe radius and closed periodic pipe. It asserts geometry, enclosed volume/solid counts, and surface distinction. See `artifacts/native-smooth-worker-results.log` for measured results.
