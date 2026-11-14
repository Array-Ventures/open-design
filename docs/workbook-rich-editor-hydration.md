# Rich editor hydration after clearing

The pinned core `insertTextRuns` returned immediately when the destination body
had no `textRuns` array. Inserting a rich body still inserted its text, silently
losing its incoming formatting. An empty array did not have this defect.

The SDK's `EditingRenderController._emptyDocumentDataModel` can create the
absent-array condition: clearing a multi-run rich editor sets `textRuns` to
`undefined`. Its subsequent `ReplaceSnapshotCommand` hydration uses TextX to
insert the actual worksheet document into that cleared editor.

The maintained core patch now handles absent destination runs with the existing
insertion algorithm when incoming runs exist. Plain insertion into an unstyled
body still leaves `textRuns` absent. Existing runs, offsets and incoming styles
retain the existing handling. The change covers the consumed ES, CommonJS and
compatibility builds; no declarations or app admission guards change.

The regression uses an actual worksheet-produced rich layout, the pinned SDK
clear implementation, actual replacement and text insertion commands, native
Undo/Redo and actual cell submission. The test supplies an inert render-view
reset to the clear implementation; document reset and editing are real SDK
operations. It asserts original rich runs and the source cell survive clearing,
rehydration and append, and checks the submitted source edit preserves the styled
prefix. Generic TextX tests cover all three entry builds, absent/empty/existing
runs, plain insertion and immutable inputs.

Before the fix, the real clear-to-rehydrate test failed because the editor had
no runs after replacement. The generic test independently failed in all three
entry builds. Setup failures involving a missing render service, initialized SDK
baseline ownership and aliased test input were corrected without changing product
admission. They are distinct from the formatting-loss regression.

The actual 131 fixture lost its styled prefix after rich append and Save. That
manual sequence included cancelled replacement attempts before the successful
append, consistent with the cleared-body condition. Initial formula-editor
creation normally supplies an empty run array, so this source proof does not
claim every fresh editor opening loses formatting. A new packaged browser run
must qualify the full clear/cancel, append and Save sequence. Candidate 131 and
its evidence remain unchanged; no runtime, release pin or preview was updated.

Author checks on the isolated source tree: 49 tests across seven affected rich
editor, plain-input policy and text conversion suites passed; full workspace
`pnpm typecheck` and `pnpm guard` exited 0. Frozen dependency installation also
passed after patch generation. No Worker, app build or browser was run for this
checkpoint. The earlier source failures and fixture setup failures were retained
in scratch logs rather than relabelled as passing runs.
