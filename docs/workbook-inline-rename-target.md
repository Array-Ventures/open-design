# Inline worksheet Rename target

The pinned sheet-bar `onEdit` callback dispatches `SetWorksheetNameCommand` with
`subUnitId` and `name`, omitting `unitId`. The protected handler previously
rejected that legitimate shape even when the SDK resolved the exact privately
owned workbook. The qualifying baseline fails one actual SDK assertion while
the two permission/foreign-owner negative controls pass.

The handler now requires that resolved workbook to be its exact owned instance.
An explicit `unitId` must still match. Unknown fields, target/name validation,
source qualification, private issuance and durable native replay remain strict.
Normal public permission interception runs first; another focused workbook's
implicit Rename delegates unchanged. Native mutation payloads still contain the
explicit owned unit ID.

The new cases execute the real SDK command, verify cross-sheet formula rewriting
and actual Undo/Redo, preserve unrelated-workbook behavior, and require the native
permission veto (`false`) plus unchanged data/history for a missing explicit unit.
An exploratory assertion incorrectly expected that veto to reject; it was
corrected to the SDK's exact false-return contract before the qualifying RED run.

All **41 cases in four affected suites**, full workspace types and guard pass.
Receipts: `/tmp/workbook-inline-rename-baseline-red.log`,
`/tmp/workbook-inline-rename-green.log`, `/tmp/workbook-inline-rename-types.log`
and `/tmp/workbook-inline-rename-guard.log`. The frozen install also completed.

This is source/SDK qualification. The protected producer remains uninstalled in
the owned preview; no rendered inline-edit browser flow, worker/HTTP behavior,
release, installer pin or production update is qualified by these tests.
