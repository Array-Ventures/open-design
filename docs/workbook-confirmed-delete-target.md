# Confirmed worksheet Delete target

The pinned RemoveSheetConfirmCommand dispatches RemoveSheetCommand with a
subUnitId after confirmation, omitting unitId. The protected handler now accepts
that shape only when the SDK resolves the exact privately owned workbook. An
explicit unit ID must still match; unknown fields and missing sheet IDs remain
rejected. Foreign focused workbooks still delegate to their native handler.

The qualifying baseline failed the actual implicit Delete case while both the
foreign-workbook and explicit-invalid-target controls passed. The fixed source
passes all 72 cases in six affected suites, full workspace types and guard.
The new positive case verifies real SDK Delete, Undo and Redo and preserves the
surviving worksheet value. The invalid-target case requires the exact rejection
and unchanged workbook data and history.

An initial exploratory negative assertion incorrectly assumed Delete shared
Rename's permission-veto false return. Delete instead reaches the protected
handler and rejects an explicit missing unit. The corrected, stricter contract
was qualified on the unchanged Delete handler before reapplying the fix.
Exploratory logs are retained separately from the qualifying results.

Receipts: /tmp/workbook-confirmed-delete-qualified-red.log (one failure, two
passes), /tmp/workbook-confirmed-delete-qualified-green.log (72 passes),
/tmp/workbook-confirmed-delete-qualified-types.log and
/tmp/workbook-confirmed-delete-qualified-guard.log.

This is source/SDK qualification only. Native grid context menus remain hidden;
this does not qualify a rendered confirmation dialog or activate host controls.
No worker, HTTP, package, installer-pin or production claim follows from it.
