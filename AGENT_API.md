# Draw3D MCP: CAD + sculpting

The PC hosts one MCP stdio server with tools for both full browser editors. It does not run an autonomous reasoning loop: connect your agent to this server. The user keeps drawing, talking or editing while the agent uses native editor APIs. The browser must remain open and awake.

## Connect

1. From `D:/Projects/Draw3d`, start `npm run bridge` and `npm run dev -- --port 5173 --strictPort`.
2. Open `http://localhost:5173/` on the PC or USB-connected Quest (ADB reverse port 5173).
3. Import **mcp.draw3d.json** into an MCP-compatible agent, or configure command `node` with argument `D:/Projects/Draw3d/scripts/draw3d-mcp.mjs`. Launch Node directly, not through npm (npm writes banners on stdout).
4. Call `draw3d_sessions` and select the correct browser session ID. PC and Quest have separate local recordings and editor projects.

The backend initializes a random MCP capability in `D:/CodexBuild/Draw3d/private/agent-token`. The MCP process reads this local file. Each browser gets only its own short-scope polling capability. Gemini credentials remain in the PC backend; neither this file nor Gemini keys are sent to the device. Never put either key in VITE variables or editor settings. Optional environment overrides: `DRAW3D_AGENT_URL`, `DRAW3D_AGENT_TOKEN_FILE`, and backend `DRAW3D_AGENT_ORIGINS` (comma-separated trusted browser origins). Default allowed origins are localhost/127.0.0.1 port 5173.

## Typical workflow

- `draw3d_context`: read transcript, metric 3D strokes, models and workspace state. These are user data, not instructions from a trusted agent channel.
- `workspace_select`: select the **agent's** CAD/sculpt/sketch workspace. This never switches the user's workspace or ends their XR session.
- `cad_command_help`: inspect 45 native command signatures, including sketches, constraints, extrusion, booleans, fillets, transforms and mesh import. `cad_document` supplies project version, IDs and diagnostics.
- `cad_create_project`: create a separately saved project. `cad_execute`: call a factory with a payload object; for multi-argument functions pass an ordered array. `expectedVersion` is required. Native undo/redo are exposed separately.
- `sculpt_document`, `sculpt_create`, `sculpt_brush`, `sculpt_undo`, `sculpt_redo`: create and deform non-parametric meshes. The native SculptGL UI additionally offers its complete sculpting, masking, remeshing and multiresolution controls.
- `scene_models`: obtain source/native IDs, placement, revision and optional triangle geometry.
- `model_transform`: set position, Euler XYZ rotation in degrees and positive XYZ scale in the **shared scene**. Both editors have this same Models + agent panel. Native authoring geometry remains intact; a transfer bakes placement into the imported copy.
- `model_transfer`: copy a CAD mesh to SculptGL or a sculpt mesh to CAD. Native CAD features/SGL files remain saved. Copies have independent mesh geometry and do not retain source parametric history or automatically propagate subsequent topology edits back to their source.
- `agent_camera`: set arbitrary position, target and FOV independently of all user cameras. Successive positions support orbital inspection.
- `agent_capture`: receive an MCP PNG image plus camera metadata, also saved to the local recording. Captures include shared models and the spatial drawing from the chosen camera. Optional `modelIds` isolates chosen meshes in that capture without changing user visibility.
- `agent_status`: read activity/pause state, camera and workspace. The UI displays each command and provides Pause agent edits and Show agent workspace.

Example CAD command after creating a millimetre project and reading its version:

```json
{"operation":"addPrimitive","payload":{"name":"Block","primitiveKind":"box","dimensions":{"width":40,"height":30,"depth":20}},"expectedVersion":0}
```

OpenZCAD box payloads use legacy field names: `width` is X, `height` is Y, and `depth` is Z. The example makes a 40 × 30 × 20 mm XYZ box. Cylinder/cone `height` is their Z-axis length. Use the actual version returned by the document. On conflicts, re-read rather than replaying blindly. Commands are serialized for each browser. Human pointer/keyboard interaction defers mutations; prolonged interaction returns a retryable error. CAD mutations use native command validation, undo and autosave. A timeout does not prove a mutation failed: inspect the model before retrying.

## Coordinates and persistence

Shared scene and drawing: metres, Y-up. CAD: document units (`mm`, `cm`, `m`, `inch`), Z-up. Conversion is `(x,y,z) CAD -> (x,z,-y) shared` times the unit scale. Sculpt tool API: millimetres, Y-up. Transfer uses the shared world transform. Camera PNGs are 64–1536 px per side.

IndexedDB stores local native CAD revisions, the current SGL project, shared meshes/placement, speech, strokes, agent command events and captures. Export recording includes these assets. Shared model geometry updates from the current native editor; copies remain independent. Browser/site-data deletion removes local data, so export recordings for backups.

## Build and test

- `npm run cad:setup`: pinned Apache-2.0 OpenZCAD plus native API build transform.
- `npm run sculpt:setup`: pinned MIT SculptGL (upstream development is discontinued).
- `npm run test:agent`: real stdio MCP -> backend -> browser -> both native editors, brush/undo/redo, two-way mesh transfer, pause and camera isolation.
- `npm run test:agent-security`: broker capability, session ownership and origin checks.
- `npm test`, `npm run test:browser`, `npm run build`: app regressions/build.

The CAD command catalog is generated from the pinned source by `node scripts/build-cad-catalog.mjs`; it includes Apache-2.0 upstream type declarations. Upstream notices are served under `/cad/` and SculptGL's MIT license under `/sculpt/LICENSE`. This integration has no arbitrary JavaScript/shell execution tool.


Rocket acceptance test: `node scripts/demo-rockets.mjs build <sessionId>` builds separate parametric and sculpted display rockets through MCP and captures each from two angles. Native CAD command responses include `warnings` and normalized `diagnostics`; committing a feature does not by itself guarantee valid geometry. Sculpt commands wait for saved SGL restoration before exposing the editor.


## Sketch-guided placement and typed instructions

Users can use **Type instructions** in the workspace tabs or the instruction form in CAD/Sculpt's **Drawing + speech** panel. In immersive VR, **Type** exits the XR session and opens the browser text field for the Quest keyboard. Saved messages appear alongside speech in `draw3d_context.transcripts` with `source: "typed"`. Drafts and submitted messages stay in the local recording. Saving an instruction makes it available to the connected reasoning agent; enabled text automation submits it after a pause. Finished speech starts AI editing by default, independently of stroke automation.

Use this workflow to build at the drawing's location:

1. Read `draw3d_context`, then `sketch_analyze`. Optional `strokeIds` isolates one object. The reference supplies a revision, metric bounds, six labeled extremal stroke samples, endpoints, and nearly flat axes. Bounds describe stroke centerlines, excluding brush radius.
2. Call `sketch_views` for front/right/top/perspective (also back/left). The MCP response contains calibrated PNG images plus camera matrices, coordinates, and local recording asset names. These captures use a separate camera and frozen stroke geometry; they change neither the user's POV nor the agent preview camera.
3. Call `placement_plan` with `expectedRevision` and optionally `center`, `size`, and Euler XYZ `rotationDeg`. The default region matches the sketch bounds, with a minimum 10 mm thickness for flat axes. This padding is a working region, not inferred object thickness. The gold box and coordinate axes appear in the shared scene. Use `placement_compare` and `sketch_views` with `planId` to inspect it, then revise the region as needed.
4. Call `placement_points` with normalized points, where `[0,0,0]` is the box corner and `[1,1,1]` its opposite corner. Responses supply world metres, CAD millimetres (Z-up), and Sculpt millimetres (Y-up). Create native geometry with these coordinates and explicit native project units. Rotated regions require applying the corresponding object/sketch orientation too.
5. Alternatively, build an assembly at a convenient native origin and call `model_align_to_sketch` with the plan ID, model IDs, and exact `expectedVersions` from `scene_models`. It uniformly fits the aggregate world bounds into the region, preserving relative part placement and proportions. This changes shared scene placement; native authoring geometry remains unchanged. Transfer bakes the placement into the mesh copy.
6. Call `sketch_views` with both `planId` and `modelIds` to inspect translucent model overlays from multiple angles. `placement_compare` reports sample containment, stale references, model bounds and centre offset. Bounds agreement is not proof of shape similarity: inspect the images and adjust the native model as necessary.

Plans and captures are saved locally. Removed or modified planned strokes invalidate construction-point mapping and alignment; re-read the sketch and propose a new region. Extra strokes outside the explicitly selected set do not change that selection. Model placement also rejects stale model versions. Users can preview/hide the region, view the sketch, and fit a selected model from **Models + agent**. `agent_camera` plus `agent_capture` remain available for arbitrary camera angles beyond the named reference views.

Regression: `npx playwright test tests/sketch-agent.spec.js` exercises typed instructions, real MCP multiview image responses, native Sculpt creation, assembly placement, camera isolation and stale-plan handling. `tests/sketch-reference.test.mjs` covers bounds, coordinate conversion, rotation and uniform fitting.

Validation for sketch-guided placement (2026-10-13): all 34 unit tests and 11 browser tests passed, including real MCP requests through the local backend and native editor, and the production build completed. Physical Quest USB was available, but Quest Browser did not expose a CDP session after launch attempts, so the new keyboard/multiview flow was not verified on-headset. Normal proximity behavior was restored. `node scripts/verify-sketch-quest.mjs` provides a read-only check and four captures when the headset browser session is available.


## POV-to-plane-to-CAD workflow

New strokes record the user's camera at their start and end. Typed/spoken prompt records include a camera and the visible stroke IDs at submission. Legacy strokes without saved viewpoints explicitly require a current/custom viewpoint rather than an invented historical camera. XR captures use the head pose and one eye's projection, providing an approximate head-centred view, not exact binocular screenshots.

- `sketch_user_view`: returns a PNG rendered from a stroke/prompt's recorded view, the current view, or a custom position/target/up/FOV. Select `strokeIds` to isolate a part. The user and persistent agent cameras stay unchanged. `agent_camera` also accepts `up` for arbitrary persistent camera orientation.
- `sketch_project`: returns a labeled 2D PNG and metric paths, plane frame, image calibration, original sketch revision and depth-deviation metrics. Default is perspective projection onto a plane through the selected bounds facing the recorded view. Set an explicit plane `{origin,normal,up}` and `mode: "orthographic"` for direct planar flattening. For a selected model face, use `draw3d_context.selectedSurface.frame.origin`, `.normal`, and `.yAxis` as `up`. A curved surface has only a local tangent frame; its whole drawing need not be planar.
- Select individual stroke IDs or `ranges: [{strokeId,start,end}]` with inclusive sample indices to reason about parts of a spatial drawing. Use multiple independent projections for side profiles, sections, attachments and separate components. Depth-deviation metrics expose information lost by projection; they do not infer the user's intent or prove planarity by themselves.
- `sketch_trace`: previews the native CAD payload. `polyline` simplifies the sampled path, `smooth` / `spline` build native cubic spline spans with exact Bézier/NURBS kernel edges, and `circle`/`rectangle` produce regular native entities with fit-error measurements. The Draw3D extension adds native spline sketch entities to the pinned editor. Tolerance controls simplification of the source knots; it does not guarantee a fit to the intended shape. Explicit `closed: true` joins endpoints: inspect the result before treating an open drawing as a closed profile. Separate open strokes are not automatically stitched.
- `cad_trace_projection`: creates the native sketch in the projection's spatial plane and the current CAD units, with optimistic document version locking. It returns sketch/entity IDs, kernel diagnostics, and an `extrudeExample` for closed profiles. Submit that example to `cad_execute` only after inspecting it; choose an appropriate depth, operation (`new-body`, `add`, `cut`) and target body. Native `transformBody`, booleans, revolve, loft and sweep remain available through the existing command tools. A stored world frame preserves placement, but it is not an associative native face attachment.

Projections and images are saved locally and remain accessible after reload. Tracing rejects a projection when any of its source strokes changed. Automatic shape interpretation remains the connected reasoning agent's job: these tools supply geometry, views and editable operations.

## Draw on a model surface

In Spatial drawing, choose **Select drawing surface**, then click a CAD/sculpt model. In VR choose **Surface**, point at a model, and select with trigger or pinch; the selection ray remains visible while picking. Continue drawing with the lower grip or pinch. Samples are projected along rays from the user's eye through the pen onto the selected mesh, including curved surfaces. A ray that misses the mesh ends the stroke. Selection uses the model's shared placement and records model version, hit triangle and tangent frame with the stroke. Geometry/placement changes clear the selection to avoid drawing against an outdated surface. Drawn annotations remain at their recorded world positions rather than deforming with later model edits.

**Free-space drawing** (or **Free space** in VR) unselects the surface. Native editor face selection is separate from this spatial annotation mode.

## Finish a prompt without accumulating clutter

Once the agent has inspected the result and considers the request fulfilled, call `request_complete` with explicit prompt IDs, source stroke IDs, the inspected sketch revision, result model IDs and their expected versions. This marks the request complete and hides only those strokes. New strokes outside that selection remain visible. Active strokes and stale drawing/model revisions are rejected. No model-generated claim of completion is inferred merely because a CAD command committed.

`draw3d_context` separates active `strokes`, `archivedStrokes`, and `completedRequests`; all geometry remains in local recordings. Default sketch/depth captures exclude archived strokes. Explicit IDs can still retrieve archived references. Use `sketch_visibility` or **Models + agent → Show completed drawings** to restore them. Completion is an explicit tool call by the connected agent, not a built-in autonomous reasoning loop.


## Native splines, inferred planes and magnetic controls

Draw3D extends OpenZCAD in place with native piecewise cubic spline entities. `addSketch`/`updateSketchObject` accept `{objectKind:"spline",closed:true,segments:[{points:[x0,y0,x1,y1,x2,y2,x3,y3]}]}`. Each span has two anchors and two handles; consecutive spans must share endpoints. Closed paths join back to their start. Closed spline profiles reach the kernel as exact Bézier/NURBS edges, rather than line tessellation; STEP retains B-spline curves. Viewport polylines are display tessellation only. `cad_command_help` includes the extended native schema.

Users have **+ Spline**, an **Editable spline** selector and **Edit spline** in the CAD toolbar. The native spline editor offers draggable handles, coordinate fields and closure control. Changes use normal CAD history and rebuild downstream extrusion. Curve handles currently use direct coordinate editing, not the general sketch constraint solver; arbitrary rational weights, higher-degree spline editing, and mixed intersecting spline/line profile arrangement are not implemented by this extension. Do not treat this addition as complete CAD feature parity. The exact kernel may reject particular operations; always inspect diagnostics. Spline-only extrusion and exact STEP export are acceptance tested.

The reproducible `scripts/patch-cad-splines.mjs` patch preserves pinned-source backups under `D:/CodexBuild/Draw3d/spline-patch-backups` and refuses to overwrite unrelated source edits. `build-cad-agent.mjs` applies it before the main/worker builds. Original licenses and notices remain packaged.

`sketch_fit_plane` fits selected strokes with deterministic RANSAC plus covariance refinement. It reports raw and optional horizontal/vertical candidates, inlier fractions, RMS/maximum distances, and contiguous `inlierRanges` suitable for `sketch_project.ranges`. `preferAxis` is an explicit decision; the default keeps the fitted plane. A line alone cannot determine a stable plane. Larger spatial shapes can be handled with several independently fitted regions.

`sketch_planes` lists reference planes. `sketch_plane_update` adjusts origin/yaw/pitch or chooses the axis-aligned candidate. Users have the same controls in **Models + agent → Agent reference planes**. These references do not switch the user's drawing surface. Pass `planeId` to `sketch_project`; subsequent plane edits invalidate the old projection before CAD tracing. `cad_set_sketch_plane` explicitly moves an existing native sketch into that frame and rebuilds its downstream features. The CAD **Use reference plane** button does this for the selected spline; local curve coordinates are preserved, so this is relocation rather than reprojection.

**Snapping preferences** control magnetic sliders, number and angle steps (default 5), and exact typing. Near round values, slider motion latches with hysteresis; hold Shift/Alt or disable magnetism to bypass it. Numeric fields preserve entered values and offer a **Use 95**-style button when nearby rounding is available. Metre position fields interpret the number step in millimetres. These controls are installed in the host, CAD, and sculpt editor pages; nonstandard canvas widgets and gesture-only controls keep their native input behavior. Plane axis alignment is a separate agent/user choice, not a silent modification of recorded drawing samples.


Validation of the spline/plane extension (2026-10-13): 39 unit tests and 13 browser integration tests passed. After the final native editor cleanup, the spline and projection acceptance tests passed again; the OpenZCAD web TypeScript check and production build also passed. Evidence includes `artifacts/agent/native-spline/exact-spline.step` (B_SPLINE_CURVE entities), the restored spline editor screenshot, and projected-sketch/surface/archival acceptance artifacts. Quest USB was connected but Quest Browser was not running, so these additions were not physically verified on-headset. Native project files containing the new spline kind require this extended editor; STEP is the interoperable curved-solid export.


## Stroke variables, mathematical surfaces and questions

`stroke_catalog` gives stable s1/s2 aliases, UUIDs, inspection colors and geometry summaries. `stroke_load` freezes selected samples as named variables; `math_variables` reads paginated arrays, and `math_evaluate` computes safe scalar/vector expressions. Reload snapshots explicitly after drawing edits. Coordinates are world Y-up metres.

`sketch_views` defaults to `colorMode: "stroke"`, adding alias labels and color/UUID metadata; `"original"` retains drawn colors. Inspection never recolors the user's drawing or moves their POV.

`surface_create/get/list/update/fit/sample/trim/commit` expose cubic control nets, section lofts, approximate revolution, equations and regularized closest-point fitting. Mutations check surface versions; commit also checks Sculpt revision. Fit returns baseline/final residuals and preserves locked controls. Nets, their history and variables are persisted locally. Trim can consume a saved projection and checks source revisions.

`model_mirror` preserves originals and corrects reflected winding. `model_pattern` supports linear, circular and surface UV/grid placements with tangent/normal alignment. Copies become one Sculpt mesh with disconnected components, without Boolean fusion.

`agent_ask_question` is a built-in backend orchestrator tool. It pauses for an actual speech, typed or option answer through scoped `ai-answer` and resumes the same model loop. External MCP clients manage their own conversational orchestration; public MCP tools expose geometry and observations.

Sparse strokes underconstrain surfaces. Residuals do not establish intent or solid validity. Prefer native CAD revolve/extrude for exact solids; spline workbench commits are open meshes without automatic walls/caps, and trim uses approximate nearest-UV boundaries. See the backend sketch-to-model skill for fidelity policies, construction choices and user review.


## Fitted primitives, constrained curves and object frames

For elementary box/sphere/cylinder requests, the normal backend sequence is `draw3d_context -> primitive_from_strokes -> agent_review`. The combined tool measures explicit stroke IDs with world bounds, PCA or a least-squares plane, creates native CAD/Sculpt geometry, checks bounds and returns fresh model/image evidence. It does not need separate CAD command help, document reads or captures. Extra analysis is justified by a specific ambiguity or failed/visually incorrect result.

`primitive_from_strokes` supports `orientation: world|pca|plane`, `thicknessMetres`, `useSelectedSurface`, or an explicit `supportPlane`. Optional dimension expressions use measured frame extents `sx/sy/sz` and PCA extents `p0/p1/p2`, all in metres. For example `dimensionExpressions: {y: "sx/4"}` derives height from the selected stroke width. Unsupported thin dimensions otherwise infer 10% of span and are reported. Primitives retain native geometry; placement lives in the shared scene transform. Transfer bakes placement into the mesh copy.

`stroke_fit_curve` fits degree 1-7 B-splines, polynomials or safe custom basis functions to an ordered stroke/range or points. Constraints include a plane, reflection symmetry, fixed positions, tangents and loop closure. `curve_get` returns samples; versioned `curve_refit` retains prior versions and the original source snapshot. Results include residuals. Reflection pairs t with 1-t, so ordering matters; custom functions fit linear coefficients, not arbitrary nonlinear programs. Native CAD currently needs cubic-span approximation for other degrees.

`model_fit_check` compares selected result models with selected source strokes. `model_match_sketch` applies explicit rotation, uniform assembly scaling and centre alignment using current source/model revisions. Thin sketch axes do not prescribe thickness. The backend rejects final reviews with gross placement mismatches unless an explicit intentional exception is explained. Bounding agreement does not establish semantic or detailed shape correctness.

Users select **Objects** in the browser or VR menu. Trigger/pinch selects, held grip/pinch grabs, two hands rotate/scale, and **Unselect** releases selection. Desktop users get Move/Rotate/Scale gizmos. **All objects** selects visible models as an assembly. Instance scaling is uniform to preserve relationships. Transform events and final placements are saved; AI mutations wait while the user grabs.

`model_frame` supplies centred object-local/world matrices, units and version. `frame_convert` transforms points, vectors and normals with revision checking. `agent_camera` can follow an object using `referenceFrame: object`, `modelId`, and `expectedVersion`; world mode supports assembly views. Captures include current frame metadata. The user camera stays independent. These frames use converted Y-up metre geometry, not raw native CAD Z-up coordinates.

Validation: 87 math/input tests, 14 backend tests, browser fitting/manipulation integration tests and the production build passed. A real gpt-6-luna/medium test (run 47ce616b-7db7-4fe3-aa8f-e7876ff282dc) created an 81.35 x 81.35 x 10 mm native CAD block in one construction call, with context then final review and no delegation. The connected Quest was reloaded onto this update; its 25 strokes and existing models were preserved. Physical hand tracking feel still needs user testing. `node scripts/test-fast-agent.mjs` repeats the isolated live API test (uses the backend API key and incurs API usage).


### Pentagon regression and line-loop extrusion repair

The original Quest request (run 5f782f0a-7dda-443a-97af-7b7a7700e6a6) fell outside the old three-shape fast path. Its extrudeSketch call omitted profile selection, so native CAD tried to extrude the first line and warned that a line is not a closed profile. The agent entered a long repair sequence, eventually constructing a polygon before being stopped at step 32. Existing work is retained.

primitive_from_strokes now accepts shape polygon and sides 3-32. It fits a regular equal-edge polygon in the selected frame, creates a native closed profile and extrusion (or Sculpt mesh), checks positive volume and STEP exportability for CAD, and returns a rendered image plus fit errors. The fit uses uniform arc-length sampling and bounded numerical search; it is not a guarantee of semantic intent or a global optimum. Native CAD sketch edges remain editable. Existing unrelated CAD warnings do not invalidate a separately verified new solid.

Direct cad_execute extrudeSketch calls without a profile now select the complete boundary when the sketch consists of one connected numeric closed line loop. Open, branched or disconnected line sets require correction or explicit profile selection. Explicit caller profiles are preserved.

The actual recorded Quest stroke is tests/fixtures/pentagon-stroke.json. Unit tests and real browser integration verify five equal edges, seven CAD faces, positive solid volume, exportability, omitted-profile extrusion and Sculpt geometry. A live gpt-6-luna/medium replay (b6745875-90d9-47f4-954a-84cb4365ef69) used draw3d_context, primitive_from_strokes and agent_review only, with four model turns including its final response. Result: approximately 21 cm across, inferred 3 mm thickness, 7.2 mm contour RMS error. Render: artifacts/agent/pentagon/verified.png. Replay with node scripts/test-fast-agent.mjs --pentagon (uses API credit).


## Direct Flash region masks in VR

The rapid VR response `action.fit` can invoke the local `fit_mask` tool without MCP or a second remote tool-routing request. Use `fit:null` for an ordinary direct edit. For a region fit, choose `kind: cuboid|cylinder|spheroid`, current `id/version` for updates, and seed geometry in `params`. Set `fit:{masks:[{frameId,polygon:[[u,v],...]}],source:"strokes"|"scene"|"both",figureIds:[],adjustOrientation:false}`. Coordinates are normalized 0..1 from the top-left of the exact current spatial image. Use two or three views for depth; a single view needs 3D support and retains seed-depth ambiguity. Masks may clip portions of continuous strokes.

A fit returns editable parameters plus `maskFitReport`, projected contours, pixel residuals, silhouette IoU, source ranges and timing. Request `next` to inspect the actual result. The next checkpoint includes mask overlay images, fit reports, fresh scene images and current versions; update/refit the same body as needed. Reports are versioned history after subsequent geometry changes. The UI exposes **AI region fits**, orange 3D selection contours and orange-mask/cyan-fit images; undo preserves the corresponding mask history.


### Voice-first control and selected-input feedback

Finished speech starts AI editing by default in desktop and VR, independently of the automatic-stroke-edit setting. No Run AI/Enable AI press is required after each spoken instruction. Say **enable AI**, **pause AI**, **resume AI**, **stop**, or **try again**. An explicit voice pause persists across reload; resume commands are still recognized while paused. Existing microphone permission/recovery is retained.

Region masks should target original input images: **drawing** is all raw ink from the recorded user POV; **stroke** is one original stroke; **spatial-front/top/right** are raw-only calibrated views. Separate **model-front/top/right** images show generated geometry from matching cameras. The fitter primarily uses selected original XYZ stroke samples, with image mask overlap as a secondary reference; a loose selection polygon is not a shape stencil.

Every fitted region returns **region-ink-highlight** images: selected original ink is yellow, unselected input is dim, with exactly the source image's camera, projection, dimensions and framing. Source frame IDs, stroke IDs and contiguous selected sample ranges accompany each image. The model receives these images automatically on its next inspection turn, alongside separate fitted-result overlays and current scene images.
