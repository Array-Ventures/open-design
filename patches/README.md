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


`@univerjs__core@1.4.0.patch` adds a bounded, read-only primitive history
inspection method to the pinned `IUndoRedoService` and `LocalUndoRedoService`.
The existing public interface exposes status counts and only top entries;
`undoRedoStatus$` also publishes counts. Neither reveals older reachable metadata
or default-history trimming/grouped entries. Call sites must not inspect private
stacks or maintain a parallel command history to infer those references.

`getUndoRedoMutationStrings(unitId, mutationId, propertyPath)` projects strings
from both mutation directions of every real item on the requested unit's Undo
and Redo stacks. The result and both arrays are frozen; only immutable primitive
strings leave the service. It does not return real item/config/payload objects,
change focus, pop history, run application callbacks or read getters. Property
traversal uses own data descriptors, never prototype lookup. Missing paths have
no metadata; an existing selected non-string value refuses.

The API bounds unit IDs to 600 characters, mutation IDs to 200, paths to 1–16
ASCII keys (100 characters each, excluding prototype keys), selected strings to
512 characters, total scanned mutations to 100,000 and outputs to 4,096 across
both stacks. Every overflow refuses the whole read; it never truncates or prunes
reachable items. A worksheet descriptor consumer must withdraw destructive and
sheet-Undo authority on refusal, retain its existing protected context and report
the unsupported boundary. This dependency checkpoint does not yet install that
producer or enable controls.

The patch covers ESM, CommonJS, compatibility runtime and the declaration
interface/class. Refresh with `pnpm patch` / `pnpm patch-commit` and install the
updated lockfile; ensure the installed declaration/runtime method actually
exists, rather than trusting patch generation alone. The real SDK regression in
`workbook-history-inspection.test.ts` covers buried Delete history, actual
Undo/Redo, append grouping, default trimming, clear/disposal, getter refusal and
untouched history after finite-bound refusal. Separate Node entry-loader cases
exercise the actual service class with isolated collaborators for every runtime
entry; these are not full worksheet/browser qualification in every variant.
Propose upstreaming the generic read-only inspection API when updating the pin;
remove this patch only after an equivalent upstream boundary passes the same
actual-history and entry-loader cases. No dependency version changes here.


`@univerjs__sheets-formula@1.4.0.patch` removes two misleading pure-constructor
annotations from chained `new Set(...).forEach(...)` traversals in the SDK's
reference Undo/Redo builder. The production Next bundle eliminated both loops,
leaving empty undo/redo maps even after the SDK correctly computed shifted local
and quoted cross-sheet formulas. Raw source tests and an esbuild browser probe
retained the loops, so they did not expose this production optimization failure.

The patch changes annotations only in the ESM, CommonJS and compatibility entry
files consumed here; it does not change command paths, formula semantics, source
identity checks or computed-result provenance. The unused standalone UMD build is
not patched or qualified. Refresh through `pnpm patch` / `pnpm patch-commit` and
install the updated lockfile. A successful source-level SDK test is insufficient:
qualify the real production companion with row/column actions, actual formula
readback, Save, post-ACK Undo/Redo and independent XLSX inspection before removing
the patch. The frozen72 production failure and subsequent candidate qualification
are recorded separately; source test success does not claim a fixed bundle.
