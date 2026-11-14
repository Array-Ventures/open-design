# Native history entry reachability inspection

This is a read-only SDK prerequisite for future worksheet-origin retirement.
It does not prune protected contexts, retire issuers, enable controls, persist
history IDs, or grant worksheet, historical-file or recovery authority.

`IUndoRedoService.getUndoRedoEntryIds(unitId)` returns a frozen object containing
`unitId`, the service-local `revision`, and frozen `undos` / `redos` number arrays.
Each array follows its actual native stack order, bottom to top. The requested
unit must be the focused native history owner, using the same editor-aware focus
resolution as the existing checkpoint. A focused unit with no history returns
empty arrays. Empty/unknown/cross-owner requests refuse instead of borrowing a
focused unit's data.

The method reads the existing native stacks and their already-issued WeakMap
IDs. It allocates no IDs, reads no mutation payloads, executes no commands and
changes no focus, history or status. The total bound is 4,096 items across both
stacks, with no truncation. Unit strings are bounded to 600 characters; revisions
and IDs must be finite safe integers in their existing positive identity range.
Unknown or duplicate IDs, wrong entry owners, holes/accessor-backed entries or
unit IDs, invalid stacks, exhausted revisions and overflow refuse. Own data
properties are inspected without invoking their getters. Owner and revision are
rechecked before returning. Every refusal leaves the service unchanged.

Top-only inspection cannot prove an older Rename item is unreachable. Rename,
Add and Delete are therefore treated identically here: they are opaque native
items, not command kinds interpreted by the SDK. Consumers must still bind any
returned ID to their private issuer, lease, source generation, payload and current
controller. The IDs and revision are neither durable identifiers nor authority.

The unchanged original producer fails all four new tests because this API is
absent. One fixture performs actual SDK Add, Rename and Delete, verifies all
three buried/native IDs, then checks real Undo/Redo movement and unchanged
workbook/checkpoint during inspection. The other three run the actual maintained
ESM, CommonJS and compatibility entries. They cover frozen detached results,
movement, native history-limit trimming, redo clearing, cross-unit/invalid queries,
missing/duplicate IDs, invalid revisions, accessor/hole refusal, aggregate bounds,
no ID issuance, no command execution and stable history/checkpoints. Malformed
internal stacks and WeakMap values are deliberately injected only in these
isolated corruption fixtures; production inspection never changes them.

All 24 affected cases across the new query, entry-identity, checkpoint and
mutation-string inspection files pass. A frozen installation, full workspace
typecheck and guard also pass.

This source-level evidence is not packaged browser, HTTP, recovery or retirement
qualification. A future retirement owner must preserve live snapshot, pending
intent and origin dependencies, durably protect reduced pools through the Writer
barrier, then retire private maps only after ownership rechecks. No new package,
runtime activation, publication or installer pin update is part of this change.
