# Automatic worksheet root-maintenance owner

This is an uninstalled source owner for the reviewed retirement protocols. It
does not enable worksheet controls or claim the actual footer Add/Delete/Rename,
packaged worker, browser, crash-cut or production flows are qualified.

## Lifecycle and scheduling

The kernel installer calls `controller.startMaintenance()` once and disposes its
returned handle with that lifetime. The controller's own disposal also stops it.
Native history-status and focus subscriptions mark work using only current
ownership, the O(1) history checkpoint revision and direct retained-record counts.
They do not copy a workbook, parse a model or enumerate full native history IDs.
Multiple marks coalesce into one idle callback (one-second bound), with a task
fallback when the browser has no idle API. There is no interval or periodic poll.

An eligible pass runs only under the current controller when neither its own
operation nor a Writer protected-sheet transaction is active. A remote pending
save is not a blanket exclusion: the existing retirement root/ACK barriers keep
that exact intent safe. Empty high-water metadata alone does not keep scheduling
new scans. Revision is only a cheap scheduling signal, never eviction authority.

Before a new protected Add/Delete/Rename or protected native replay, one marked
maintenance pass is awaited before factory/issuer preparation. The operation
then rechecks current/busy admission, so competing actions cannot both enter
after sharing a maintenance wait. Its completion marks a later idle boundary.
Storage failure keeps work pending for the next real boundary or explicit
action, but does not create an automatic failure loop. A genuinely new history,
focus or ACK mark during an attempt can earn one follow-up pass.

The actual checked source rebase/clean-resume consumer calls
`controller.requestMaintenance()` after its exact successful transfer. This is
an explicit installer integration requirement, not a new Writer listener or
polling owner. Callbacks read `this.writer` when invoked; they do not retain an
old Writer across a private rebind. `settleMaintenance()` drains both the active
protocol transaction and the scheduling promise bookkeeping, without starting
work, flushing, or closing a Writer.

A stopped scheduler rechecks its lifetime/quiescence again inside the queued
run microtask. Thus stopping between the idle callback and that microtask cannot
start a previously untracked protected operation after a History capture. Already
admitted operations retain the protocol's exact commit/rollback/quarantine path.

## Exact no-op path

A validated retirement candidate identical to the existing complete checkpoint,
with every private issuer still retained, needs no durable/private/native change.
After its exact owner checks it returns without another guarded draft write or
SDK metadata application. Anything that actually prunes a pool or private map
still uses the reviewed guarded storage protocol. No quota or owner check is
weakened to take this path.

## Author qualification

The initial three actual-SDK automatic-owner tests failed because the API was
absent. They now prove native history clear triggers cleanup without a user
calling retirement, a 60-command burst coalesces without full-ID scans before
idle, and a new protected action awaits cleanup before resource admission.
The latter preserves numeric high-water: the next birth is 5, never reused 4.

Expanded cases prove scheduler disposal, real native focus defer/return,
storage failure without spinning plus later retry, pending creation preservation,
task fallback, competing action serialization and the explicit checked-ACK mark.
The ACK fixture uses the existing membership-result stand-in. Idle delivery is
controlled for determinism, while SDK history/focus events and IndexedDB writes
are real implementations over isolated `fake-indexeddb`; no fabricated native
state messages stand in for those events.

An additional genuine RED found stop-after-idle/before-run-microtask admission.
The final lifetime check fixes it. A first instrumentation attempt could not
spy on a DI proxy's virtual method; the final test observes the actual
`LocalUndoRedoService` prototype and positively requires that instrumentation to
fire during the later scan.

The broader **239 cases in 18 affected files**, full workspace types and guard
passed before the final cancellation check. Final matching **50 cases in three
suites** (11 owner, 20 selector, 19 retained-root), full workspace types and guard
pass on the final source, all terminal zero. Receipts:

- `/tmp/workbook-maintenance-owner-red.log`: three initial genuine REDs.
- `/tmp/workbook-maintenance-owner-stop-red.log`: genuine queued-stop RED.
- `/tmp/workbook-maintenance-owner-qualified.log`: broader 239/18.
- `/tmp/workbook-maintenance-owner-final.log`: final 50/3.
- `/tmp/workbook-maintenance-owner-final-types.log` and `...-final-guard.log`.

The installer must still start/stop this owner and mark the exact checked
rebase/clean-resume boundary. Public SDK footer Add routing and real combined
consumer validation are separate required work; these source tests invoke the
owned producer, not a rendered footer. No stack, preview, image, publication,
installer pin or real unit changed.
