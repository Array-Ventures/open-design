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

No stack, package, worker, UI controls, source XLSX bytes, or live preview changed.
The adjacent one-line Add cleanup separately moves checkpoint capture inside its
existing `try` so an unavailable checkpoint cannot leave `busy` latched; the
reviewed `617a7990` checkpoint remains frozen in its original worktree.
