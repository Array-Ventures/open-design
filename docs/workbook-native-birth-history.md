# Native birth history controller development checkpoint

Later actual [120/63 qualification](workbook-history120-qualification.md) covers
the existing editor and explicit manual historical-asset path. This record's
source/stand-in evidence keeps its original scope; live membership controls,
issued Delete/Undo and protected membership recovery remain unqualified.

Controls remain off. The controller is not imported or installed by WorkbookGrid.
This connects the real SDK Add/Undo/Redo path to the real Writer's pre-command
storage barrier; it is not full worksheet membership or application qualification.

## Owned dispatch and native data

The controller installs identity-scoped replacements for the exact known native
Add, Undo and Redo registrations, plus the existing scoped mutation owner. It
never mutates exported SDK commands, reads mutable native history items or keeps
a parallel history stack. Unknown registrations refuse; disposal restores only
its still-current registrations and leaves later owners intact.

Only its own successful protected Add issues a birth. The live issuer retains
that immutable blank configuration and insertion position, bound to the exact
SDK-owned native item ID. Recovered/imported metadata cannot issue it. Normal
nonmembership and internal Docs history delegate unchanged. Synchronous relevant
membership Undo/Redo refuses without scheduling async work; asynchronous facade
calls protect before the original handler can mutate or pop history.

The controller detects membership from actual top Insert/Remove IDs before using
metadata. Unknown and compound membership refuse, rather than delegating it
unprotected. For its supported native Add pair, the generic detached SDK data is
compared against the owned blank sheet/index/unit and known Remove factory data.
All unknown command/params keys refuse. Only outer params.trigger is normalized:
pinned CommandService rewrites it on Undo/Redo. Sheet-inner data is always compared.
Matching a token, item ID or imported shape alone is not authority.

## Writer and pending saves

Native Add Undo branches on the actual current source. A source-absent birth uses
its protected provisional removal; a source-present birth captures the complete
qualified current source deletion context. Native Add Redo uses the retained
original blank configuration, not a later selected removed 19/20 configuration or
historical template. It validates the exact prospective checkpoint through the
existing encoder while keeping an original pending intent/snapshot unchanged.
No hypothetical future target or quota reservation is created.

An optional synchronous pre-entry guard runs after awaited storage and the
Writer's existing source/revision/lease checks, before pool publication and command
entry. It rechecks native item/revision, focused history unit, registration,
issuer and complete payload. Focus/registration withdrawal or payload changes at
that point refuse without quarantining untouched edits. Once the SDK callback is
entered, unexpected mutations/false results still use the existing sticky
quarantine and retain the protected pre-command branch; there is no speculative
rollback or native history pruning.

## Actual source evidence

Fourteen cases use the real pinned SDK, native facade Undo/Redo and Writer. They
cover storage denial/no pop/exact retry, original blank Redo, frozen pending
creation Undo/Redo, source-present Undo after ACK, pending deletion ACK followed by
blank re-creation, focus/registration/controller withdrawal, edit→Undo ABA,
synchronous no-delayed-action refusal, unknown/compound history, and two separate
integrity attacks. A copied real birth token in another native item refuses before
execution. A retained public command-params reference can change the same item's
redo config without changing its item ID; both pre-call and during-storage changes
now refuse before mutation with unchanged data/history and no quarantine.

The preceding missing-producer path, copied-entry attack, public-params alias,
withdrawal phase and withdrawn Add-registration cases each had genuine failing
runs before their corrections. Source qualification passed 113 affected cases;
after test readability cleanup the final 14 controller cases, full fork typecheck
and guard passed. Receipts/targets are checked stand-ins. No actual HTTP/history
asset, protected IndexedDB recovery, contained worker or browser claim is made.

## Required next paths

Source-backed Delete Undo is explicitly refused until its selected removed
configuration, declared same-file historical asset and actual worker baseline
comparison feed the full source-preserving projector. It must preserve removed 19/20
separately from saved baseline 17/21. Membership worker input epochs/results,
rename/delete actions, pending/lost-ACK durable recovery and real packaged browser
behavior remain required. Arrays and CSV are not qualified by this scalar slice.

Exact retention retirement also remains: repeated Add Undo can create recovery
removal contexts while the one original native Add item remains reachable. Unused
contexts must eventually retire through existing pending/ACK/map roots and bounded
native inspection. Current retention is conservative and bounded; it never prunes
roots to force admission. This is not the completed feature or a readiness gate
that permanently disables history while an ordinary save is pending.

## Membership detection follow-up

The first controller implementation selected strings at parameter paths to detect
Insert/Remove operations. Missing both ID fields could therefore look like no
membership, allowing the original Undo handler to attempt its nested Remove.
The scoped mutation owner then refused it; no successful mutation was established.
Four real cases reproduced the incorrect delegation with a public command listener.

Detection now reads the generic frozen top mutation data first and checks actual
mutation IDs independently of params. A recognized membership operation cannot
fall back to ordinary delegation because its sheet ID is absent, undefined, an
array path or a nonstring. Shape, private issuer and complete payload checks follow
recognition. No SDK API was added. Seven new cases plus the original 14 controller
cases pass: nested mutation attempts stay zero, history/data remain unchanged, and
ordinary workbook asynchronous/synchronous Undo/Redo still works. An actual SDK
DocumentDataModel unit with a fixture body mutation also keeps native Undo/Redo
delegation without touching workbook cells. This is a source dispatch case, not
a browser Docs-editor or paste-mode qualification.
Full fork typecheck and guard also passed for this detection follow-up.

## Preserve the actual pending creation during prospective admission

Two real SDK/Writer regressions reproduced an admission error: after creation A
was frozen and Undo retained a pending-target removal, an unrelated Add or source
Delete was refused by a hypothetical replacement pending snapshot. That
replacement was never the request being saved and lost the original creation
association.

Prospective admission now validates the complete real checkpoint with only its
desired snapshot changed. The original pending intent, snapshot and retained
contexts remain exact. Prospective source-plan qualification still runs, and the
actual next request is independently encoded before transport; this is no future
quota reservation. No source, lease, revision or private history guard changed.

The three new cases cover both refused actions and an eventual checked stand-in
ACK sequence that converts the retained removal before saving the next target.
They use actual SDK commands and the existing Writer/journal, with stand-in
transport receipts. The source Delete fixture is a protocol seam, not live
pre-pop Delete Undo or historical asset authorization. The original two cases
failed before the correction. Final affected checks passed 123 cases in 15 files,
full fork typecheck and guard. Controls remain uninstalled; contained worker,
historical assets, recovery and packaged membership acceptance remain required.
