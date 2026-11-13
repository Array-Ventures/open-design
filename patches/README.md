# Maintained dependency patches

`@univerjs__rpc@1.4.0.patch` snapshots primitive execution options when the
primary admits a mutation to its asynchronous RPC queue. The pinned SDK retains
that options object by reference; a caller can reuse it for later mutations
before the queued call serializes it. Per-input calculation epochs must retain
the value belonging to each execution, including rapid A → B → A updates.

The patch covers the package's ESM, CommonJS and compatibility entry files. It
does not change command parameters, transport ordering, permissions or source
files. Refresh it with `pnpm patch` / `pnpm patch-commit` when updating the pin,
then install the frozen lockfile and run the actual production-RPC shared-options
regression in `apps/web/tests/artifacts/workbook-formula-worker-boundary.test.ts`.
Remove the patch only after the upstream queue snapshots options itself and the
regression still passes through every entry variant used by our builds/tests.
