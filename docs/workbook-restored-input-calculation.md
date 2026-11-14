# Fresh scalar calculation for restored dirty inputs

## Existing policy and observed gap

The source-cache policy in [the live calculation boundary](workbook-live-calculation.md) and the exact application barrier in [the calculation application record](workbook-calculation-application-barrier.md) remain authoritative. The original reader model supplies genuine stored caches. A recovered desired snapshot is input data, not a source-cache receipt or private native-history grant. Unknown formulas and their dependents must retain only eligible original caches, and calculated results must pass the existing input epoch, digest, graph, scalar and cache-application checks.

Candidate 132 restored an input B2 of 13 while initially showing its source formula cache 12 until Save requested calculation. `CalculationMode.NO_CALCULATION` intentionally prevents initial SDK auto-computation, including for clean source views. The scalar adapter did not separately request work for a genuinely changed restored snapshot. Arrays already have a distinct initial calculation and ownership path.

## Bounded startup request

At its final current Grid handoff, after the writer readiness callback, private lease/controller setup, all listeners and the SDK Rendered handoff, an editable scalar Grid with an actual recovered/restored seed requests one initial calculation. Clean views, readonly views and the separate array adapter do not make that call. Global SDK auto-computation stays disabled.

The scalar adapter privately captures the canonical original and initial input digests. This projection excludes formula caches, styles and viewport state. It starts only when inputs differ, unit identity matches, the calculation owner is ready, the actual active workbook remains editable, the current digest still equals the captured initial digest, and no authored input epoch has intervened. Ineligible metadata, unknown array ownership and CSV remain excluded. Disposal and the existing Grid current-owner fence prevent a late startup request on a replacement view.

A private per-instance flag is set before dispatch, preventing synchronous reentrancy and repeated requests. The existing public host calculation-start mutation receives `forceCalculation: true`; the existing host listener stamps the current epoch and the serialized RPC path carries it to the contained worker. No epoch is minted from draft JSON. A fresh scalar receipt is required, so a matching graph/no-result terminal alone cannot declare the restored values fresh. Existing scalar source preservation, reverse application and quiescence barriers remain unchanged. No source file is written until the person saves.

## Source evidence

The real pinned SDK and production Node RPC Worker regression starts with source B2 and formula caches at 12 but a desired snapshot whose B2 is already 13 before workbook creation. No authored cell command or Save occurs. On the unchanged source, the local formula remains 12 rather than the required 13 (`/tmp/workbook-restored-input-rpc-red.log`). A separate actual Grid component test fails because the final ready handoff makes no startup request (`/tmp/workbook-restored-input-grid-red.log`).

The final actual RPC case holds the second worksheet's reverse cache application. The first worksheet reaches 13 while the second remains 12, and quiescence stays pending. Releasing that exact tagged application yields the cross-sheet 13. The owner remains healthy, the epoch remains zero, no authored cell mutation occurs, and the original model and source caches remain at 12. A second actual RPC case calculates the qualified results while preserving source-owned UNKNOWN/dependent caches 55 and 56 as stored results. These two cases passed in 8.89 seconds on the final source.

Worker-free tests cover one-shot/reentrant dispatch, graph-only noncompletion, clean/cache-only snapshots, unsupported metadata and unknown array ownership, actual readonly and replacement-unit state, disposal, authored-epoch ABA, writer readiness, Rendered ordering and late component disposal. The existing display and Grid cases remain intact. The combined focused lane passed 56 cases across three files. An intermediate new fixture mistakenly supplied its modified source snapshot as both source and desired; that failure was corrected by retaining the actual desired SDK snapshot, without weakening a guard.

The test fixture's optional restored-seed adapter changes only initial test data before SDK construction. Source cache and model ownership remain separate, and an unexpected remote writer call still fails the fixture. This is source/SDK/Worker evidence, not packaged visual or HTTP recovery qualification. A new immutable pair must still demonstrate visible fresh values before Save, clean/read-only behavior and recovery cleanup. Frozen candidate 133 and its preview remain unchanged.

Full workspace typechecking and guard passed (`/tmp/workbook-restored-input-types-final.log` and `/tmp/workbook-restored-input-guard.log`), as did the frozen install and diff check. The first typecheck caught an erased generic argument incorrectly describing the command's return rather than its parameter object; removing that argument changed no runtime behavior. Its failing log is retained separately. No complete web suite, package build or runtime activation was run.
