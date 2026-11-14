# Live worksheet consumer development checkpoint

This connects the existing protected controller to the real editor and calculation
owners. Add/Delete/Rename controls remain hidden. It is a development checkpoint,
not packaged UI, HTTP authorization, history-asset, crash/recovery or release
qualification. The full worksheet goal is not complete.

## Owners

`use-workbook-editor.ready` issues an exact Writer/journal/viewer-file/generation
lease. Closing invalidates it before draining. Lifetime ownership (`isOwned`)
permits the original frozen save intent to reconcile; operational qualification
(`isCurrent`) additionally requires a fresh source SHA and canonical validated
model, local Writer fences and current interaction permission. A recovered stale
or forged model stays inert until a checked authoritative ACK. Legacy receipts
and unsupported sources do not reactivate native actions. Recovered descriptors
never populate native issuer maps.

`WorkbookSurface` passes that lease to `WorkbookGrid`, which owns the controller
in its existing disposable kernel layers. The live guard includes edit permission,
focus/editor state, source qualification and the actual worker. Own-ACK retains
the same kernel; external source/kernel replacement retires its owners. The
private worker capability is configured outside workbook custom data and remains
fixed for that exact kernel. It is replica admission, not account, source-history
or native issuance authority.

Only the controller's already durable synchronous callback can enter the private
calculation sequence. Every actual input mutation must match its declared ID and
canonical parameters; only the pinned outer routing trigger is normalized.
Source/controller prospective state and every calculation-input intermediate are
budgeted before SDK mutation. The worker independently checks capability, unit,
kernel, epoch, sequence/count/index, exact command digest and before-input digest,
then prospective total geometry, axes, text and identities. Original unqualified
membership refusals remain in place.

The pinned main FormulaController emits a local normalization before the later
outer calculation listener runs. The exact next privately planned formula input
therefore owns that one synchronous normalization: same unit/sheet/coordinates,
exact formula/shared identity, and null cache clears only. Computed values,
wrong cells and after-scope messages do not qualify. The worker registers before
SDK listeners and checks its corresponding actual outer input. No formula result
or stored cache is promoted by this exception.

## Completion and failure

A typed `membership-applied` message proves the last permitted input actually ran.
It is distinct from scalar calculation. The latest exact ACK gates formula-free
completion; surviving formulas additionally require the existing fresh scalar
provenance. Older ordered ACKs cannot settle a newer operation. The existing
owned deadline bounds the wait; queued Undo/Redo remain possible. Save transport
waits behind this gate after preserving the real original pending intent, without
reserving a replacement. Removing a binding never restores an unguarded path.

Worker failure disables the grid and withdraws the Writer, retaining its journal
and recovery copy. The final drained copy includes preparation/render identities
that completed after abort; a retired generation cannot overwrite a newer one.
Kernel disposal releases the worker, sends the existing host-only STOP progress
notification, then disposes the SDK. This clears a real orphaned UI timer, not
calculated values or a worker result.

## Author evidence and remaining boundary

Actual production Node RPC tests cover source 17 / removed desired 19 / survivor
21, fresh dependent 40, Delete `#REF!`, Undo 19/fresh 40 and Redo `#REF!`; native
Add and immutable blank Redo; capability/unit/kernel/epoch/count attacks; bounded
Add before mutation; computed-value/wrong-cell normalization attacks; and actual
worker ACKs held/released through queued Undo/Redo, cancellation and scalar results.
Real hook/controller tests cover lease loss before pop, synchronous own-ACK render
ordering, external/legacy/unsupported withdrawal, stale/tampered recovery models,
checked reconciliation activation, quarantine, transport gating and late identity
drain. These receipts are stand-ins, not HTTP/history-asset evidence.

The genuine initial RPC refusal, stale cache 38 after blocked normalization,
extra-index permit acceptance, withdrawn-copy identity loss and pinned progress
cleanup failures were retained as local RED logs before their fixes. The recovery
qualification negative was also run against the development lease with its new
fresh-source guard removed; both cases failed, then passed with the guard restored.

**Open before UI acceptance:** a rejected whole-file History restore replaces
its Writer while retaining the SDK kernel. Exact private clean-resume/rebind
continuity is still required; it must not revive imported issuers or discard
legitimate native history. Origin-resolving Delete/Rename and protected root
retirement are separate reviewed producer work not yet integrated into this
checkpoint. Arrays/CSV, broader scalar/string own-ACK behavior, actual packaged
permission/lease/lost-ACK recovery and visual acceptance remain required.
No renderer build, stack activation, paid model call, publication or pin changed.
