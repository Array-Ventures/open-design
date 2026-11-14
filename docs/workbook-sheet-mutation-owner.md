# Native sheet mutation owner development checkpoint

This controller foundation is not installed by WorkbookGrid and does not enable
worksheet controls. Membership calculation/RPC admission, historical restoration
projection, pending birth/removal ACK conversion, history pre-pop protection and
full controller/recovery/browser qualification remain unfinished.

The owner uses the maintained public identity-scoped command replacement handle
for the existing InsertSheetMutation and RemoveSheetMutation registrations.
It never mutates exported commands, accesses private SDK stacks or creates a
parallel Undo journal. Registration, actual workbook reference, focused unit,
live authority callback and protected pool issuance must remain current.
A one-shot synchronous ticket compares exact before/after native phase snapshots;
it is supplied only inside the Writer's already awaited protected callback.
Native Undo/Redo must independently await protection before popping history.

The real Workbook root `evebotSheetRemovals` map selects one retained removal
context for each currently absent numeric sheet ID. It is bounded, versioned and
generation-scoped. An insertion removes only that sheet's entry; a removal sets
its already protected token. Other entries and unrelated metadata survive.
Frozen pending snapshots retain their own map. Neither the map nor any parsed
token grants native/history authority; every existing entry must belong to the
live owner's protected pool before a callback can run. This checkpoint does not
yet wire map selection into the historical projector or recovery consumer.

The original synchronous SDK handler receives unchanged params/options. Only the
map is subsequently updated; unexpected SDK metadata is retained and causes a
conflict rather than being overwritten to force equality. Native failure, partial
mutation, setter failure, nested mutation or mismatched result withdraws the
owner. A thrown protected callback then enters the existing Writer's sticky
quarantine with the original desired snapshot and protected contexts retained.
No rollback is claimed after SDK mutation. Unknown later registrations are never
overwritten by cleanup.

Actual SDK tests cover official Delete and native Undo/Redo command mutations,
multiple retained token choices for one ID, command-observer map coherence,
immutable pending selection, forged/unissued selection, stale target, focus and
registration withdrawal, unrelated internal metadata changes and setter failure.
A real Writer/draft-encoder integration includes both sheetDisposed and command
observers: the entire protected callback suppresses intermediate Writer updates;
partial failure retains the precommand recovery branch and no later remote write
occurs. This is source-level proof, not a packaged/browser/worker qualification.

SDK internal sheetDisposed events still occur inside the original handler before
its map update. Only completed command observers/RPC see the final map. Live
calculation membership commands currently refuse; the remaining worker slice
must preserve input epochs, result provenance and bounded geometry before any
installed controller can use these actions.

Author checks for this development checkpoint: 30 focused cases across the new
owner, pending birth, existing birth and scoped-registration suites passed;
full repository typecheck, guard and diff check also passed. This does not
qualify a companion/image or the future installed controller.
