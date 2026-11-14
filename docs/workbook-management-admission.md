# Live worksheet management inspection

The private controller exposes detached display data through inspectManagement().
It reads the current Writer on every call, requires the exact current registered
SDK unit and command ownership, and rechecks history identity/revision before
returning. Foreign focus, revoked ownership and disposal return no inspection.
The later private clean-resume integration must retain its operational pause gate
through the existing isCurrent() callback; no paused controller is made current
by this method.

The returned snapshot follows actual live Add/Rename/Delete and native Undo,
including unsaved sheets absent from the original source model. Busy includes
controller admission, Writer protected work and an in-flight save. The snapshot
is detached: caller edits do not alter the SDK workbook, journal or native history.
No private issuer map or command authority is returned. An actual bridge executor
must independently recheck its private source/lease/controller/history/worker stamp.

Four genuine baseline failures showed the inspection API was absent. On the final
source, all 31 cases in four affected SDK suites, full workspace types and guard
passed. The new cases prove unsaved live membership across Rename/Delete/Undo,
detached reads without draft/history writes, a held durable Add preparation, and
focus/revocation/disposal withdrawal. Receipts:
/tmp/workbook-management-admission-red.log,
/tmp/workbook-management-admission-final.log,
/tmp/workbook-management-admission-types.log and
/tmp/workbook-management-admission-guard.log.

This is a source inspection seam for the forthcoming bridge. It does not install
controls, qualify actual browser/worker/HTTP execution or change packages, pins,
production or real service units. Combined private-consumer and bridge checks are
still required after integration.
