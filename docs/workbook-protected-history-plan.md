# Protected worksheet history controller plan

Development only. The membership controls and this controller remain uninstalled.
The preceding producer checkpoint does not yet qualify native pending-save Undo
or Redo, formula-worker membership, historical restoration or browser behavior.

## Native pre-invocation boundary

The initial candidate is the owned kernel's public `ICommandService.replaceCommand` to replace the
exact exported Undo/Redo registrations with scoped `asyncOnly` commands. This is
conditional: full UI plugin registration must prove no multiple implementations
are displaced. The existing multi-command replacement refusal stays strict; a
pre-dispatch seam may be needed instead. Never
modify exported command objects or read native mutable history items. Pinned
keyboard, toolbar and facade paths use `executeCommand`; synchronous invocation
must refuse before calling the wrapper, with no delayed replay.

The existing primitive top-token projection identifies retained descriptors, but
is not a revision: identical tokens/counts can recur, grouped entries can change,
and `rollback` changes actual history without emitting `undoRedoStatus$`. A real
SDK probe confirms one undo entry becomes zero without another status emission.
The maintained core patch now adds a narrow public frozen checkpoint query:

```
getUndoRedoCheckpoint(): {
  readonly unitId: string;
  readonly revision: number;
  readonly undoAvailable: boolean;
  readonly redoAvailable: boolean;
}
```

The SDK owns a monotone service-local revision advanced on actual pushes,
grouped/batched payload replacement, clears, pops and successful rollback. No
history entry, object identity or mutable payload escapes. Service-wide changes
may conservatively invalidate another unit's pending action. Safe-integer
exhaustion refuses; disposal refuses inspection. The reported unit follows the
same editor/context resolution as native Undo, including cell/formula documents.
A workbook wrapper delegates unrelated editor history without inventing worksheet
authority, and cannot cross focus/context changes after an await.

## Awaited protection and exact native execution

Capture the checkpoint, current Writer/source/lease/generation and bounded top
metadata. Resolve only descriptors issued by this live controller and rooted in
the existing protected pools. Persist the exact prospective full checkpoint
before invoking native history. Recheck owner registration, lease, focus unit,
Writer revision/source, checkpoint and descriptor reachability after storage.
Interleaving, registration replacement, same-ID resurrection or owner withdrawal
must refuse before the native handler or stack movement.

Inside the Writer's synchronous protected callback, arm the existing mutation
owner ticket and invoke the original handler exactly once. Preserve original
command params/options and RPC behavior. Native false/throw, unexpected metadata
or changed results enter the existing sticky quarantine; no speculative rollback
or history pop is performed by application code. Intermediate Writer publications
remain suppressed only during that synchronous callback. Cleanup uses scoped
registration handles and does not overwrite a newer owner.

## Births, removed configurations and pending saves

Native Add redo must retain its immutable original blank configuration. A Delete
undo instead restores its actual selected removed configuration (for example19
or20), separately from the checked saved-target baseline17/21. Direction and the
actual top descriptor select this behavior; current names or imported metadata
cannot authorize it. Full historical restoration still requires exact declared
same-file assets and worker baseline comparison.

Pending plans and snapshots stay frozen. New protected contexts may survive an
original pending ACK only through the checked receipt/source binding and durable
conversion before old-source retirement. The controller must support pending
Save→Undo→Redo, not permanently disable history while ordinary autosave runs.
Lost ACK, quota/lease failure and early receipt ordering must leave the exact
original intent and all recovery roots intact. Reload starts new native history;
stored descriptors remain data and cannot issue native authority.

## Required proofs before installation

Use real pinned SDK tests for denied protection/no pop, direct async facade,
keyboard/toolbar dispatch, sync no-delayed-action, entry ABA/group replacement,
rollback, nested entries, another edit during storage, focus/registration changes,
close/dispose, malformed metadata and post-command quarantine. Then qualify
actual worker membership input epochs/results, protected recovery, checked history
assets and packaged light/dark browser Save/Undo/Redo. This plan is not proof of
any of those unfinished paths.

Source qualification: three pre-patch API regression cases failed because the
query was absent; a separate actual SDK probe established the rollback/status
gap. The implemented checkpoint and existing related boundaries pass29 focused
cases across4 files. No controller or complete UI kernel qualification is claimed.
