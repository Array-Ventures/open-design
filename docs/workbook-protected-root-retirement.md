# Protected worksheet root retirement: unreferenced records

This checkpoint retires genuinely unreferenced durable records and private
issuers. It does not enable worksheet controls or complete lifecycle retirement.
In particular, it does **not** clean obsolete `evebotSheetRemovals` selectors:
a selector still present in any live/ACK/desired/pending snapshot remains a root.
Abandoned or committed-deletion selectors therefore need a separate coherent
live/Writer metadata cleanup before full worksheet controls can ship.

## Owners and retained closure

`WorkbookSheetHistoryController.retireProtectedRoots()` requires the current
private controller, focused exact native unit, unchanged live snapshot and
Writer, and the bounded native Undo **and** Redo ID query. Every reachable private
Add/Delete/Rename item is retained using its existing immutable private payload.
The SDK payload inspection API is deliberately top-only: current top entries
are checked now, while buried items are checked when native Undo/Redo reaches
that exact entry. IDs copied into a new public history item do not acquire issuance.

The pure closure preserves:

- Birth/deletion descriptors and removal selections in live, acknowledged,
  desired and pending snapshots.
- Every reachable private native issuer and its inserted-sheet ancestor markers;
  markers reached through retained private payloads and durable context configs.
- Provisional removal→birth and historical saved-birth→birth dependencies.
- Pending creation associations, matching retained historical templates, and all
  pre-save deletion records still eligible for checked receipt conversion.
- Birth scope, numeric high-water and axis-generation state even when entries
  become empty. No sheet ID is reused.

Markers and stored contexts supply retention data only. They never create a
private issuer, native history item, historical-file permission or save grant.
The existing draft decoder validates both the full original and reduced
checkpoint, including pending-plan/ACK/source-binding consistency.

## Storage linearization

The existing journal gains an optional `saveGuarded(checkpoint, guard)`, backed
by the same IndexedDB stores and transaction. Its synchronous guard runs before
writes and again on the final successful request before explicit transaction
commit. Failure there aborts **both** draft bytes and discovery head. Normal
unguarded writes preserve their existing API and behavior.

The Writer serializes this operation through its existing persistence and
protection barriers. The controller remains busy, so no protected
Add/Delete/Rename/native replay can issue a new origin. The Writer's source ACK
conversion waits on that barrier. Native opaque copied pushes get new unissued
IDs; ordinary scalar edits cannot grant a new protected origin. All admitted
current roots are retained, not only roots of the visible desired branch.

The guarded transaction commit is the linearization point. There is no claim
that an already committed write can always be rolled back after lease loss.
On completion, the Writer adopts the committed reduced pools **before** checking
whether focus/lifetime still permits private-map maintenance. If that final
check fails, private maps remain conservatively larger, but their source/birth
origins can no longer borrow an unpruned in-memory pool. A later current
maintenance call can reconcile those extra entries; copied native IDs still
refuse. Retained quota accounting is computed before any synchronous Map/Set
pruning; there is no revision/time eviction or shadow history.

The recovery session supplies this same-store guarded write. The separate
clean-resume/hook integration must forward `ownedJournal.saveGuarded` when it
constructs/rebinds the Writer; this source checkpoint does not edit that moving
hook or install the controller.

## Author evidence

The initial three real-SDK retirement assertions genuinely failed because the
controller API was absent. Two new IndexedDB assertions also genuinely failed
against the unchanged store because guards were ignored; the other 11 store
cases passed. Final checks pass **204 cases in 15 affected files**, full workspace
`pnpm typecheck`, and `pnpm guard` (all exit zero).

Fourteen new retirement cases use actual pinned SDK commands and the real
draft-store implementation over isolated `fake-indexeddb`. They cover orphan
Rename quota release, unreferenced context storage cleanup, buried Undo/Redo,
present birth and restored-origin retention, pending creation/removal, checked
ACK association, source ACK blocked while retirement is pending, failed storage,
precommit history/lease/edit changes, postcommit focus loss plus copied-item
refusal, and blocking new protected issuance while waiting. One additional pure
case uses the actual birth preparer to prove empty-pool high-water preservation.
ACK transport in these fixtures remains the documented membership stand-in;
these are not worker, HTTP, crash-cut or packaged-browser qualification results.

Receipts:

- `/tmp/workbook-root-retirement-red.log`: three original SDK RED assertions.
- `/tmp/workbook-root-retirement-idb-red.log`: two original guarded-store RED assertions.
- `/tmp/workbook-root-retirement-final-focused.log`: 204/15 final affected suites.
- `/tmp/workbook-root-retirement-final-types.log`: full workspace types.
- `/tmp/workbook-root-retirement-final-guard.log`: guard.

An earlier implementation draft attempted best-effort rollback through ordinary
journal writes. That was replaced before commit: IndexedDB has no general
postcommit rollback guarantee. Earlier test mocks expected the inner guard's
message; real IndexedDB correctly exposes its existing transaction-abort error,
and the final assertions require that exact public error while independently
checking unchanged durable bytes/head. Initial typecheck errors in the root
configuration input shape were corrected; no native ownership assertion was
removed or relaxed.

No stack, preview, package, worker, release, installer pin or production changed.


## Same-stack buried-entry correction

Root source review identified that the first checkpoint mistakenly called the
SDK's top-only payload reader on every reachable ID. Its original test placed
only one entry in each stack, despite describing buried coverage. Four new
actual-SDK cases genuinely failed on `5feba661`: three Rename items in the same
Undo stack, three in the same Redo stack, and birth/Delete items buried below
ordinary scalar history. The correction uses the complete bounded native-ID
union plus existing private immutable payloads for retention, inspecting only
current top native payloads. All new cases also execute the preserved history
through its actual top and verify the expected workbook result. The SDK API
and future Undo/Redo payload guards are unchanged.

Original failed evidence remains `/tmp/workbook-retirement-buried-red.log`.
This corrects source maintenance behavior, not the still-open obsolete-selector
cleanup or packaged qualification gate.

Correction author checks pass **79 cases in five affected suites**, full workspace
`pnpm typecheck` and `pnpm guard` (all exit zero). Receipts:
`/tmp/workbook-retirement-buried-green.log`,
`/tmp/workbook-retirement-buried-types.log`, and
`/tmp/workbook-retirement-buried-guard.log`. No stack or packaged browser was run.
