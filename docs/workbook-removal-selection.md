# Retained worksheet removal selection

Development checkpoint only: worksheet controls, membership calculation admission,
full historical restoration and pending birth/removal conversion remain off.
This integrates the native owner's selection data with the existing Writer plan
and draft decoder; it does not install that owner or grant native history access.

A sheet can have multiple retained removal contexts. A previous pending snapshot
may still need context1 while the current desired snapshot selects context2 for
the same numeric ID. The projector formerly required one matching context across
the whole pool, so adding the second context made even the first frozen pending
plan impossible to rederive. Pruning the older context would lose that original
pending ownership.

The same pure helper now validates each snapshot's map against the retained pool:
absent numeric ID, exact token, current explicit caller scope, editor generation
and original axis owner. It does not infer scope from serialized contexts. Every
entry is checked, including entries unrelated to the current source projection
and no-op desired snapshots. The decoder checks acknowledged, desired and pending
snapshots. Ordinary unsupported desired edits remain conservatively recoverable;
this change does not force every recovery branch through full edit-plan admission.

For an actual source deletion, existing current-source or checked carried-source
eligibility and complete source baseline checks still run after token selection.
The selection cannot bypass those checks or authorize a historical file. Missing
legacy maps retain the existing unique-context rule; ambiguous legacy pools
still refuse. No wire schema, save intent, native command stack or source bytes
are changed by the map itself. The SDK registration owner imports the same pure
metadata functions rather than introducing registration runtime into the decoder.

The actual SDK/Writer regression starts one protected Delete and pauses its
stand-in transport. Native Undo restores the sheet, then another protected Delete
retains its separate context. Both original pending intent/snapshot and contexts
survive; the checked stand-in ACK completes with exactly one write. Native
history pre-pop protection is explicitly not qualified by the direct test seam.
Before the fix the real draft encoder rejected the second context while
rederiving the first pending plan. Negative cases cover dangling/unused map
references, foreign scope/generation/source, missing caller scope and unchanged
legacy ambiguity. No reference is silently discarded.

49 focused cases across five files, full repository typecheck, guard and diff
check passed. No companion/image, live browser, host-history acquisition or
protected recovery qualification is claimed here.
