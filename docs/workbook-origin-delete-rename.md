# Origin-aware Delete and protected Rename

This is an **uninstalled source checkpoint**. Direct Delete now resolves current
source sheets, privately created unsaved births and privately restored unsaved
sheets. Rename and its native Undo/Redo use the same protected native sequence
owner. No UI, worker implementation, package or runtime was installed here.

## Private origin and retained data

A source-present target captures the current qualified baseline as before.
A source-absent target requires a private live issuer, exact selected descriptor
and matching retained data. A name or copied custom marker is insufficient.
Replacing the controller cannot promote persisted birth/deletion contexts into
native issuers, even when the same SDK kernel and native items still exist.

Restored re-deletion derives a fresh descriptor and the **latest complete removed
configuration and position**. Its historical baseline, acknowledged sheet, raw
template checksum, receipt/version association, scope, axis owner and any birth
creation association must remain identical to its uniquely selected ancestor.
The Writer admits this explicit same-backing derivation, not a general exception
for stale source checksums. A mandatory private pre-entry guard runs again after
awaited storage. The existing same-file host authorization and actual worker
historical-baseline comparison remain independent consumers of the derived plan.

Unsaved birth Delete uses the existing provisional removal pool. Its Undo restores
the removed desired configuration, including later edits, instead of replaying
the original blank Add. The original Add item still owns its separate immutable
blank configuration. If creation is pending, the original intent/plan/snapshot
remain exact. Checked creation ACK conversion binds that same removal to the
saved-target template while retaining its later removed values. Restoration and
another Delete can proceed across that conversion without a speculative save.

The tests distinguish historical baseline 17, removed value 19, latest restored
value 23 and unaffected survivor 21. Another case distinguishes pending creation
value 19 from removed 23 and a subsequent privately restored value 25. Native
style and inserted-axis configuration are retained through direct Delete Undo.
Those assertions inspect real SDK state, not a rendered XLSX readback.

## Rename and sequence ownership

The scoped replacement keeps normal public command permission vetoes. The pinned
Rename command's tiny Undo factory is private, so the bounded producer constructs
the same exact `unitId`, `subUnitId`, `name`, `oldName` fields and invokes the public
sheet interceptor once. A separate unchanged SDK instance verifies identical
native payloads and complete output, including apostrophe escaping in cross-sheet
formula references. Existing worksheet-name, identity and case-collision policy
is reused. A no-op creates no storage write or history item.

Delete and Rename share native sequence projection, the exact mutation ticket,
the Writer's durable history barrier and private item-ID/full-payload checks.
Unknown own-unit Rename items refuse before pop. Ordinary unrelated-workbook
Rename/Delete delegates unchanged, while foreign membership/name mutations
inside the entire owned pre/main/post callback are refused. Unexpected entered
callbacks keep the existing sticky quarantine and protected pre-command draft.
The calculation adapter receives the already computed final snapshot and exact
native input sequence; derived formula-cache mutations retain their separate
consumer guard. This constructor seam alone does not install that consumer.

## Bounded retention, not retirement

All private descriptor, birth and native-history issuers have pre-entry count
and canonical UTF-8 byte admission. The existing 4,096 context count and 128 MiB
draft byte caps are reused; per-value JSON bounds also remain unchanged. Native
entry IDs reserve their maximum integer serialization before SDK entry. Quota
refusal does not mutate or pop history and does not quarantine untouched edits.
Disposal clears the private maps, tokens and byte ledger.

**At source checkpoint `20038fee`, reachable-root retirement was not implemented.**
The later [unreferenced-root checkpoint](workbook-protected-root-retirement.md)
adds conservative retirement while leaving obsolete-selector cleanup and
automatic maintenance open. There is no timestamp/revision
eviction heuristic. A private restored origin may remain needed after an edit
clears its original SDK redo item; future retirement must include live selected
origins and protected pending/draft/template roots, not only native stack entries.
The conservative quota is temporary source protection, not completion of the
full UI feature. Actual retirement remains required before controls release.

## Qualification and remaining gates

The initial actual SDK/Writer cases genuinely refused source-absent Delete and
had no protected Rename method. The corrected cases exercise pending creation
and restoration ACKs, latest value/style/axis preservation, copied markers,
controller replacement, immutable backing, stale selected data, payload aliases,
storage denial/retry, focus/lease withdrawal, native Rename equivalence, no-op and
invalid names, unrelated units, foreign callbacks and private resource admission.
The resource-denial integration cases inject admission failure; separate pure
tests verify the real count and UTF-8 byte boundaries without allocating 128 MiB.

Transport previews and receipts in these unit cases are checked **stand-ins**.
The scalar result helper explicitly refuses style/axis conversions; it is not a
worker, reader or authorization substitute. No new actual historical HTTP access,
contained conversion, crash recovery, browser behavior or publication is claimed.
Existing CSV, names/tables and array qualification restrictions remain.

Final author qualification passed **168 cases across 11 focused suites**, full
workspace types and guard. This includes 20 origin cases, 14 Rename cases, five
private-budget cases and four sequence-adapter cases alongside the existing
source/history/Writer suites. The initial row-insertion fixture incorrectly used
synchronous dispatch for an asynchronous SDK command; that harness failure was
preserved and corrected before the proper source-absent Delete baseline RED.
Next gates are the actual main/worker consumer, exact protected-root
retirement, then matched packaged UI and authorized save/recovery qualification.

## Add native-history ownership correction

The frozen `20038fee` source checkpoint did not bind Add across its awaited
journal write or verify that the native handler pushed exactly one history
entry. Four real-SDK regressions failed against that checkpoint: a public
Insert command listener could copy the freshly pushed birth item into another
native item that the controller adopted; a history-only push during Add's
storage wait was accepted; and birth Undo/Redo callbacks could add unrelated
history entries without quarantine. These are controller ownership defects,
not worker or packaged-browser results.

The correction captures and rechecks the original checkpoint before native
entry, and shares exact one-revision push/transfer assertions with Delete and
Rename. A pre-entry history change refuses without changing workbook data or
quarantining. Unexpected history changes after the native callback quarantine
and retain the protected pre-command recovery snapshot. Exact birth payload
validation still applies after the original entry transfers between stacks.

Author checks: all four regressions are now green; the complete affected suite
passes **172 cases in 12 files**, full workspace `pnpm typecheck` and `pnpm guard`
exit zero. Receipts: `/tmp/workbook-birth-history-ownership-red.log`,
`/tmp/workbook-birth-history-correction-focused.log`,
`/tmp/workbook-birth-history-correction-types.log`, and
`/tmp/workbook-birth-history-correction-guard.log`. This remains uninstalled
source qualification with the same stand-in transport and retention limits
above; it does not qualify real worker/SDK integration or private-root retirement.
