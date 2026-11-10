---

name: sketch-to-model

description: Interpret rough spatial sketches and speech, choose solid or surface constructions from intent, delegate bounded regional tasks, and refine through spoken design clarification.

---

# Sketch to model

This skill runs in the Draw3D modeling backend. World coordinates are Y-up metres; native CAD uses its own document units and Z-up. Preserve the user's camera and source drawings. Produce an inspectable draft, then wait for feedback before optional detailing or finalization.

## Human intent takes precedence over numeric fit

Read raw stroke images before treating the selected local fit as the desired shape. Local line/circle/rectangle/spline classifications are geometric hypotheses; a low-error spline may simply trace hand wobble. Prefer a recognizable simple figure when its structure supports it: a rough rectangle becomes a clean rectangle with straight sides, parallel opposite edges and right-angle corners; an imperfect circle becomes a clean constant-radius circle when supported. Small gaps, shaky sides and unintentionally rounded corners can be regularized without asking. Combine separate strokes into an intended outline. Explain meaningful inferred changes and retain measured scale and overall proportions.

Do not substitute residual minimization for understanding. Compare alternative candidates and the raw silhouette. Primitive candidates may have accepted:false because strict metric tolerance failed; that does not disqualify a plausible design interpretation chosen by the model. The deterministic fitter does not infer intent. Conversely, a local spline kind never by itself proves the user intended a spline. Preserve explicit curves, rounded corners, intentional asymmetry, organic outlines and spatial paths when supported. Ask only for consequential unresolved ambiguity.

## Stroke-first default

Normal operation is incremental: each completed stroke is fitted locally without AI in a background worker. The initial draw3d_context includes a strokeReference packet: measured world-metre geometry, fitted line/circle/rectangle/polygon or 2D/3D B-spline, parameters, residuals, alternative hypotheses, and three separate images (raw stroke, fitted geometry plus objects, combined scene) from the recorded user POV. Reuse this evidence before requesting new analysis. Use stroke_reference for another stroke or group. In full-object mode the whole object can be created through AI, manual CAD/Sculpt, or the separate generation workflow.

For a single stroke modification, execute the user's requested next feature; do not launch a whole-object reconstruction or regional plan by habit. A spatial B-spline is a genuine 3D path with knots and coefficients, suitable for sweeps and loft sections. sculpt_tube can use strokeId, useLocalFit:true and expectedFitVersion directly to create a capped mesh tube along that saved path. Surface fits on sparse strokes remain hypotheses, not proof of a solid. Do not silently flatten a spatial curve. Preserve scale and placement in metres; distinguish native CAD units.

Report fitted residuals and inferred dimensions honestly; never label inferred thickness as user-specified or call a nonzero-error fit perfect. Ask only for consequential ambiguity. Stop after the requested feature is verified so the user can continue the design.

## Let the model choose the workflow

Decide complexity from the requested change, the drawing evidence, dependencies, uncertainty and available operations. Do not classify simplicity by a hardcoded shape list or number of parts. A profile extrusion, revolve, transform, repeated pattern, surface attachment or small edit can be simple even without a dedicated shortcut. A familiar primitive can need careful analysis if its relationship to the drawing is ambiguous.

Choose the shortest reliable sequence and act. Aim for one or two construction operations when those suffice, without a routine planning or delegation phase. Use combined tools when they express the user's intent; otherwise compose the necessary native or mathematical operations directly. Never force an unsupported shape into a primitive just to reduce the tool count. Delegate only meaningful independent subproblems where specialization helps, with the total goal and relevant context. Judge this internally; do not ask the user to classify the task.

Request each observation only to resolve a specific missing fact. Reuse current context, saved fit results, versions and returned images. Do not repeat measurements, CAD help/document reads or rendered checks already supplied by a successful combined tool. Inspect the result and correct demonstrated errors; verification remains required. Expand the workflow when evidence warrants it and stop once the requested result is verified. These rules govern the detailed technique recipes below; they are options, not a mandatory checklist.

For example, primitive_from_strokes combines measurement, native creation, placement, solid checks and a rendered result for its supported shapes. A suitable request can use context -> combined creation -> review. This is one available recipe, not the definition of simple work.

## Collaborative canvases

Execute the user's requested scope in small coherent operations without approval between steps. Collaboration means visible progress and responsiveness to human steering, not mandatory checkpoints. Inspect each result, compare it against the words and drawing, and correct errors before proceeding. Choose reasonable editable defaults for minor uncertainty and state important assumptions. Ask only when missing information would substantially change the result and cannot reasonably be inferred. Stop for a genuine blocker, an explicit user pause, or a verified completed request; do not run endless refinements or add unrequested detail. Final draft review comes after the requested scope is built and checked.

## Understand intent before optimizing geometry

Read the request and previous answers first. A drawing is evidence of intent, not automatically an exact dimensional specification. Identify each stroke's role: silhouette, section, axis, construction mark, path, attachment or decorative detail. Distinguish essential dimensions, proportions, distinctive features and deliberate asymmetry from hand wobble, accidental gaps and uneven repetition. Do not fill every closed stroke as a flat slab. A vase or body shown as a side outline is usually volumetric; use a credible revolution or loft when that matches the words and views.

Use stroke_catalog, then stroke_load for relevant IDs. Each stroke has a stable s1/s2/etc alias and separate immutable point snapshot. math_variables reads point arrays in pages; math_evaluate supports equations and vector operations, for example mean(column(s1.points,0)), dot, cross, norm and unit. Explicitly reload snapshots after drawing edits. sketch_views with colorMode stroke renders individually colored and labeled strokes from independent cameras, with IDs and calibration in metadata. Use sketch_user_view for recorded POV; never call the current camera the original POV. Inspect side/oblique views as well as the drawing view.

Use sketch_regions for geometric segmentation candidates, then split/group by meaning. A stroke can contain several regions: use inclusive sample ranges. PCA supplies orientation/dimensionality, not semantic certainty; nearly equal eigenvalues make axes ambiguous. Use sketch_fit_primitive to test line, plane, circle, sphere or cylinder hypotheses and sketch_fit_plane for RANSAC plane candidates. RANSAC outliers may be another intended feature. Retain original data and compare residuals relative to drawing size and brush width.

For each region choose a fidelity policy: dimensional/intentional features must match; rough silhouettes should preserve recognizable shape and proportions while smoothing noise; construction marks guide orientation but are not surfaces. Prefer simple smooth, symmetric, axis-aligned or repeated geometry when supported by the request. Preserve deliberate irregularity. Do not chase minimum point error at the expense of beauty, correct topology, smooth curvature or plausible volume. Report major inferred dimensions and editable assumptions. Do not claim a geometric fit proves semantic intent.

## Ask consequential questions and use the answer

Only if unresolved ambiguity cannot reasonably be inferred and changes the result substantially (flat emblem versus volumetric butterfly, a hollow vessel versus solid body, intentionally asymmetric versus symmetric), call agent_ask_question with one concise question and 2â€“4 useful options. The app displays the question in browser and VR and accepts speech, a choice or typed text. The tool pauses this same task and returns the actual answer; apply it to the plan and continue. Do not invent a user's answer or ask only in final prose when an answer is needed to proceed. Avoid questions about obvious minor cleanup. Specialists report NEEDS CLARIFICATION to the orchestrator rather than questioning independently.

## Plan and delegate bounded construction

When you decide that regional planning/delegation is useful, call agent_plan before delegating parts. Multiple parts alone do not require delegation. State the total goal, region IDs/strokes/ranges, selected representation, fidelity policy, technique, dependencies, attachment coordinates and acceptance criteria. Delegate distinct meaningful tasks with agent_delegate; every specialist receives the total goal and its assigned contract. Group small related work to reduce overhead. Shared editor edits execute serially and require fresh versions. Reuse valid planes/projections, surfaces and saved partial models instead of recreating them after failure. Specialists own assigned/new models and newly created surfaces. Pass source handles and report actual IDs, assumptions, errors and required joins; never duplicate completed parts blindly.

Choose a technique deliberately:

- Planar part with approximately constant thickness: fit/project its relevant outline, trace editable native splines, then CAD extrude. A flat projection does not establish that the intended object is flat.

- Rotational body: infer/fit an axis and half-profile, regularize the profile, then use native CAD revolve for exact capped solids. Inspect cad_command_help for the real payload. Do not revolve an arbitrary full outline.

- Changing sections or curved sheet: surface_create loft through ordered section curves, or equation/control-net surfaces. Use native CAD loft/sweep only if command help actually supports it; never invent operations.

- Organic volume: combine appropriate supported solids/tubes or deliberately shaped surfaces. Open spline patches alone are not a closed solid. State incomplete thickness/joins and use supported native geometry when closure is required.

- Open paths/antennae/connectors: sculpt_tube with a path and justified radius. Do not fill them as polygons.

- Genuine flat silhouette/wing/emblem: sculpt_from_projection with thickness, measured closure tolerance and conservative smoothing. Inspect discarded area if using largest-loop intersection repair.

## One stroke to a clean 2D profile and a solid

Select explicit IDs with stroke_catalog/stroke_load (or an inclusive range). Inspect the stroke alone in sketch_user_view and an oblique sketch_views image; use PCA/RANSAC to infer its plane. Call sketch_project with strokeIds:[chosenId], and the fitted planeId in orthographic mode for metric dimensions, or the recorded viewpoint in perspective mode to recover a POV silhouette. This leaves the user camera and original stroke unchanged.

Call sketch_trace on the projection to produce a clean 2D preview. Choose a native spline for deliberate curves, polyline for corners, or a circle/rectangle when the words and evidence suggest a regular primitive. Use toleranceMetres and optionally 0-5 smoothingIterations to remove hand jitter. Inspect the green fitted outline against the grey original, closure gap and sampled forward/reverse fit errors. Tune parameters if features disappear or curvature overshoots; these errors measure geometric difference, not user intent. Do not close a path into a face when it represents an axis or open connector.

Commit the chosen parameters with cad_trace_projection and the current CAD version. Inspect kernel diagnostics, then use cad_execute with its returned extrudeExample (choose the intended thickness, not the example default), or obtain revolveSketch help and build an appropriate half-profile. Preserve the fitted world plane so the result occupies the stroke's location. Verify the solid from front and side and correct scale, orientation, thickness or silhouette without asking for approval at each operation. Keep source strokes and editable native curves for later human changes. Use another technique when a single extruded profile would misrepresent the intended 3D form.

## Mathematical surface workbench

surface_create supports cubic spline control nets, lofted section rows, approximate revolutions, and x/y/z equations in u/v with scalar parameters (sin, cos, etc). Coordinates remain world metres so intended placement is preserved. surface_get exposes editable controls/knots; surface_update edits them with expectedVersion. Use surface_fit on appropriate stroke points/ranges to tune closest-point error, fairnessWeight for smoothness, anchorWeight for stability, and lockedControlPoints for dimensions/attachments. Inspect baseline versus fitted RMS/max error and coverage; do not fit a silhouette as though it were a dense surface scan. Sparse strokes underconstrain a surface: use semantic priors or ask.

To crop from another view, render independently, project the relevant region into a chosen plane, then surface_trim with projectionId or an explicit world/UV outline. This is approximate nearest-UV boundary mapping, not exact cutter-solid Boolean intersection. Inspect deviations and sampled geometry. surface_sample tessellates for diagnostics; surface_commit adds a real Sculpt mesh and retains the editable mathematical source. Recommitting creates a new model: hide superseded drafts explicitly after verifying their replacement. These meshes can be open; automatic caps/thickness and welded revolution seams are not provided. Prefer native CAD revolve/extrude when watertight solid construction is required.

Use model_mirror for intentional symmetry. model_pattern supports linear, circular and spline-surface UV/grid placement with normal/tangent alignment. Original native CAD remains editable, while copied results are mesh instances merged into one mesh, without Boolean fusion. Bound copy counts and inspect overlaps/attachments. Surface decoration should follow normals and scale, not merely be pasted into a camera image.

## Validate meaning and geometry, then request review

Read actual scene_models/native document diagnostics. Compare multiview sketch_views overlays for silhouette, scale, orientation and placement, and agent_capture for a clean independent view. Verify curvature/volume from the side, inter-part attachment, thickness/closure where required, symmetry and native kernel validity. A matching bounding box or low fit error is insufficient. Fix obvious disconnected or flattened parts before calling the draft ready. Preserve distinctive contours but explain intentional regularization instead of treating every deviation as a failure.

For the butterfly test, infer from the request whether it is a volumetric butterfly or a flat ornament; ask only if that remains genuinely unclear. Typically wings are shaped regional sheets with deliberate thickness/curvature, the body is a rotational/lofted volume, antennae are paths, and wing symmetry is an intentional prior unless contradicted. Align body and wing roots and inspect side views. Do not generate five unrelated flat filled loops and call that complete.

Call agent_review with verified IDs, concise results and remaining assumptions/omissions. Keep source strokes available until acceptance. The review UI can hide consumed strokes when the user accepts; later speech/typed feedback can revise the draft. Use ordinary part names in user-facing replies, retaining raw IDs in tool reports. Never claim unsupported topology repair or guaranteed automatic semantic understanding.



## Constrained curve fitting

Use stroke_fit_curve for one stroke or an inclusive sample interval, or ordered world points from a selected region. Choose bspline degree 1-7 (order is degree + 1), polynomial, or functions with a small set of safe expressions in normalized t such as 1, sin(pi*t), cos(pi*t). Custom functions are linear in their fitted XYZ coefficients; this is not arbitrary code execution or a nonlinear parameter optimizer. Use fairnessWeight and robustThresholdMetres rather than following every wobble.

constraints supports a symmetryPlane, an invariant fitted plane, fixed point anchors at t, tangent vectors dC/dt, positional closure and closedTangent. Reflection symmetry means C(1-t)=reflection(C(t)); choose stroke ordering/start accordingly. A left/right pair may need reordered explicit points. Conflicting anchors fail instead of being silently relaxed. Inspect RMS/max residual and constraint residual, sample the result and compare multiview silhouettes. Tangents use finite differences; reported correspondence error is not a closest-point guarantee. Store the returned curve ID and version; curve_refit adjusts settings against its saved source snapshot, curve_get yields world-metre samples for tubes or loft sections. Native CAD accepts cubic spans; other degrees need a measured approximation before a CAD sketch. Do not call a fitted curve a solid.

## Scale, placement and coordinate frames

Derive dimensions from the relevant drawing, never from a stock real-world size (a drawn chair may be miniature). Before modeling, use sketch_analyze/PCA, recorded POV and side views to establish the selected part's world-metre region and semantic up/front directions. Remember CAD document units and Z-up versus shared world Y-up metres. Build parts in this measured region. Before final review, call model_fit_check with only this request's stroke IDs and result model IDs. Correct scale/centre with model_match_sketch using fresh sketch/model revisions, and choose any world rotation delta from semantic evidence and multiview overlays. Use native edits for bad proportions. Thin sketch axes do not prescribe thickness; PCA signs and nearly equal axes are ambiguous. Re-measure and inspect fresh views after correction. A gross mismatch blocks review unless placementReason explains a deliberate user-requested exception. A fitted bounding box alone does not establish correct shape or orientation.

On clients with context.capabilities.spatialTools, use model_frame to read centred object-local frames, full local/world matrices and model versions. frame_convert handles points, vectors and inverse-transpose normals; object-local coordinates are pre-instance-scale metres, not native CAD coordinates. Use agent_camera referenceFrame object with modelId/expectedVersion for detail work; its camera follows the object's placement, and captures return current matrices/versions. Use referenceFrame world for god-view assembly and attachment checks. Neither changes the user camera. Re-read frames/versions after user grabbing/scaling; stale transforms are rejected. If this capability is absent on an older open page, use existing world-coordinate tools and placement_plan/placement_compare/model_align_to_sketch until the user opens the update page. Do not interrupt an ongoing VR session to force an update.


## Fast path for elementary requests

When primitive_from_strokes matches the requested geometry, use it after identifying the referenced stroke IDs: it measures the selected group, creates a native primitive, positions it and returns verification plus an image in one call. Choose orientation world for obvious horizontal/vertical intent, pca for a directed 3D form, or plane for a least-squares planar drawing. useSelectedSurface rests the new object on the selected support; an explicit supportPlane is also available. dimensionExpressions x/y/z can use sx/sy/sz (measured frame extents) and p0/p1/p2 (PCA extents), e.g. y=max(sy,0.02), to derive dimensions from the actual selected strokes. These expressions use metres. Report inferred thickness. Then review the returned result; fix only a demonstrated mismatch. Use individual tools or delegation for actual complexity, not ceremony.

For a requested regular polygon, use primitive_from_strokes with shape polygon and sides N (pentagon=5). It fits equal sides to the selected stroke in a plane, creates a complete native profile and extrudes the requested/inferred thickness in one call. Do not manually type line coordinates or trace hand wobble for a regular polygon. For direct extrudeSketch of multiple lines always select the complete enclosed profile with profile:{all:true,sourceEntityIds:[...]}; the native default selects the first entity. A warning about a line not being a closed profile means no solid was created. A new stroke referenced by the current prompt normally takes precedence over an old draft referred to in prior context.
