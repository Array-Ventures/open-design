# Writer ownership during workbook kernel recreation

A same-source grid/kernel recreation must call `onSnapshot` synchronously with
its final raw grid snapshot before disposing the old kernel. It then seeds the
replacement kernel from that same raw snapshot and awaits `onReady` before
allowing edits. This boundary assumes an unchanged source-array/projection model;
it does not authorize rebasing a different calculation projection.

`useWorkbookEditor.ready` aborts and drains the retiring writer before reading
its final checkpoint. Only the identical project, file, exclusive recovery-journal
object and checkpoint source digest can carry that checkpoint into the new writer.
The journal identity is the viewer/lease fence; the live surface always supplies
one. A caller without a journal has no authenticated lease identity and therefore
cannot automatically carry an in-memory checkpoint. Normal explicit journal
recovery retains its existing conflict checks.

The carry preserves acknowledged and desired snapshots, the pending snapshot,
operation/preparation/render/preview identities and the existing journal save
function. It reads after the drain because the last transport preparation callback
can still update and persist those identities after abort. Concurrent ready calls
share the retiring writer's handoff; only the latest valid generation installs a
writer. Access loss, lease/account changes, source changes and stale ready callbacks
do not revive it. Public close, pause and discard keep their existing drain and
ownership fences, and explicit discard cancellation uses a scoped resume.

`workbook-kernel-checkpoint.test.tsx` verifies an active save with a late render
identity callback, a newer user edit during that save, exact retry identity after
kernel replacement, concurrent replacement attempts, stale-source/account/project/
file callbacks and access loss during retirement. Transport is mocked; no services,
browsers, provider calls or credentials are used. The Grid owner separately verifies
kernel teardown, final snapshot capture and stored-kernel recreation.
