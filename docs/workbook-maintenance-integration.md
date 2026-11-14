# Reviewed worksheet maintenance integration

This source checkpoint combines guarded obsolete-selector retirement (01256b2d)
and automatic root maintenance (ee966e88, documentation 00cea243) with fork main
839247a7, including the pinned UI implicit Rename/Delete target fixes. The normal
merge was clean; original author checkpoints remain frozen separately.

The combined source passes 153 cases in 16 affected suites, full workspace types,
guard and diff checks. The frozen lockfile install completed. Receipts:
/tmp/workbook-maintenance-integration-install.log,
/tmp/workbook-maintenance-integration-focused.log,
/tmp/workbook-maintenance-integration-types.log and
/tmp/workbook-maintenance-integration-guard.log.

These checks cover the combined producer, native history, guarded draft storage,
rollback, cleanup scheduler and prior plain-string acknowledgement regression.
They are not whole-application, actual worker, HTTP, browser or process-crash
qualification. Source proof from the separate author checkpoints does not replace
these new combined checks.

Root independently read the automatic owner production code, its eleven tests
and scope record, as well as the merged retirement production boundary. Separate
peer review is recorded in the pull request. No installer starts this owner yet:
the actual Grid must still own start/stop and mark verified ACK/clean-resume
transfers. Its replacement Writer must forward the complete guarded persistence
contract. The private calculation/recovery consumer and rendered host controls
remain separate integration gates.

The owned preview remains on its prior qualified pair. This checkpoint changes
no package, distribution, installer pins, production or real service units.
