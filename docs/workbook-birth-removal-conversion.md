# Protected birth-removal conversion development checkpoint

Controls remain off. This connects the source-level Writer producer and receipt
conversion, not the complete live history/controller/worker/browser feature.
A newly born sheet can be removed while its creation save is pending: the exact
original intent and frozen snapshot remain unchanged, and the selected removed
configuration stays separate from the eventual actual target baseline.

The existing birth pool has a strict removal union. `unsaved` requires absence
from the current source and retained original pending snapshot. `pending-target`
binds the exact owned creation operation/source whose frozen snapshot contains
that birth. Both carry the birth token, original capture-source checksum,
generation-scoped removal descriptor and selected removed sheet/index. Metadata
is never native issuance or historical-file authority.

When a restored unsaved birth enters its first creation intent, every retained
record for that birth gains a separate creation association before pool and
pending snapshot are persisted together. Original capture checksums and removed
configurations are not rewritten. An unrelated checked ACK may carry unsaved
data only through the existing current source-snapshot binding, with the ID
still absent. No future target baseline or version is invented.

After the checked actual target exists, complete source/ACK qualification runs
once for the selected batch. The Writer atomically protects full saved-target
contexts, original removed configurations, origin metadata and pending ACK before
retiring its old source. Converted contexts use the actual target version and
checksum, not the pre-save version. Source retirement loops if protection or the
retained pool changes while receipt storage is pending. Unconverted roots remain
protected on uncertainty; no root is pruned to make a plan fit.

Nine real SDK/Writer source cases now cover creation17/removal19; multiple
removed19/20 roots carried through an unrelated ACK and then creation21; capture
after an unrelated ACK; pre-command storage refusal; an early ACK behind blocked
protection; lost ACK/storage failure with serialized recovery into a fresh SDK;
creation-association storage refusal; another removal during ACK persistence; and
newer edits during protection. Frozen intents remain unchanged, and the initial
blank native insertion configuration remains blank. Negative cases reject forged
tokens, old receipts and different operations even when their hashes match. A
fresh recovered kernel has no native issuance or serialized native history.

The original pending creation snapshot can be structurally rederived after its
provisional roots have converted only when the exact stored pending ACK, creation
operation/source, generation, scope, descriptor and birth marker agree. This is
data consistency, not authentication or native history authority. Actual receipt
reconciliation and authorized historical-asset access remain separate gates.

A failing storage-case run exposed an unhandled secondary rejection from the
coordination barrier. That barrier now settles on either outcome so ACK/close can
drain; the caller's original operation still rejects, and no SDK callback executes
on pre-command failure. No global rejection suppression was added.

Qualification: 99 affected cases across12 files, full fork typecheck and guard
passed. The quarantine-handoff fixture now explicitly declares its already
intended membership-qualified source. Its same two failures were reproduced on
the earlier approved checkpoint before this conversion work; missing/false
capability refusal assertions remain intact.

Targets, checked receipts and transport in these source cases are stand-ins. No
actual history asset, HTTP authorization, container or browser qualification is
claimed. The live pre-pop wrapper, full restored-source projection, membership
calculation epochs/results and end-to-end UI remain uninstalled/unqualified.
The complete existing128MiB prospective encoder is reused before native mutation;
this is not a future quota reservation or a guarantee after arbitrary later edits.
