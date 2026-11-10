# Draw3D desktop workspace

Draw3D turns pen strokes and spoken or typed instructions into editable sketches and CAD features. It suits early part design when the outline is easier to draw than describe. Desktop and VR share the project, but have their own input controls. The drawing-first workflow described here is for the desktop page.

## Make a first part

1. Open `/desktop.html?experiment=decision`. Select Front, Top or Right, or double-click a visible sketch plane. Double-click the canvas to toggle the pen. Middle-drag orbits, Ctrl + middle-drag pans, and the wheel zooms.
2. Draw the outline. Speak after enabling the microphone, or type in the composer. A fitted sketch appears and can be accepted. Explicit spoken or typed modeling commands such as “revolve this profile to make a hollow cap” start 3D construction directly. Drawings, descriptions and future plans stay in sketch mode until you confirm with **Create 3D**.
3. Use **New plane** for a second section. Choose XY, XZ or YZ, enter its normal offset in millimeters and its two tilt angles in degrees. Create the plane, then select **Sketch on this plane**. Click its label to see all three move arrows and rotation rings together at its origin. Drag and release to commit. Attached sketches follow the plane.
4. Press **Create 3D**. The CAD planner receives the visible sketches, plane frames and associated instructions. Include dimensions or describe how the sections connect when that matters. Raw strokes, 2D sections and model summaries are available in **Chat**. Use **Play recording** on a voice turn for its saved audio. Earlier recordings are available from **Earlier drawings** where the session retained its assets.
5. The sketch and body keep their measured position on the chosen plane. A nearly centered closed profile may snap to a nearby sketch axis. Use **Align to origin** to intentionally recenter a body, or enable centering of the first closed sketch in **Settings → Preview settings**.
6. Select the body in **Parts** or click its interior with the cursor. The body shows translation arrows and rotation rings together at its pivot. Drag and release a handle to commit. Selecting it through **Parts** also opens numeric translation and rotation fields. Use **Apply** to commit, **Close** to cancel, or **Align to origin** to recenter the selected body. Edge and face selection remain available.
7. **Undo / Redo** traverse design changes, including geometry and plane placement. **Solidify** closes the current part step for subsequent modeling. The conversation remains a record of what was requested, including edits later undone.

The preview can estimate an unspecified width or thickness. Different instructions can yield a different solid from the same side view. The underlying sketches and native feature history remain available for editing.
