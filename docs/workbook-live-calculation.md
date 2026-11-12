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

## Derived-write and display boundary (Grid still disabled)

The worker preset omits the UI controller that normally copies the dependency
return configuration into calculation requests. The worker therefore requests
`isCalculateTreeModel` explicitly on every admitted calculation start. Actual
pinned trees and array geometry travel over typed messages on the same owned
Worker channel, before their matching scalar result. This is necessary because
stock RPC does not replicate the global dependency mutation to the main unit.

The pinned worker also applies a scalar result locally, generating nested
`SetRangeValuesMutation` calls which RPC replicates separately. Filtering only
the outer result is insufficient. Each nested write is bound to its exact parent
result's source-formula object; main-thread application validates every derived
range against its tagged input hash and dependency generation. Untagged or stale
writes are refused before raw cells change. Genuine source caches, previous
verified live values during calculation, and unavailable output stay separate.
The display interceptor preserves literal edits ahead of any array overlay.

The actual production-entry/RPC/interceptor test verifies scalar10, original
unsupported55 and dependent56, genuine DIV/0, unavailable new EXPAND, and rapid
edits converging12. These checks do not yet qualify Grid/writer recreation or
XLSX persistence, so production Grid remains disabled at this stage.

## Live Grid candidate and same-writer fallback

The Grid now keeps all main-thread formula engines disabled and supplies an owned
RPC worker only for admitted bounded workbooks whose source array ownership is
known empty. Source arrays, older/unknown array metadata and oversized geometry
open in explicit stored-result mode. New unsupported formulas remain recognizable
but their unavailable executor outputs do not masquerade as calculated values.

`grid-calculation.ts` installs the same input/result/display boundary qualified by
the actual RPC test. Reviewed row-height and column-width changes preserve live
admission; structural growth and shared-formula aliases remain unqualified.
A terminal worker failure captures and journals the last raw snapshot before
closing the kernel, then recreates a stored kernel from that same snapshot and
awaits the existing scoped writer's readiness before enabling input. The hook's
same-source checkpoint carry preserves operation IDs and pending save identity;
a replacement source/project/account must never inherit it.

Focused tests cover the actual Grid controller with production-entry worker math,
range SUM and IF, genuine errors, stored unsupported dependents, rapid edits and
row/column layout; component tests cover fallback ordering and writer readiness.
Actual browser bundling, visible live math and binary Save/export acceptance
remain integration gates. Unsupported-function cache fidelity on binary Save is
not established by this display policy: the existing server calculation path
owns that separate persistence boundary.

## Calculation information in host chrome

Calculation state is an additive `studio:workbook-calculation-state` message,
separate from strict formatting/save protocols. It carries the current project
and editor controller IDs plus a bounded phase/count summary. The Grid republishes
it when the authorized host requests artifact state, and stops on departure.
The host validates iframe identity, same origin, project and controller before
showing a compact information indicator in its existing artifact header.

Stored caches explicitly say they may be out of date; unavailable outputs remain
distinct. There is no canvas overlay, added toolbar row or action that restarts
calculation or saves a file. Older companions send no new message and preserve
existing controls; older hosts ignore the additive message. Paired source/package
browser acceptance must check the indicator in light/dark and narrow layouts.

The pinned sheets formula plugin's `notExecuteFormula` option requests RPC
function registration. Stored kernels therefore set it false while keeping the
actual formula engine disabled; otherwise kernel recreation throws a missing
`IRPCChannelService` dependency error. The actual pinned no-RPC test verifies
stored cache999 remains999 after an input changes and emits no calculation result.

### Backend fixed-source array persistence

The daemon can recalculate an explicit source `t="array"` owner without cell
metadata when the pinned engine returns exactly its declared source rectangle.
This is a fixed-range capability, not an inference that `t="array"` identifies a
modern spill. The source formula text, attributes and range remain unchanged.
Only typed server-derived caches are replaced; follower cells are disposable
calculation overlays, never input literals. Missing physical followers can be
created, retaining existing follower styles. Error-looking strings and actual
errors remain distinct in OOXML.

The emitted array range must agree with the captured typed matrix. Scalar
reference dependencies intersect explicit ownership with the pinned lexer,
reference decoder and spatial index, because the engine graph can omit follower
edges. Original unsupported owners and their follower-dependent closure retain
source caches. A retained branch is stored evidence, not a promise of freshness.
Array reference analysis has an aggregate one-million-token/intersection budget.

### Verified dynamic persistence

The daemon resolves `cm` (one-based) through `cellMetadata/bk/rc`, its
`metadataTypes` identity and zero-based `futureMetadata` record. Only the known
XLDAPR extension and `dynamicArrayProperties fDynamic=true, fCollapsed=false`
qualify a source owner for growth/shrinkage. Unknown metadata, value metadata,
ambiguous records, unsupported properties and invalid indices are refused;
existing metadata bytes are preserved exactly.

The disposable backend registers Excel's physical row/column limits. The model's
used/display extent is not a semantic worksheet boundary: `SEQUENCE(200)` can
grow beyond an imported 100-row viewport. Only actual output cells extend the
returned/persisted model. Whole-axis references normalize to full Excel bounds
in the spatial policy; final scheduling and retention also use the admitted
server rectangles. Full-sheet reductions can still reach the surrounding
worker's time/memory limit and fail without persisting.

A discovery calculation derives geometry only. A second fresh calculation starts
from the original patched inputs, clears only original source-owned followers,
and schedules consumers using admitted server geometry. Discovery caches never
become final input values or persisted results. Final geometry must equal the
admitted rectangles, including the exact owner-key set; a disappearing or new
owner and unstable geometry are refused. Both passes enforce the
existing formula/name work budgets, five-second engine result deadline,
100,000 aggregate array-result cells, the 4,096-owner admission limit for new
owner authoring, and one-million-token/intersection array
reference budget. The surrounding bounded worker remains required. No third
calculation or convergence retry is attempted.

A collision is persisted as a typed `#SPILL!` only when an actual nonempty
outside input blocks the rectangle and the final anchor has both the error text
and this pin's error type (`STRING`; error-looking strings use `FORCE_STRING`).
Ambiguous empty-string literal inputs and overlapping candidate arrays refuse
saving. Candidate matrices/ranges can still be emitted on collision, so
neither alone authorizes overwriting followers. Retired source followers lose
cache values while keeping cell styles and other XML. Merged-cell collisions
remain refused.

The capture function requests actual public reference objects and returns them
unchanged. A normal one-cell `=A1` remains ordinary; genuine one-cell array
objects can retain dynamic identity and grow later. Verified dynamic singleton
ranges are not seeded as fixed CSE into the pin's legacy-singleton engine path.
Actual blank members, numeric zero and error-looking strings remain distinct.

New or changed ordinary formulas that genuinely return arrays can author a
dynamic owner: `f t="array" ref=...`, `cm`, the XLDAPR metadata part, workbook
relationship and content type. Owners share one canonical immutable record;
subsequent saves reuse it without metadata growth. Existing richer supported
metadata can recalculate its owners but refuses new-owner authoring unless the
single-record layout is qualified. Unchanged ordinary source formulas are never
silently promoted to dynamic ownership.

Verified dynamic anchors can be replaced or removed. The internal transaction
retires only ownership whose anchor formula actually changes, clears only that
source rectangle's cache values, and then applies the explicit edit batch. A
genuine new follower input such as 42 survives; it can block a replacement spill.
Unused XLDAPR records remain intact for exact source preservation and reuse.
Unchanged dynamic and all fixed-source followers remain protected.

Data tables, names/tables in an array workbook, merged collisions, empty-string literal collision ambiguity, overlapping
candidates and fixed-source shape/owner edits remain refused. The pinned `#` spill-reference
operator preserves unchanged source caches and refuses new/changed formulas;
explicit follower coordinates can calculate. The existing Grid
source-array gate remains in place; backend persistence does not enable it.
The known XLDAPR identity follows the [Microsoft metadata extension
specification](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-xlsx/3dd44d53-847b-402f-a8c7-41a85024caf7)
and [dynamic-array property
specification](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-xlsx/d1ef676d-d970-4ddd-b642-62f5e0c291e0).


The preview model now carries additive source calculation proof. The reader uses
its existing OOXML metadata resolver to mark each owner `fixed`, `dynamic`, or
`unsupported`, and the document metadata `verified` or `unsupported`. Missing
fields on older previews remain unknown. Unqualified metadata keeps original
caches readable and disables live execution; it does not become a read failure.
These fields describe the SHA-verified preview source only. The save worker
continues to resolve ownership from source package bytes and never treats an
asserted client mode as permission to resize a fixed owner.
