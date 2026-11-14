# Obsolete worksheet selector retirement: guarded metadata protocol

This is an uninstalled source protocol checkpoint. It completes cleanup of
proved obsolete removal selectors, alongside the earlier unreferenced-record
retirement, but does not install worksheet controls or automatic maintenance.
An automatic coalesced owner and runtime hookup remain the next checkpoint.
Actual packaged crash cuts/browser/worker qualification remain required.

## Eligibility and identity

A candidate must be an exact privately issued removal descriptor. Its sheet is
absent from the current source model, live SDK, acknowledged and desired views.
Any same-sheet reachable native birth/Delete/Rename, present-origin/ancestor,
pending snapshot/intent/creation/template or ACK-conversion root retains it.
Only the specific tentative selector references are ignored while recomputing
that closure; arbitrary birth/deletion origin markers are never cleared.

Live, ACK and desired candidates differ only in the workbook's removal-map
field. Pending snapshot and intent are unchanged. The full old/new draft decoder
and typed ordinary edit plans must agree. If ACK metadata changes, the old
source snapshot binding must first validate against its already checked receipt;
only that binding's ACK snapshot hash is rederived. No new receipt, source
version, historical authorization or native history item is created.

The source helper is pure retention data. Only the live private controller can
supply the current kernel/native/source/lease checks and apply the candidate.
Decoded contexts and copied native payloads do not acquire issuance.

## One transaction, one exact native metadata application

The existing internal `WorkbookJournal.saveGuarded` now takes an owning options
object `{ guard, beforeCommit? }`. All actual providers are updated together.
This deliberately does not advertise compatibility with old adapters that drop
the apply callback; the options type catches old positional guard forwarding.
The same existing draft-store transaction handles both payload and head.

After the final successful IDB request, one synchronous event turn runs the
private guard, exact SDK metadata application, corresponding Writer ACK/desired
metadata and binding assignment, then explicit transaction commit. There is no
source XLSX write, formula result message, native history push or layout action.
Full old pools remain in memory until the transaction completes; only a durable
commit permits pool/private-issuer pruning.

The operation holds a private rollback lifetime independent of focus/lease
visibility. An abort restores only the removal-map field on the exact still
registered kernel with its original controller handles, structure generation,
source epoch and exact applied map. All later cell and unrelated custom data
remain intact, including custom changes without a command observer. Writer
desired state is taken from that verified restored SDK snapshot; ACK metadata
and its prior binding are restored separately. No whole-live-snapshot rewind
is used.

Disposal, replacement or an unknown applied map ends that rollback authority.
No replacement kernel is touched. The Writer keeps the full original protected
branch under its existing sticky worksheet quarantine and recovery copy. The
aborted IDB transaction retains the old whole durable branch. After a successful
commit followed by focus/lease loss, live and Writer metadata stay on the new
committed branch and pools stay reduced; extra private maps cannot resurrect
origins from removed pools, and copied item IDs still refuse.

A crash destroys the transient SDK either way: the atomic IDB transaction
leaves the complete old or complete new checkpoint. The source tests inspect
and decode both whole transaction branches; they are **not** real process-kill
crash tests or consumer qualification.

## Clean-resume coordination

`settleMaintenance()` is a read-only rejection-settled drain spanning the current
retirement operation, rollback/persistence and controller busy cleanup. It
starts no work and does not flush or close a Writer. A History gate can withdraw
operational admission, await this drain, then capture its independently checked
clean-resume ticket. No private issuer is reconstructed from recovery data.
The separate clean-resume integration must forward the entire guarded-save
function; no hook constructor/rebind code is changed here.

## Author evidence

Two initial real-SDK assertions genuinely failed before the new API existed.
A separate drain assertion also genuinely failed before that API existed.
The protocol cases run real SDK commands and the actual draft-store transaction
over isolated `fake-indexeddb`, including injected commit failures **after** live
metadata application. Those injected quota/commit exceptions are deterministic
storage-boundary simulations, not an actual Chromium disk-quota experiment.

Coverage includes abandoned unsaved birth cleanup, retained native Redo,
quota/commit abort, later scalar and unobserved custom changes, focus/lease
withdrawal, unmount/replacement quarantine, successful commit followed by
focus/lease loss, old/new whole-checkpoint decoding, copied-origin refusal,
checked saved-deletion binding, pending identity preservation and clean-resume
drain. The checked ACK uses the existing documented membership-result stand-in,
not a new actual worker or HTTP receipt proof.

The tests uncovered a separate pre-existing clean Add→Undo persistence defect:
`sheetBirths` had been omitted from generic persistence. The narrow standalone
correction is incorporated unchanged from `4e7cd5e6` (`4dc6f0d2` here); it is not
an incidental change hidden in this protocol.

Receipts are `/tmp/workbook-selector-retirement-{red,drain-red,options-drain,options-types,options-guard,protocol-qualified}.log`.
No stack, preview, image build, release, installer pin or production changed.

Qualification checkpoint: **226 cases in 17 affected suites** passed before the
last three ownership-negative tests and removal-purpose restriction. The final
**20 selector-protocol cases** pass with that restriction; full workspace types
and guard pass on the final source, all terminal zero. Final receipts:
`/tmp/workbook-selector-retirement-final-{protocol,types,guard}.log`.
The additional negatives cover preapply history/lease withdrawal and the inability
of a newly recovered controller to clear selectors using decoded pool data.
