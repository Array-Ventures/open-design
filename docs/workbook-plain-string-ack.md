# Plain-string source acknowledgement

## Observed failure

The owned 124 browser fixture saved typed `19K` from B2 as OOXML `inlineStr`.
The UI then replaced its live grid and lost native Undo continuity. Read-only
journal capture showed `{s:'1',t:1,v:'19K'}` with no rich document. Independently,
the real pinned SDK's `setValue('19K')` produced `STRING` (1), whereas the actual
saved-file reader plus grid adapter imported the same value as `FORCE_STRING`
(4). `assertWorkbookSourceSnapshotInputs` rejected those otherwise matching
inputs. The supplied two-sheet XLSX's complete reader model was also compared
against an actual SDK edit from numeric 12 to `19K`; the corrected comparison
passes with source styles and other cells unchanged.

## Bounded correction

Only the source-snapshot comparison's detached source copy reconciles these
types when the source is `FORCE_STRING`, the ACK is `STRING`, both are identical
plain string values, and neither has a formula or rich document. The live SDK
snapshot and global calculation-input digest remain unchanged.

The pinned formula engine's `getCellValueObject` treats its error-token set
specially: `STRING` can produce an error while `FORCE_STRING` preserves literal
text. Every token in the actual exported `ERROR_TYPE_SET` therefore remains a
strict mismatch. Changed values/types/formulas and rich content remain strict.
This does not extend equivalence to rich strings or unknown SDK representations.

## Evidence and limits

The new actual-SDK positive assertion genuinely failed before the correction;
all 16 negative assertions passed. The positive now preserves the exact native
history checkpoint and live snapshot, then successfully Undoes to 12. The
existing scalar display source-rebase test also covers both numeric 7 and string
`19K`, preserving the same unit and native Undo/Redo. This is source/SDK evidence,
not a new packaged browser qualification or a general history-continuity claim.

Final author checks pass: **69 cases in four affected suites**, full workspace
`pnpm typecheck`, and `pnpm guard` (all terminal exit zero). Two intermediate
typecheck failures identified incomplete rich-negative test metadata; its required
SDK document ID/style are now present, with the refusal assertion unchanged.

Scratch receipts (owned fixtures; no credentials):

- `/tmp/workbook-string-ack-red.log`: 1 failed / 16 passed before correction.
- `/tmp/workbook-string-ack-probe.log`: actual reader cell plus original SDK mismatch.
- `/tmp/workbook-string-ack-actual-reader.log`: complete actual two-sheet reader versus SDK snapshot comparison PASS.
- `/tmp/workbook-string-ack-focused-qualified.log`: final affected suite.
- `/tmp/workbook-string-ack-types-qualified.log`: final workspace types.
- `/tmp/workbook-string-ack-guard.log`: guard.

At that source-only checkpoint, no stack, package, worker, UI controls, source
XLSX bytes, or live preview changed.
The adjacent one-line Add cleanup separately moves checkpoint capture inside its
existing `try` so an unavailable checkpoint cannot leave `busy` latched; the
reviewed `617a7990` checkpoint remains frozen in its original worktree.

## Packaged manual qualification: candidate 125 / renderer 68

The isolated Evebot preview on port 6261 uses companion source
`9aea7727f21e70915445b2b81fe2f34c57009c46` (keyboard source `4f20994c` plus
only this plain-string correction), build
`ff414b8a9846840c8e37876d0f7af985b4f12c63da47f01d6f0e3232df1993f1`,
and renderer
`sha256:a65f896fce4aff0c67979af3fc8ca38aa81d4c8f2a8028df76841192bf29bd1e`.
Full inventory, clean source/provenance and actual contained image checks passed.
All five renderer payloads match candidate 124. Activation changed only three
Studio selectors; other configuration bytes and existing data were preserved.
The later PR source is byte-identical in production files, while its documentation
and main-branch ancestry differ from the immutable package source.

Manual Chromium interaction now passes the previously failing sequence:
numeric 12 → typed `19K` → Save → Undo → 12 → Save → Redo → `19K` → Save
→ Undo → 12 → Save. Each save completed through the actual application. The two
string readbacks independently contain B2 `inlineStr` text `19K`, local SUM cache
0 and the cross-sheet reference's string cache `19K`. Styles, row height, header,
main namespace bindings, package part set and all unrelated part bytes remain.
Every OOXML part after each Undo matches the pre-125 numeric-12 baseline; every
part after Redo matches the first string save. Archive timestamps are not used to
claim byte equality across separate saves.

Dark screenshots show the typed string, Undo and Redo; Light inspection confirms
readable saved text. Another Undo after the Redo save and theme switch succeeds.
Read-only theme operations leave the final saved archive bytes unchanged. Cleanup
restored numeric 12, Dark, the first sheet and 100% zoom and closed the browser
normally. No chat message was sent. Private screenshots remain outside the repo.

The integrated frozen source passed **122 cases across nine files**: 82 cases in
the first seven files plus 40 in the two remaining ACK boundary files. This covers
the original 34 keyboard and 69 ACK cases plus 19 additional grid cases. Frozen
installation, full workspace types and guard also passed. These are author checks;
independent reviewers did not repeat tests.

Receipts: `/tmp/workbook-plain-string125-pair-receipt.json` and
`/tmp/workbook-plain-string125-browser/qualification.json`, with exact raw ZIP
oracles and screenshots beside the latter. This is one plain non-error string
fixture, not rich-text equivalence, native history persistence after reload, new
worksheet membership controls or the complete artifact matrix. Installer pins,
distribution and production remain unchanged.
