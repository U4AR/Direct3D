# Desktop drawing

Open `/desktop.html` on the same server as the VR workspace. The backend and model are shared; no headset or USB is required.

Double-click the viewport to turn the freehand pen on or off. Left drag draws with the pen on and selects geometry with it off. Dimension labels and text fields keep their own double-click editing. Select an existing plane, sketch, or face to retain that drawing frame. Without an explicit plane, enabling the pen creates a screen-facing plane through the view target without moving the camera. Sketch library buttons still enter the aligned sketch editing view.

Middle drag rotates in 3D, Ctrl + middle drag pans, Shift + middle drag zooms, and the wheel zooms. In the 2D board, middle drag pans. Navigation never creates strokes and ends an active stroke before the camera moves. Mouse conventions follow https://help.solidworks.com/2025/english/SolidWorks/sldworks/r_Middle_Mouse_Button.htm .

Each original desktop stroke image uses its recorded drawing camera, including the correct orthographic aspect ratio. The `imageReference` metadata records top-left image coordinates, world and sketch origins, exact camera/projection matrices, sampled pixel/world/plane correspondences, invertible plane homographies when available, and versioned native part origins/transforms. Curved-body points keep their world/object-space geometry; a tangent-plane homography must never be applied as a curved-surface depth estimate. The current inspection view is supplied separately as `desktopView`; camera navigation does not change stored geometry. The modeling prompt explicitly separates shape interpretation from geometric placement.

Verification: `npm run test:desktop-input` checks projection round trips, world/plane/native origins and context transport. `tests/desktop-mouse-view.spec.js` exercises real mouse gestures, dot rejection, explicit plane retention, and recorded-view evidence after later navigation. These checks use synthetic drawings and do not edit the user's scene.

Release verification: 28 coordinate/context tests, 200 core regression tests, 66 AI workflow tests, and five browser acceptance tests passed. The final packaged browser run includes a real FreeCAD body with mouse-drawn attached surface strokes. Production smoke verified `/desktop.html`, pen toggle availability, native-engine readiness and image-reference metadata with no browser errors. No model generation request was made during this change. See `artifacts/desktop-input-production.json` and `artifacts/desktop-input-browser.log`.
