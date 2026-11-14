# Source Delete native history checkpoint

This source slice connects privately issued source Delete actions to the existing
Writer, source-preserving restoration projector and historical-asset declaration
path. `WorkbookSheetHistoryController` remains uninstalled. It is not packaged
worksheet UI, HTTP authorization, contained-worker, crash-recovery or release
qualification. Recovered descriptors never issue a native history action.

## Command and durability ownership

`remove()` enters the normal public SDK `RemoveSheetCommand`, preserving existing
command permission vetoes. Its scoped replacement captures the actual current
source/acknowledged baseline and the separately removed desired configuration and
position. The Writer snapshot must equal the live snapshot. Factory output must
equal that exact captured removed configuration before annotation.

The pinned command has no public prebuilt-payload admission seam. The replacement
therefore uses public `RemoveSheetUndoMutationFactory` and
`SheetInterceptorService.onCommandExecute` exactly once, retaining the native
pre/main/post mutation order. It does not invoke interceptors twice or replace
their service methods. The selected native configuration gets the existing
deletion marker only inside the protected callback, after durable admission.

The bounded pure projector admits one Insert/Remove plus same-workbook scalar
formula-reference patches. It retains all other cell properties and mirrors the
pinned formula producer's stale scalar-cache clearing. Unsupported dependency
families refuse before command entry. Names, tables, arrays and CSV retain the
existing qualification restrictions; ordinary cross-sheet formula dependencies
are supported rather than rejected as arbitrary compound history.

The existing mutation owner checks its exact immediate membership result. The
Writer additionally checks the complete formula-updated result. There is one
existing SDK history item, not a second checkpoint stack: a private issuer map
binds its exact native entry ID and complete detached mutation payload. Only the
SDK's outer routing `trigger` is normalized during comparison. The public native
item and interceptor references cannot replace the privately retained payload.
The native checkpoint must remain unchanged until the producer's one owned
history push; replay must move that exact item once to the opposite stack.
Unexpected history changes inside native callbacks quarantine even if cell data
alone happens to match. Three deliberate listener regressions genuinely resolved
successfully before these stricter post-callback checks were added.

The replacements are identity-scoped. A conclusively unrelated workbook keeps
the original native Delete handler, including synchronous entry and ordinary
Undo/Redo. Its explicit membership mutations delegate only when no owned ticket
or callback is active. Owned or ambiguous targets never use that fallback. Both
unrelated-unit entry modes genuinely failed before this correction.
The callback boundary covers the entire pre/main/post sequence, including later
formula mutations after the membership ticket has been consumed. Three real
listener regressions exposed foreign-sheet removal during that later stage;
the whole-run guard now refuses the foreign mutation and quarantines the entered
owned callback while preserving its protected pre-command draft.

Undo/Redo persist the existing checkpoint before native history can pop. They
retain its original pending identity, plan and snapshot. A checked deletion ACK
associates the retained baseline with the existing exact pre-save historical
version. Undo restores removed desired19 against source baseline17 while retaining
survivor21. If Undo occurs while deletion is pending, the deletion finishes first
and the next ordinary save derives `origin: restore`, the same-file template and
baseline identity through the existing projector. No speculative future save or
historical access grant is allocated. Native ownership, lease, source, revision,
registration, focused unit and payload are rechecked after awaited storage.

The existing caller-supplied current-owner check remains mandatory; installation
must bind it to the live editable/authorized kernel. Native command veto coverage
here does not claim a complete application permission or revocation acceptance.
Unexpected post-callback effects retain the existing sticky quarantine; no
speculative native rollback or history pruning was added.

## Native factory scope and limits

The protected producer retains the complete native factory configuration within
existing100000-cell geometry, model, recovery-byte and context-pool limits.
A6001-cell case proves storage denial leaves history/data intact and a successful
Delete Undo restores every cell. Those cells occupy301 stored rows; this is a
large-payload test, not qualification of the SDK's history-clearing threshold.

Independent review corrected the earlier interpretation: pinned SDK1.4.0's
`countCells` helper counts stored row keys, not populated cells. Its default6000
threshold is therefore not crossed by this fixture. Reaching6001 rows with the
ordinary minimum26-column reader window exceeds the existing100000-cell geometry
limit. The producer does not implement native threshold-driven history clearing,
but that divergence is unqualified here; no budget was loosened to fabricate a
threshold proof. Earlier passing6001-cell results remain valid only for payload
preservation. No truncation or quota bypass is used.
Retention remains conservative and bounded; unused historical contexts/native
issuer associations still need the existing-root retirement qualification.

The new live path also exposed an existing optional-theme comparison error:
`canonicalCommentJson(undefined)` refused two genuinely absent theme descriptors.
Absence now compares explicitly; absent versus defined themes still differ.

## Author qualification

The first actual SDK/Writer behavior test genuinely failed because no live source
Delete issuer existed. The unchanged original SDK was separately characterized
with a dependent cross-sheet formula. The implemented small-source producer
matches its native mutation sequence, survivor data, order and active selection,
apart from its explicit protected annotation and outer routing normalization.

Twenty-eight new real SDK/Writer cases cover Delete/Undo/Redo, source17/removed19/
survivor21, storage denial and exact retry in all directions, checked stand-in ACK
transfer, unchanged pending deletion through Undo/Redo, Undo across a pending
deletion ACK followed by the exact next restore plan, public command veto,
6001-cell preservation, copied entry IDs, interceptor-reference detachment,
same-item payload aliases before/during storage, focus/lease/registration/controller
withdrawal, edit/Undo ABA, absent-versus-defined theme identity, protected native
history side effects, foreign-unit mutations during the later formula stage,
unrelated-unit delegation, owned sync/ambiguous refusal
and active-versus-inactive target selection. Stand-in transport receipts are explicitly not
HTTP/history access evidence.

Focused author qualification passed125 tests across seven source suites, including
existing birth history, membership mutation ownership, restored styles, deletion
contexts and Writer regressions. The source Delete suite contains28 cases. Full workspace types,
guard and the final web typecheck passed. No package, stack, model call, production
change or installer pin was made. Installation and actual packaged authorized
Delete/save/pending/lost-ACK/Undo/Redo acceptance remain the next gates.
