# Native history entry identity development checkpoint

Controls remain off. The previous SDK checkpoint detects history changes during
awaited protection, but revision plus matching top metadata cannot bind an issuer
to its original native item across later history movement. An isolated controller
prototype demonstrated the gap: a different public SDK history item copied a real
issued birth token but changed its redo payload to999. The mutation owner caught
the changed result and quarantined it, but the forged data had already entered
the SDK. It must be refused before that invocation.

The frozen public checkpoint now adds nullable `undoEntryId` and `redoEntryId`.
A private SDK WeakMap associates actual native items with the already-advanced
service revision at each push. It introduces no second counter or stack. The
association is assigned to the actual final undo item after ordinary push,
grouped replacement/append or batching, before status publication. Legitimate
pop Undo/Redo movement preserves it; copied items, a new push of the same object
and grouped/batched payload replacement revoke the prior ID. A query neither
allocates identities nor mutates history. IDs are service-local consistency data,
not serialized authority, authentication or historical asset access.

A future live controller must record the exact native item ID only after its own
qualified command succeeds, and still require live issued descriptors, current
source/generation/kernel/lease, exact registration and a fresh post-storage
checkpoint. Imported metadata or an ID supplied in a recovered draft cannot
issue a native command. Unknown or multiple membership operations remain refused
until their complete compound flow is qualified.

The source cases establish native Undo/Redo identity survival, identical copied
payload distinction, same-object re-push revocation, grouped and batched changes,
and conservative service-revision invalidation from another unit. Actual ES/CJS/
compat entry loaders also cover empty focus and native movement. A further
negative found that a malformed empty-unit history bucket could make the earlier
query claim availability with no focus. Explicit empty focus now returns false
availability and null IDs, without changing that bucket or native dispatch.

The two new API cases failed on the preceding SDK because identities were absent;
the independent real controller forged-entry failure supplies the behavioral
reason. The malformed empty-unit case genuinely failed in all three runtime
variants before its query correction. Final qualification is42 focused cases
across6 files, full fork typecheck and guard. Standalone UMD is unconsumed and
unqualified. The application controller remains uninstalled; the prototype's
forged-entry case must pass with actual issuer binding before any readiness claim.
