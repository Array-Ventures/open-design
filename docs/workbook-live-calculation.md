# Workbook live calculation boundary

This is next-release implementation evidence, not an enabled feature. The grid
still registers `notExecuteFormula: true`. Do not remove that flag merely because
the scalar tests below pass: arrays have an additional application/writer path.

## Pinned Univer 1.4.0 behavior

The installed `@univerjs/engine-formula` and `@univerjs/sheets-formula` declarations
and runtime are authoritative for these APIs:

- `notExecuteFormula` controls whether the engine installs its calculation
  controllers. `initialFormulaComputing: CalculationMode.NO_CALCULATION` only
  prevents initial recalculation; it does not disable calculations after edits.
  `WHEN_EMPTY`, the default initial mode, calculates formulas without a value.
- Normal cell mutations schedule calculation automatically.
  `FFormula.executeCalculation()` forces calculation. `calculationEnd` reports
  completion (`FormulaExecutedStateType.SUCCESS`, value 3).
- The actual injected `IDependencyManagerService.getAllTree()` throws
  `Method not implemented` in this configuration. Do not use it for a synchronous
  policy, despite its exported declaration.
- Set `IConfigService` key `ENGINE_FORMULA_RETURN_DEPENDENCY_TREE` to true before
  creating/editing the workbook. The engine then emits
  `SetFormulaDependencyCalculationResultMutation` before the matching
  `SetFormulaCalculationResultMutation`. Its `parents` are dependent formulas;
  the graph includes unsupported functions and their chains across sheets.
- `FFormula.sequenceNodesBuilder`, `IFunctionService.hasExecutor`,
  `sequenceNodeType` and `deserializeRangeWithSheet` provide lexical/function/
  external-reference analysis. No parallel formula parser is needed.
- The configured default external-reference loader is
  `NoopFormulaExternalReferenceDataLoader`. The grid registers neither a network
  provider nor custom network functions. Tests trap `fetch`; the exercised
  external/WEBSERVICE/HYPERLINK cases make zero calls. This is not a general
  kernel network-containment proof or permission to register such providers.

## Scalar result policy

`formula-result-policy.ts` analyzes the pinned token stream, function catalogue
and emitted graph. It marks unknown functions, external references, currently
unbound defined names/table references, known dynamic/rich results, and their
transitive dependent formulas as limited. Missing/stale analysis is limited too.
The dynamic function list is deliberately **not** an exhaustive spill detector.

At `SetFormulaCalculationResultMutation`, `preserveWorkbookFormulaResults`
retains a genuine loaded value/rich result only when the current formula exactly
matches its original formula. It leaves `f` unchanged, including case/spacing.
New or edited unsupported formulas cannot borrow the source cell's old value.
Supported formula errors such as division by zero remain visible. The returned
status distinguishes stored results from unavailable results, with coordinates
and reasons; the host can show a compact contextual status without another
permanent toolbar row. Stored results must never be labeled recalculated.

When wiring this helper, capture the genuine loaded source cache before any
calculation; do not promote a calculated/draft snapshot into that authority.
Enable dependency reporting before calculations start, retain the latest graph
mutation, and filter scalar results in `ICommandService.beforeCommandExecuted`
using the current snapshot and matching source-formula guard. Release listeners
with the grid instance. Do not serialize the grid to save XLSX: use the existing
sparse OOXML edit-plan/writer boundary.

The actual pinned-runtime tests verify:

- B2 changes from 12000 to 15000; `=B2-C2` becomes 8000, whitespace/lowercase SUM
  becomes 22000, and IF returns `up`.
- An unknown function and an external reference retain genuine source caches;
  same-sheet and cross-sheet dependents retain theirs, rather than producing
  errors or a plausible newly computed value from an external stale cache.
- `=1/(B2-B2)` shows `#DIV/0!`. New/changed unknown formulas are unavailable and
  do not reuse unrelated old caches.
- Explicit full calculation does not replace a stored HYPERLINK value with an
  engine-generated rich document. All source formula strings remain exact.
- The scalar writer plan contains only the B2 input edit, not derived result
  cells. This in-memory proof does not alone certify final XLSX archive bytes.

Run `pnpm --filter @open-design/web exec vitest run -c vitest.config.ts
tests/artifacts/workbook-formula-results.test.ts
tests/artifacts/workbook-grid-edits.test.ts --maxWorkers=1` from the repo root.

## Array/spill enablement gate

The same actual-runtime fixture proves that `SEQUENCE` publishes a separate
`SetArrayFormulaDataMutation` with a three-row spill even when this helper keeps
the anchor's saved value. Array metadata is merged into the engine's data model
before scalar results apply. The display interceptor reads spill values from
`FormulaDataModel`'s array overlay: the tested D14 value is 2 there, while
`Workbook.save()` has no raw D14 cell. For a newly calculated spill, the existing
sparse writer therefore does not emit those overlay values as literal edits.
The test also removes the array anchor and genuinely types 42 at D14; that edit
is retained in the writer plan. A blanket derived-coordinate ignore list would
lose this real edit and must not be used.

The normalized v1 model now has optional per-sheet `arrayFormulas` with source
OOXML `kind` (`array` or `dataTable`), anchor and range. The reader emits `[]`
when verified empty; absence from an older pin is **unknown**, not proof that
there are no arrays. Ownership is not inferred from function names, cached
numeric values, or formula-free followers. Import validates bounded, nonoverlapping
ranges and retains source formula text, cached values and package bytes.
`source-array-ownership.ts` exposes ownership/caches without rewriting them.
It does not seed or enable Univer calculation by itself.

The reader can display a cached ref-only Excel data table. Recalculation refuses
any source data-table metadata before returning an output, including an outside
input edit; treating its old result cells as literal calculation inputs would
produce plausible stale results. Existing array/data-table region save refusals
remain intact. This metadata work does not implement array persistence.

Scalar filtering alone still does not preserve limited arrays' cached overlay,
or prove imported-array growth/contraction and writer behavior. The new metadata
must first be wired into the engine's explicit source ownership/cache channel,
without clearing source cells or changing formulas/local references.

Before enabling arbitrary live calculation, implement and test that separate
array/derived-data boundary: preserve original spill values and formula bytes,
make limitations explicit, prevent derived output from becoming literal edit
plans, and continue admitting genuine user edits to those coordinates. Include
existing/new arrays, dynamic references, cross-sheet dependents, spill errors,
undo and source refresh. Until then the grid flag remains disabled; the scalar
helper is groundwork, not a claim of complete live spreadsheet support.

## Source-preserving ownership bootstrap probe

`source-array-engine-data.ts` constructs the pinned array-data channel only from
explicit source metadata and loaded source caches. It checks the loaded cache
against the validated source adapter, refuses changed values/formulas, preserves
blank holes, and never rewrites raw cells or references. Unknown ownership,
data tables and ambiguous typed error caches are not treated as ready. The
`known` result certifies only the bootstrap data, not live calculation support.
Pass `runtimeData()` to Univer: its controllers retain and mutate supplied map
objects. Never pass the genuine `data` authority object itself. Tests verify
that both the loaded source and this cache authority survive calculations intact.

Actual pinned-engine probes establish:

- Registering ownership/cache leaves the entire raw snapshot unchanged.
- Growth into an actual non-array literal 99 produces `#SPILL!` and retains 99.
  The engine's real cache/value collision comparisons remain intact.
- Array metadata is emitted after calculation starts, before its graph and
  scalar results. The graph contains the original `=SEQUENCE(B2/5000)` string;
  the scalar result's source formula map covers the dependent scalar formula
  but omits the array owner. That scalar map is not array-result identity proof.

Two counterexamples motivate the separate representation and dependency policy:

1. Contracting a three-row imported array to two rows removes the retired
   follower's overlay but leaves its original raw cache 3. That value can
   resurface in the view. The writer still correctly sees only the B2 input
   edit. Clearing raw source values to make this probe look correct would
   change the inputs and is not implemented.
2. A cross-sheet formula still references `Inputs!D4` exactly, but its emitted
   graph does not link that spill follower to the array owner. The owner's
   `parents` alone cannot protect this dependent's saved cache. The explicit
   source/runtime ownership relation and pinned range references must also be
   considered before claiming safe dependent calculation.

The following helpers address those display/provenance issues without changing
the retained source. They do not enable arrays or certify their save path; the
grid engine remains disabled.

### Separate interactive cache representation

`sourceArrayInteractiveSnapshot` now returns both untouched source and separate
interactive snapshots. Only cache content at explicitly owned followers moves
out of interactive raw cells into the exact array overlay; source formulas,
references, styles, workbook model and OOXML stay intact. Cache mismatches are
refused, not normalized away. A real non-array 99 remains an input and still
causes `#SPILL!` on growth. Tests show contraction no longer exposes stale raw
cache, and a genuinely typed 42 after anchor removal remains a literal edit.
The writer compares the interactive baseline to the current raw snapshot; it
must never ignore follower coordinates globally.

A varying-array probe calculates a second result of 10001 and an actual
cross-sheet `=Inputs!D4+10` result of 10011, with source values/formulas unchanged.
This qualifies the representation against Univer's dynamic spill behavior,
**not** the source workbook's legacy CSE semantics. `t="array"` does not prove
dynamic mode. Microsoft identifies dynamic behavior with the
[XLDAPR metadata extension](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-xlsx/3dd44d53-847b-402f-a8c7-41a85024caf7)
and its [fDynamic flag](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-xlsx/d1ef676d-d970-4ddd-b642-62f5e0c291e0).
The retained source parts preserve those records, but resolving/validating that
identity in the normalized model is still open. The bootstrap explicitly reports
`calculation: unverified` for source arrays. Do not infer dynamic mode from a
function name or claim legacy contraction fidelity from the dynamic probe.

### Limited branch output and dependency policy

`array-formula-dependencies.ts` augments the emitted graph with pinned reference
tokens decoded against actual worksheet names and explicit source/runtime array
ranges. It uses Univer's own RTree and propagates limitations transitively;
formula text, local reference semantics, inputs and the engine graph stay
unchanged. The actual-runtime test covers a spill follower, its scalar dependent,
and a real outside literal's unaffected dependent. This is necessary even when
the engine calculates correct dynamic output: its emitted graph need not expose
the spill-follower relationship used internally by the calculation engine.

`limited-array-display.ts` returns stored overlay output only for an unchanged
limited source owner with genuine caches. It also checks that no follower input
changed from the interactive baseline, no other array output overlaps, and no
unhandled embedded result mode is present. A conflict makes the batch explicitly
unpublishable, rather than concealing an input. Changed/new unsupported formulas
cannot borrow an unrelated old cache and remain unavailable. Source values are
not labeled recalculated.

The pinned-runtime test runs an unsupported source array, retains its original
overlay values, protects its cross-sheet scalar chain with genuine saved caches,
and preserves the new B2 input. After publication, an actual competing array
still encounters `#SPILL!`; the literal 99 stays intact. No collision comparison
or calculation input was weakened. A changed follower 42 is rejected by the
projection without modifying it.

### Remaining enablement gates

None of these helpers installs a grid lifecycle. Before enabling calculation:

- Buffer the array mutation until matching graph/current formula identity is
  known, publish atomically, clean up listeners, and expose compact stored,
  unavailable and conflict status. Reject unpublishable batches.
- Resolve dynamic/legacy source identity and verify their actual semantics;
  source `t="array"` and a recognized function name are insufficient.
- Implement real array persistence and preservation, retaining existing save
  refusals until qualified. A displayed dynamic result is not a saved array.
- Qualify source refresh, undo, changing formulas, imported/new arrays, dynamic
  references, typed error/rich caches, conflicts, and both themes in the UI.

## Pinned RPC isolation qualification (not enabled)

The pinned core worker preset and `UniverRPCMainThreadPlugin` provide the existing
calculation worker mechanism. The main engine, sheets and formula plugins can all
retain `notExecuteFormula: true` while the worker calculates. The actual RPC test
changes A1 from 2 to 7 and observes `=A1+3` become 10. It executes
`=SEQUENCE(10000000)` against the registered 100×20 worksheet and observes `#REF!`
without growing its dimensions. The same runtime test installs the admission
helper on both sides and refuses real row-count, row-insert and outside-bound
value mutations before execution. No Grid flag or production worker is enabled
by this qualification commit.

`formula-worker-budget.ts` bounds initial registered geometry and raw cells, then
admits only the reviewed range-value sheet mutation. Unknown structural mutations
must not enlarge the calculation replica through paste, insertion or count
changes. This geometry policy is not sufficient by itself: pinned EXPAND can allocate requested output without a sheet-bound check
(RANDARRAY, like SEQUENCE, does check its registered sheet dimensions). A pre-execution
function allocation policy, a worker deadline, matching result-generation
provenance and the separate display/cache boundary are still enablement gates.

The owned Node-worker fixture has a 192 MiB V8 old-generation limit and is always
terminated during teardown. This is a test-process memory limit, **not** a claim
that the browser Worker API supplies a portable heap limit. Browser live support
must not silently treat the Node proof as production memory containment.

## Pre-execution capability and deadline qualification (not yet wired to Grid)

`formula-execution-policy.ts` uses the pinned lexer, reference decoder and
function override configuration. A reviewed allowlist admits common scalar math,
comparisons, IF/IFERROR and range reductions. Internal arithmetic kernels such as
PLUS and DIVIDED are included explicitly. Other implemented functions retain
recognizable formula text but receive an unavailable executor before their
allocation-capable kernel runs. The display policy must classify those names as
stored/unavailable rather than interpreting the placeholder as a live result.
Unimplemented functions have no executor. No source formula/reference is rewritten.

The lexer gate bounds per-formula length/token count, formula count, aggregate
reference/broadcast work and actual registered whole-row/column geometry. Array
literals and text concatenation remain explicit execution limitations until their
allocation paths are qualified. Geometry checks still prohibit insertion/count
changes and outside-bound writes. These limits describe the qualified path, not
all of Excel or the browser's total heap consumption.

The actual RPC fixture verifies normal scalar math still works with this policy,
while SEQUENCE, RANDARRAY and a huge EXPAND request return unavailable without
running their original executors. A deliberately non-yielding fixture function,
registered through the same pinned API, proves the owning deadline terminates
that worker while the main workbook remains responsive. The deadline is terminal
and generation-bound; it never silently restarts against a different draft.
Matching result provenance, immutable cache/display authority and writer/archive
integration remain required before production Grid enablement.

## Production-entry and input-provenance proof (Grid still disabled)

The worker-safe `workbook-formula.worker.ts` now uses the pinned core worker
preset directly. Its Node RPC qualification imports that actual entry, not a
parallel implementation. The owner handles readiness, error, deadline and unmount;
a supplied Worker remains caller-owned because the RPC plugin does not terminate
it. Late readiness cannot revive departed or failed ownership.

`formula-input-provenance.ts` hashes authored literals, their types, exact formula
strings and registered sheet identity/geometry. It excludes formula caches and
display styles. At the pinned execution-lock stage1 callback, the worker captures
that immutable digest and a mutation revision; it tags array, dependency and
scalar result mutations before the pinned RPC forwards them. Any intervening
input change invalidates the result, even an away-and-back edit. Main-thread
application must also compare the tag with its current input digest. This uses
standard synchronous SHA-256 from the already pinned noble library, not a weak
ad-hoc hash or a source-formula rewrite.

Actual-entry tests preserve imported cache999 before an input edit, recalculate
it to10 after A1 becomes7, and converge to12 after rapid edits to8 then9. Matching
production result tags carry a valid digest of the current main inputs. Unit
coverage distinguishes literal types/formula spelling from derived cache/style
changes and rejects an away-and-back mutation revision. None of this promotes
calculated or recovery snapshots into genuine loaded-cache authority.
