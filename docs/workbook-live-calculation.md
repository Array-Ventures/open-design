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
before scalar results apply. Scalar filtering alone therefore does not prevent
spills, preserve their cached display, or distinguish derived coordinates from
literal edits in the save writer. Source array metadata is not presently part
of the normalized workbook model.

Before enabling arbitrary live calculation, implement and test that separate
array/derived-data boundary: preserve original spill values and formula bytes,
make limitations explicit, prevent derived output from becoming literal edit
plans, and continue admitting genuine user edits to those coordinates. Include
existing/new arrays, dynamic references, cross-sheet dependents, spill errors,
undo and source refresh. Until then the grid flag remains disabled; the scalar
helper is groundwork, not a claim of complete live spreadsheet support.
