# Native feature collaboration

`delegate_parts` accepts different regions of the same part. Specialists propose edits without writing the scene. The parent commits checked `proposalId` actions serially. Parallel reasoning does not mean parallel writes to one BRep.

The harness derives operation bounds and read dependencies from native measurements, checks declared scopes, and withholds overlapping, ambiguous or history-wide effects. Both specialists receive conflict information; one gets both assignments and proposals as the combined owner. `continue_feature_work` returns actual CAD receipts and refreshed geometry to that same specialist. Later interference transfers coupled assignments again instead of silently overwriting another proposal.

Bounded native commits carry an internal guard that the model cannot supply. The worker compares immutable before/after BReps and rejects changes outside the reserved region. Another disjoint commit can rebase only through this verified artifact chain; selected topology is matched geometrically rather than trusting stale edge numbers. Ambiguous anchors, changed references or changed relative tool placement require replanning. Whole-part operations such as shell/history-wide changes use exclusive ownership. Non-native and unbounded edits remain conservative.

`extract_region` and `split_region` create independent editable geometry with its own datum; see NATIVE-REGIONS.md. Coordinate references express construction provenance rather than assembly mates. Moving one visible body therefore preserves unselected bodies; explicit multiselection moves all selected bodies by one rigid transform.

Free-space strokes carry independent-part ownership. Only explicit surface drawing or an explicit existing-part instruction attaches them to a body. The drawing hand must be within the forward camera gate; tracking loss or looking away requires an observed release before drawing resumes. Speech packets include dominant-facing scene and highlighted-ink images with matching camera transforms.

The runtime modeling skill is `agent-skills/native-cad-collaboration/SKILL.md`. It is included in both parent and specialist model instructions and packaged in the server image. `DRAW3D_MODELING_SKILL=0` disables it for controlled evaluation. Meta replay artifacts distinguish corrected harness metadata from unchanged original inputs and never claim human acceptance automatically.

Validation: `npm run test:collaboration`; `tests/feature-collaboration-browser.spec.js` uses real native holes, artifact rebasing and deliberate guard violations; `tests/native-region-browser.spec.js` checks independent extraction, atomic splitting, subsequent feature edits and invalid secondary receipts. `tests/body-selection.spec.js` exercises jug/cap separation, pinch-circle selection and rigid group movement. Test workers use disposable volumes, never writable production geometry.
