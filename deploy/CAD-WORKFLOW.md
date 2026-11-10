# CAD and mesh workflow

The desktop header and spatial header both expose **Enter VR**. On a headset use Quest Browser and a secure origin (your server HTTPS URL, or localhost through USB during development). A desktop monitor without an XR runtime still shows the control and reports why the session cannot start. Native CAD and mesh workspace switches stay inside the same immersive session.

## Selection and editing

- **Parametric CAD** uses FreeCAD; **Non-parametric** uses Blender. Switching keeps all bodies. Select the target body in the model list or by choosing Body and clicking it.
- **Edges**, **Faces**, and **Body** set selection filters. Edges are native CAD edges, including curved boundaries, rather than tessellation triangles.
- **Select all**, **Invert**, **Clear**, individual checkboxes, and clicking a highlighted edge let you build or remove any subset on the selected body. Use **Show / select hidden edges** for back-side edges.
- Drag a box to add a region; hold **Alt** while dragging to subtract it. With the viewport focused, **Ctrl+A** selects all geometry of the current type; **Escape** clears and leaves the picker. Mouse selection remains available while the model rotates with middle drag; Ctrl + middle drag pans.
- Select a face and choose **Draw on face** to sketch on it. Choose Pen for drawing or Edges/Faces/Body to return to geometry selection.
- Fillet and chamfer use exactly the selected native edges. Select all first for every edge, then click edges to exclude them. A deliberately cleared selection is rejected rather than silently applied to the whole body. Native indices are invalidated after topology changes; select again for the next edit.
- Native feature entries expose dimensions in millimetres. Editing a creation feature preserves later features where the CAD kernel can rebuild them. Modeling history supports undo and restoration.

## Holes and patterns

**Hole** creates a native cylindrical cut. Set centre, direction, radius and Through all (or blind depth). Selecting a face supplies its plane point and inward drilling direction. **Pattern of holes** supports centred grids, linear arrays and circular arrays, up to 64 holes per feature. The AI can edit an existing hole feature into a pattern without leaving an extra centre hole.

The AI receives the original request, current scene images, selected native edge/face indices, native features and explicit world-to-native geometry frames. Native JSON parameters are decoded and validated before applying. A cube dimension edit uses sizeMetres; a hole depth cannot masquerade as a cube dimension.

## Mesh and CAD conversion

Adding another Blender object leaves the original CAD body untouched. **Edit body as mesh** retains the original CAD provenance. **Return body to CAD** restores exact parametric features if that converted mesh has not been geometrically altered. A modified arbitrary mesh returns as a faceted CAD solid; it cannot automatically recover an original analytic feature tree. Original CAD versions remain in history. The Additional browser editors section retains the optional OpenZCAD and SculptGL editors; those full-page browser editors are separate from the server-native immersive workspaces.

The VR menu provides CAD/Mesh mode switches, native edge/face/body selection, Select all/Invert/Clear, fillet, chamfer, holes, patterns, primitive creation and undo. Point and trigger/pinch to toggle geometry; voice uses the same native engine operations and exact selection.

## AI correction after a rejected operation

A confirmed native CAD/mesh rejection is sent back to the model with the exact operation, attempted parameters, kernel error and confirmation that no geometry changed. The next move includes fresh scene images, model versions, native bounds and edge endpoints. The model chooses the correction; the app does not silently change a radius or substitute edges. Successful earlier cuts/features remain intact. A correction can ask a design question according to the supervision preference.

The live activity log shows the rejected operation and AI correction progress. Automatic correction is bounded to three attempts per run, identical rejected operations are blocked, and new speech/text/drawing yields control. Connection failures, partially applied edits and source-archive failures are not automatically replayed because their execution status can be uncertain.

## Drawing while AI is working

A brief stationary left/right hand pinch (under 90 ms, at most four sampled points and less than 8 mm of travel) is treated as gesture noise; its raw trace is retained in the local event log. Intentional Corner marks, longer gestures and mouse/controller strokes are retained.

For genuine new drawing, AI waits for the stroke to finish and the input to settle. A proposal based on old drawings or model versions is discarded before any geometry mutation; the same request then continues automatically with fresh images and geometry. This is shown as a context refresh, not an AI failure, and does not require a retry button. Background fit-version updates alone do not count as a new VR drawing. Explicit Stop, speech and text corrections still interrupt immediately. The guards also run before and after server-native computation.

## Automatic connection recovery

AI request and acknowledgement payloads are checkpointed on the device before transmission. Network drops and truncated replies are retried automatically with stable request/run/turn IDs. The broker coalesces duplicate model requests and acknowledgements, including requests still processing. A reload can resend the saved acknowledgement without applying geometry again; a saved request uses its original evidence so stale-result guards still apply. Native computation retries evaluate isolated full recipes and commit only one visible result after version checks. Model-provider connection failures also receive bounded automatic retries. Explicit Stop cancels continuation and clears the saved work. The supervision level Low asks only about genuine blockers.


## Quest fingertip input and VR entry

Pinch drawing uses tracked thumb/index contact with 22 mm start / 32 mm release hysteresis as a backup to Quest's native select button. Native select remains the UI activation signal when available. Fingertip contact suppresses stray thumb-tap shortcuts; explicit side taps and swipes remain available. Close fingertip contact is not rejected merely because a curled index places another joint nearer the thumb. Pen exits native geometry selection and closes the tool menu; the menu activation pinch must release before drawing starts.

VR entry invokes the immersive request directly from the click. Requests and renderer binding have bounded timeouts, release the button after failure, and close late sessions. The button displays Entering VR while waiting. Quest Browser must be in the foreground with a usable immersive runtime.

For local USB testing, scripts/server-proxy.mjs accepts DRAW3D_FRONTEND_ROOT to serve a fresh built frontend while forwarding API calls to the existing server. This permits frontend-only updates without discarding an active backend question. Normal remote deployment serves the built frontend from the app image.


### Hand roles and fixed VR panels
Right-hand pinch (or right controller grip) draws/erases only while the drawing point is roughly in front of the head: 65 degree half-angle to begin, 75 degrees to continue. Missing viewer tracking or looking away stops ink. Release and pinch again before resuming; looking back with a held pinch never creates ink. Left-hand pinch selects nearby edges or faces by default, or the explicitly chosen geometry mode, without switching off the Pen. A left fist moves the parent body. Existing menu actions take priority. Explicit object transform mode retains its two-hand scale/rotate controls.

Agent/voice, question, construction and recovery panels anchor once in world space about 1.1-1.25 m forward, using a level orientation. They do not follow head movement. Entering VR or recentering the board places them again. The tool menu retains its existing on-open positioning.


### Select components and move a whole body in VR
Use the left-hand pinch to select individual edges or faces. By default it picks a nearby edge, otherwise the face under the pointing ray; the Edges/Faces/Body buttons still set an explicit selection mode. Pinching never starts a hand grab.

Place the left fist's palm centre inside the solid and close it for about 100 ms to grab that body. Remote fist grabs are rejected, including when another object is selected. Containment uses actual triangles and rejects holes and empty bounding-box corners. Move and turn the fist to translate and rotate the object; open it to release. The palm centre and wrist orientation form the attachment frame, avoiding shifts caused by opening/closing fingers. Scale and native geometry stay unchanged. Missing joint tracking stops the grab and requires opening before grabbing again. Pinch remains reserved for component/UI selection.

Magnetic alignment works in direct fist grabs, Move body mode and single-body desktop transforms. Its capture distance is one quarter of the body's bounding-box diagonal (clamped to 4-120 mm); the inner 18% locks exactly. Targets include world zero, workspace origin, and the part's initial grab position. The native primitive axes are included, so geometry created at a tilt can align too. Orthogonal orientation capture extends to 15 degrees with a 3-degree lock. Blue target axes/dot, a blue outline and an active alignment label make capture visible. Magnet ON/OFF is available in the native VR menu and Objects panel.

Slow deliberate movement bypasses magnetic fitting. The speed threshold scales with body size (15% of its diagonal per second, clamped to 4-60 mm/s), with angular precision below 8 degrees/s. Precision mode displays its status. AI fitting waits while any stroke or object is held and for a short settling period after movement; a slow hand does not imply a completed drawing. Two-hand assembly scaling/rotation preserves relative placements without independent per-body magnetic distortion.

### Stable design frame for AI and drawings
Object frames and native engine frames now share the SAME origin: stable native geometry zero, Y-up metres before instance scale. Bounds centres are measurements rather than an alternate parameter origin. Human moves/rotations change only instance placement. New ink on a selected surface or near a selected body stores exact native points and follows the body visually; its recorded camera follows too. Its local points, dimensions and feature coordinates do not rotate. Older unattached ink remains explicitly world-referenced. Fitted source images and live scene images carry their own matrices, and local fit results are regenerated after genuine point changes without applying stale worker results.

AI packets include per-stroke objectSpace points, canonical native/world matrices, a focused designContext and separate instance placement. Existing native edits use target-native coordinates. New native geometry can specify coordinateReference:{modelId,expectedVersion}; its parameters stay in that body's native frame and the app copies the reference placement. This allows sketches/parts drawn on a rotated body to appear at the correct place without the model calculating a world rotation. Native operations retain current placement; user rotation does not rewrite feature parameters. Completed ink geometry is transformed efficiently rather than rebuilt each XR frame.


### Spatial components and fixed background panels
Spatial create/update actions accept coordinateReference:{modelId,expectedVersion}, just like native-model creation. Parameters are interpreted in that parent design frame. The resulting model stores coordinateParent and follows later parent placement changes; grabbing a child with a fist resolves to the assembly root. Component selection remains independent. Undo/model history retains attachments. Candidate and mask fits are converted against the explicit referenced frame. Parent cycles and stale/self references are rejected.

AI receives clean native-design overview/front images of the selected body without HUD panels. These images are framed around the parent body and remain interpretable after human rotation. Both voice/status and AI activity panels are always available side by side about 2.1 m forward, with a central tool screen lower down. All three share one world anchor: reopening menus, turning the head and automatic palm calibration do not move them. Explicit Recenter board or a new VR session places them again.


## Face and body drawing; CAD dimensions

In native CAD mode, click inside a face to select it. Use **Draw on surface** to restrict ink to that face, or **Draw on body · all surfaces** to project ink onto whichever visible surface of that body is under the cursor. The same actions are in native selection and the VR menu. You can also choose the drawing action first and click the target surface. Middle drag rotates the desktop view while drawing. Surface picking does not create an accidental stroke. Face drawing respects occlusion; drawing off the selected surface ends the stroke rather than bridging across empty space. Whole-body sketches keep their true XYZ paths, body-native attachments and scope when saved and reopened. Their tangent-plane preview is labelled as a preview in AI evidence; the spatial paths are also provided.

CAD objects automatically show **Design dimensions · mm**, on-canvas labels and a dimension inspector. Labels stay outside the object silhouette on a desktop, with leaders, and do not obstruct selecting the body. VR uses world-space annotation lines and billboard labels tied to the body transform. The VR **Dimensions** command and desktop dimension controls toggle them. **All bodies** can show other CAD bodies as well as the current body.

Double-click a native dimension to change the underlying modeling feature without AI: box sizes, sphere/cylinder diameter, cylinder height, profile width/height, extrusion distance, revolution angle, fillet/chamfer distances and supported wall/mesh modifier dimensions. Edits preserve other feature parameters, rebuild through the native engine, participate in modeling history and survive reload. Unsupported imported bodies expose read-only native bounds. Values are design dimensions before any scene instance scale; a non-unit instance scale is shown separately.


## Live proposed shapes and additive surface features

**Preview while drawing** is enabled by default in desktop and VR. It is a local worker preview, so no model request is needed to show it. Two connected near-perpendicular edges can propose a complete box with inferred depth; three observed directions establish its three extents. The ghost updates while the pen is still down. Automatic also recognizes closed circular profiles and sufficiently supported spheres; the Shape selector can request Box, Cylinder, Sphere or Sketch profile. Proposed missing dimensions are labelled as inferred. Continue drawing or choose **Keep drawing** to dismiss the current proposal until the ink changes. Turning the preview off retains the normal fitting workflow.

Accept the displayed ghost with **right controller A**, the on-screen **Accept shape** button, **Enter** on a desktop, or by holding a **left thumb–middle-finger pinch** for half a second while keeping the index finger extended. The hand gesture requires release before another acceptance and consumes component selection while held. Normal right thumb–index drawing and left thumb–index selection remain available. A accepts a preview even when whole-body selection is enabled. Acceptance ends the current stroke and creates the displayed proposal through the native CAD engine; held inputs must release before drawing resumes. AI/recording/body-movement transactions cannot be accepted concurrently.

On **Draw on surface** or **Draw on body**, a planar closed profile previews as a raised feature, using **Feature depth / cylinder height (mm)** (10 mm initially). Accepting compiles its editable sketch, extrusion and union into one server transaction on the same target body. Full solid proposals can also be joined to their source body. The kernel result must contain one solid and add volume; a disconnected or fully internal feature leaves the original body and source ink unchanged. Successful acceptance archives consumed ink for later AI recall. Native dimensions expose the resulting sketch and extrusion dimensions, including double-click depth editing and history undo.

Body-native feature coordinates stay stable during placement changes. Rotating a body moves its ghost and attached ink together without rotating the underlying feature parameters. Geometry changes require a fresh proposal. Arbitrary drawings spanning a curved surface are not flattened into a planar pad: use a solid proposal or ask AI to construct the appropriate feature.

AI evidence in desktop and VR includes the same additive surface intent, target version and chosen depth. Closed FreeCAD sketch proposals are extruded and fused automatically, and supported solid constructors are fused. The model can set `surfaceDepthMetres` for an explicit requested depth and `combineWithSurface:false` for a user-requested separate part or reference sketch. Existing explicit hole/fillet and other body-modifying operations retain their native semantics. The app continues to show native operation results and rejection feedback.


## Continuous approximation and automatic refinement (2026-10-29)

The live approximation remains visible after a stroke finishes and while a new stroke has no confident simple-solid fit. Straight edges and curves receive a fast local preview immediately; the detailed classifier can replace these with a supported solid after more evidence arrives. An inconclusive stroke retains the previous ghost with a refining label, instead of removing it. A retained proposal cannot be accepted until updated. Clear/new canvas, explicit preview dismissal, accepted native geometry and successful AI replacement still remove obsolete ghosts.

Automatic stroke refinement is enabled for this workflow update. It can be disabled with Enable AI, and that choice persists. Three queued strokes use a 650 ms settling period; fewer strokes queue refinement after 2.2 seconds idle. Never dispatch while a stroke/body is held, while recording examples, or while another AI edit/question is active. Local classification, native construction and provider processing can add time after the queue becomes due. New strokes are grouped, unchanged geometry is not resent repeatedly, and subsequent drawing schedules a new refinement.

For supported VR solid fits, the draft is committed before submitting to AI, retaining original ink as evidence. The packet includes the displayed liveApproximation, any lastDeterministicCAD model ID, all active strokes/images and the detailed fitting context. The request explicitly refines that draft in place and preserves unrelated geometry. If local CAD rejects the draft, AI still receives the drawing for interpretation; stale-context changes refresh instead of applying old data. Accepted and AI-created bodies remain visible after their source strokes are archived.


## Pen tip and headset build verification

A small cyan pen point shows the actual right-hand drawing position before a stroke. It turns lime while drawing and orange for erasing. Hand input uses the tracked thumb/index midpoint used by the drawing code; controllers use the configured lower-grip pen offset. Surface mode projects the marker through the same surface picker. Lost tracking, looking away, menu interaction and body manipulation hide the marker; left-hand selection behavior is preserved. The marker has a 2.5 mm core and subtle 4 mm halo.

After a frontend update, verify the existing Quest Browser drawing tab actually loads the new script. Android open_url can open/reuse another tab while the original immersive session remains on old JavaScript. Foreground the original session and freshly navigate to the same session URL with a build query if reload restores a suspended document. Keep the session query unchanged. This preserves saved drawings and requires Enter VR again. HTML is already served no-store; simply launching a URL is not proof the active tab updated.


## Stroke components and shared-shape evidence

Strokes are independent approximation components by default. They merge only when their time intervals are within five seconds, they are spatially near in the same object attachment frame, and all involved strokes support a common standard shape. Time/space proximity alone is insufficient. Connected perpendicular edges can complete a box; connected arcs can complete one circle; nearby thin coaxial circular sections can indicate a cylinder. Longer separated closed loops remain separate by default. Missing timing in legacy data allows geometry to decide conservatively; current desktop/VR evidence retains exact started/ended times.

The live scene displays all component approximations together. Its component selector chooses which proposal Accept acts on. One accepted part does not remove other pending approximations. A planar loop stays a circle/ellipse/curve reference, rather than automatically becoming a sphere. The detailed fitting API returns components with stable IDs, source stroke IDs, selected candidate IDs and grouping reasons. The internal singleComponent option is available only when the caller has already selected one object group; it retains the full geometry-hypothesis fitter for that group.

AI receives every component, including multiple candidates of the same shape kind. Native modeling commands include sourceStrokeIds for the part being generated; spatial actions use strokes. Applied model receipts retain this provenance. In a multi-component input only consumed strokes are archived; pending component guides remain. Automatic creation without a component source association is rejected with model feedback. User-requested assemblies or combined features can override provisional grouping through the AI workflow; unrelated parts should never be enclosed in one surrogate solid merely to reduce fitting error.

The recorded wheel-base regression is intentionally local/private under .runtime. Synthetic grouping tests run everywhere; its exact replay tests skip when the approved local recording is unavailable. Existing single-object geometry tests use singleComponent:true to test their already-grouped hypotheses; new grouping tests exercise the default scene behavior.
