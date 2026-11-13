import { CellValueType, ICommandService, IConfigService, LocaleType, RANGE_TYPE, RTree, Univer, type ICellData, type IUnitRange, type IWorkbookData } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import * as engine from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { CalculationMode, TriggerCalculationController, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import '@univerjs/sheets/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-formula/facade';
import { workbookDocumentSchema, type WorkbookDocument, type WorkbookRange } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from './grid-model';
import { sourceArrayInteractiveSnapshot, type SourceArrayEngineData } from './source-array-engine-data';
import { assertWorkbookCalculationBudget, WorkbookCalculationBudgetError } from './formula-worker-budget';
import { assertWorkbookFormulaExecution, QUALIFIED_WORKBOOK_FUNCTIONS } from './formula-execution-policy';
import { workbookCalculationInputSha256, type WorkbookCalculationTag } from './formula-input-provenance';
import { workbookFormulaPolicy, type FormulaDependencyNode } from './formula-result-policy';
import { workbookArrayFormulaPolicy, sourceArrayDependencyRegions, type ArrayDependencyRegion } from './array-formula-dependencies';

const key = (sheet: string, row: number, column: number) => JSON.stringify([sheet, row, column]);
const at = (book: IWorkbookData, sheet: string, row: number, column: number) => book.sheets[sheet]?.cellData?.[row]?.[column];
function fail(message: string): never { throw new WorkbookCalculationBudgetError(message); }
function* entries(book: IWorkbookData) {
  for (const [sheetId, sheet] of Object.entries(book.sheets)) for (const [row, columns] of Object.entries(sheet.cellData ?? {})) for (const [column, raw] of Object.entries(columns ?? {})) { const cell = raw as ICellData | null | undefined; if (cell) yield { sheetId, row: Number(row), column: Number(column), cell }; }
}
const qualified = new Set([...QUALIFIED_WORKBOOK_FUNCTIONS, 'SEQUENCE', 'TRUE', 'FALSE', 'NA']);
const available = new Set(engine.ALL_IMPLEMENTED_FUNCTIONS.map(([, name]) => String(name).toUpperCase()));
type Value = { kind: 'number' | 'string' | 'boolean' | 'error' | 'blank'; value: string | number | boolean | null };
function typed(value: engine.BaseValueObject): Value { return { kind: value.isNull() ? 'blank' : value.isError() ? 'error' : value.isBoolean() ? 'boolean' : value.isNumber() ? 'number' : 'string', value: value.isNull() ? null : value.getValue() }; }

export interface QualifiedArrayProjection {
  sourceSha256: string; workbookCalculation: WorkbookCalculationTag;
  owners: ArrayDependencyRegion[];
  /** Read-only derived values. Never merge into authored cellData or journals. */
  cells: Record<string, Record<number, Record<number, Value>>>;
  stored: string[]; unavailable: string[];
}
interface Pass { owners: ArrayDependencyRegion[]; values: Map<string, Value[][]>; scalar: Map<string, Value>; trees: FormulaDependencyNode[]; snapshot: IWorkbookData }

/** A private headless kernel returns complete read-only projections through
 * the owned worker transport. Source modes come only from the daemon's
 * SHA-verified preview, never a browser edit plan or inferred function name. */
export function qualifiedArrayKernel(model: WorkbookDocument, unitId: string, sourceSha256: string) {
  model = workbookDocumentSchema.parse(model);
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || model.calculationMetadata !== 'verified' || model.sourceFormat === 'csv') fail('Verified source calculation metadata is required.');
  if (model.definedNames?.length || model.tables?.length) fail('Named and table array calculation needs its own admission policy.');
  if (model.sheets.some(sheet => sheet.arrayFormulas === undefined || sheet.arrayFormulas.some(owner => owner.kind !== 'array' || !['fixed', 'dynamic'].includes(owner.calculation ?? '')))) fail('Source array calculation identity is unavailable.');
  const original = gridWorkbook(model, unitId, 'Workbook').data as IWorkbookData;
  const projection = sourceArrayInteractiveSnapshot(model, original);
  if (projection.state !== 'known') fail(projection.reason);
  const initial = projection.interactiveSnapshot;
  assertWorkbookCalculationBudget([initial], true);
  const sourceOwners = new Map(model.sheets.flatMap(sheet => (sheet.arrayFormulas ?? []).map(owner => [key(sheet.id, owner.row, owner.column), { ...owner, sheetId: sheet.id, formula: at(original, sheet.id, owner.row, owner.column)!.f! }] as const)));
  let revision = 0;
  const sourceCells = new Map(model.sheets.flatMap(sheet => sheet.cells.map(cell => [key(sheet.id, cell.row, cell.column), cell] as const)));

  async function pass(current: IWorkbookData, admitted: ReadonlyMap<string, WorkbookRange>): Promise<Pass> {
    const owners = new Map<string, ArrayDependencyRegion>();
    for (const [id, owner] of sourceOwners) if (at(current, owner.sheetId, owner.row, owner.column)?.f === owner.formula) owners.set(id, { sheetId: owner.sheetId, row: owner.row, column: owner.column, formula: owner.formula, range: { ...owner.range }, provenance: 'source' });
    const values = new Map<string, Value[][]>(), scalar = new Map<string, Value>(), wrapped = new Map<string, string>();
    let spent = 0, failed = false, failure = '';
    const denied = (message: string) => { failed = true; failure ||= message; return engine.ErrorValueObject.create(engine.ErrorType.NA); };
    const charge = (amount: number) => { spent += amount; if (!Number.isSafeInteger(spent) || spent > 1_000_000) { denied('Array execution exceeds its aggregate work budget.'); return false; } return true; };
    const capture = `WORKBOOK_TYPED_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;
    class Capture extends engine.BaseFunction {
      minParams = 1; maxParams = 1; needsReferenceObject = true;
      calculate(incoming: engine.FunctionVariantType): engine.FunctionVariantType {
        if (failed) return denied(failure);
        const reference = incoming.isReferenceObject() ? incoming as engine.BaseReferenceObject : undefined;
        if (reference && !charge(reference.getRowCount() * reference.getColumnCount())) return denied(failure);
        const value = reference ? reference.toArrayValueObject() : incoming as engine.BaseValueObject;
        const identity = key(this.subUnitId!, this.row, this.column);
        let first = value;
        if (value.isArray()) {
          const array = value as engine.ArrayValueObject, rows = array.getRowCount(), columns = array.getColumnCount(); if (!charge(rows * columns)) return denied(failure);
          if (!owners.has(identity) && (!reference || rows > 1 || columns > 1)) owners.set(identity, { sheetId: this.subUnitId!, row: this.row, column: this.column, formula: at(current, this.subUnitId!, this.row, this.column)!.f!, range: { startRow: this.row, endRow: this.row + rows - 1, startColumn: this.column, endColumn: this.column + columns - 1 }, provenance: 'runtime' });
          if (owners.has(identity)) {
            const matrix: Value[][] = [];
            for (let row = 0; row < rows; row++) { const line: Value[] = []; for (let column = 0; column < columns; column++) { let item = array.get(row, column); if (!item || item.isArray()) { return denied('Nested array values remain unqualified.'); } if (rows === 1 && columns === 1 && item.isNull()) item = engine.NumberValueObject.create(0); line.push(typed(item)); } matrix.push(line); }
            values.set(identity, matrix);
          }
          first = array.get(0, 0)!;
          if (rows === 1 && columns === 1 && first.isNull()) first = engine.NumberValueObject.create(0);
        }
        const result = typed(first); scalar.set(identity, result);
        if (!value.isArray() && owners.has(identity)) values.set(identity, [[result]]);
        return incoming;
      }
    }
    const overrides: [new (name: engine.IFunctionNames) => engine.BaseFunction, engine.IFunctionNames][] = [];
    for (const [Actual, name] of engine.ALL_IMPLEMENTED_FUNCTIONS) {
      if (!qualified.has(String(name))) { class Unavailable extends engine.BaseFunction { minParams = 0; maxParams = 255; calculate() { return engine.ErrorValueObject.create(engine.ErrorType.NA); } } overrides.push([Unavailable, name]); continue; }
      class Guarded extends Actual {
        calculate(...args: engine.BaseValueObject[]): engine.FunctionVariantType {
          if (failed) return denied(failure);
          let rows = 1, columns = 1;
          for (const value of args) if (value?.isArray()) { rows = Math.max(rows, (value as engine.ArrayValueObject).getRowCount()); columns = Math.max(columns, (value as engine.ArrayValueObject).getColumnCount()); }
          if (String(name) === 'SEQUENCE') {
            const number = (value: engine.BaseValueObject | undefined, fallback: number) => { if (!value || value.isNull()) return fallback; const item = value.isArray() && (value as engine.ArrayValueObject).getRowCount() === 1 && (value as engine.ArrayValueObject).getColumnCount() === 1 ? (value as engine.ArrayValueObject).get(0, 0) : value; if (!item?.isNumber() || !Number.isFinite(item.getValue())) { denied('SEQUENCE arguments need scalar numeric admission.'); return Number.NaN; } return Number(item.getValue()); };
            rows = number(args[0], 1); columns = number(args[1], 1);
            if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows < 1 || columns < 1 || rows > this._rowCount - this.row || columns > this._columnCount - this.column) { return denied('The array exceeds the registered live worksheet bounds.'); }
          }
          if (!charge(rows * columns * Math.max(1, args.length))) return denied(failure);
          let result: ReturnType<engine.BaseFunction['calculate']>;
          try { result = super.calculate(...args); } catch { return denied('An executor failed its qualified calculation boundary.'); }
          if (!result || (!result.isReferenceObject() && !result.isValueObject())) { return denied('Async array execution is not qualified.'); }
          return result as engine.FunctionVariantType;
        }
      }
      overrides.push([Guarded, name]);
    }
    class Dependencies extends engine.DependencyManagerService {
      override searchDependency(search: IUnitRange[], except?: Set<number>) { return super.searchDependency(search.map(item => { if (item.unitId !== unitId || item.range.startRow !== item.range.endRow || item.range.startColumn !== item.range.endColumn) return item; const id = key(item.sheetId, item.range.startRow, item.range.startColumn), range = admitted.get(id) ?? owners.get(id)?.range; return range ? { ...item, range: { ...range } } : item; }), except); }
    }
    class Plugin extends engine.UniverFormulaEnginePlugin { protected override _initializeWithOverride() { super._initializeWithOverride(); this._injector.replace([engine.IDependencyManagerService, { useClass: Dependencies }]); } }
    const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: SheetsEnUS } });
    try {
      univer.registerPlugin(Plugin, { function: [...overrides, [Capture, capture]] }); univer.registerPlugin(UniverSheetsPlugin); univer.registerPlugin(UniverSheetsFormulaPlugin, { initialFormulaComputing: CalculationMode.NO_CALCULATION });
      const data = structuredClone(current);
      for (const { sheetId, row, column, cell } of entries(data)) {
        const identity = key(sheetId, row, column);
        if (cell.f) { cell.f = `=${capture}(${cell.f.slice(1)})`; wrapped.set(identity, cell.f); delete cell.v; delete cell.t; delete cell.p; }
        else if (sourceCells.get(identity)?.kind === 'error' && cell.v === at(original, sheetId, row, column)?.v && cell.t === at(original, sheetId, row, column)?.t) cell.t = CellValueType.STRING;
      }
      const api = FUniver.newAPI(univer), book = api.createWorkbook(data), formulas = api.getFormula();
      const runtime = { sequenceNodesBuilder: (f: string) => formulas.sequenceNodesBuilder(f), deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType, rangeType: RANGE_TYPE };
      assertWorkbookFormulaExecution([current], runtime);
      for (const { cell } of entries(current)) if (cell.f) for (const token of formulas.sequenceNodesBuilder(cell.f)) if (typeof token !== 'string' && token.nodeType === engine.sequenceNodeType.REFERENCE) {
        const range = engine.deserializeRangeWithSheet(token.token).range;
        if (range.rangeType === RANGE_TYPE.ROW || range.rangeType === RANGE_TYPE.COLUMN || range.rangeType === RANGE_TYPE.ALL) fail('Whole-axis array execution requires physical worksheet bounds.');
      }
      const seed: SourceArrayEngineData = { arrayFormulaRange: { [unitId]: {} }, arrayFormulaCellData: { [unitId]: {} }, arrayFormulaEmbedded: {} };
      for (const [id, owner] of owners) if (!(sourceOwners.get(id)?.calculation === 'dynamic' && owner.range.endRow === owner.row && owner.range.endColumn === owner.column)) (((seed.arrayFormulaRange[unitId]![owner.sheetId] ??= {})[owner.row] ??= {})[owner.column] = { ...owner.range });
      api.syncExecuteCommand(engine.SetArrayFormulaDataMutation.id, seed, { onlyLocal: true });
      let trees: FormulaDependencyNode[] | undefined;
      const subscription = univer.__getInjector().get(ICommandService).beforeCommandExecuted(command => {
        // Workers omit the UI controller that copies this configuration into
        // each start request. Request evidence here; never relax its admission.
        if (command.id === engine.SetFormulaCalculationStartMutation.id) Object.assign(command.params ?? {}, { isCalculateTreeModel: true });
        if (command.id === engine.SetFormulaDependencyCalculationResultMutation.id) trees = (command.params as { result: FormulaDependencyNode[] }).result;
      });
      univer.__getInjector().get(IConfigService).setConfig(engine.ENGINE_FORMULA_RETURN_DEPENDENCY_TREE, true);
      // The browser branch defers these services to the UI Rendered stage.
      // A private headless kernel starts the public SDK services explicitly;
      // Node reuses their existing instances and start() is idempotent.
      univer.__getInjector().get(TriggerCalculationController);
      univer.__getInjector().get(engine.FormulaCalculationTriggerService).start();
      try { formulas.executeCalculation(); await formulas.onCalculationResultApplied(5_000); } finally { subscription.dispose(); }
      if (failed) fail(failure);
      if (!trees) fail('The calculation did not meet its execution boundary.');
      const mapped = trees.map(tree => { const id = key(tree.subUnitId, tree.row, tree.column), formula = at(current, tree.subUnitId, tree.row, tree.column)?.f; if (formula && tree.formula !== wrapped.get(id)) fail('Array graph provenance changed.'); return { ...tree, formula: formula ?? tree.formula }; });
      return { owners: [...owners.values()], values, scalar, trees: mapped, snapshot: book.save() };
    } finally { univer.dispose(); }
  }

  function finalize(current: IWorkbookData, result: Pass): Omit<QualifiedArrayProjection, 'sourceSha256' | 'workbookCalculation'> {
    const runtime = { sequenceNodesBuilder: (_f: string) => [] as (string | { nodeType: number; token: string })[], hasExecutor: (name: string) => qualified.has(name.toUpperCase()) && available.has(name.toUpperCase()), deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType, supportedArrayFunctions: new Set(['SEQUENCE']) };
    // Tokens are obtained from a real pinned lexer, with no evaluator loaded.
    const lexer = new engine.LexerTreeBuilder(); runtime.sequenceNodesBuilder = f => lexer.sequenceNodesBuilder(f) ?? fail('Array formula analysis failed.');
    const index = new RTree(), candidates = new RTree();
    const inputs = [...entries(current)].filter(({ cell }) => cell.f || cell.v != null || cell.p);
    index.bulkInsert(inputs.map((input, id) => ({ id, unitId, sheetId: input.sheetId, range: { startRow: input.row, endRow: input.row, startColumn: input.column, endColumn: input.column } })));
    try {
      const base = workbookFormulaPolicy(current, result.trees, runtime), policy = workbookArrayFormulaPolicy(current, base, result.trees, [...sourceArrayDependencyRegions(model, current), ...result.owners], runtime);
      const limited = new Set(policy.limited.map(cell => key(cell.sheetId, cell.row, cell.column))), cells: QualifiedArrayProjection['cells'] = {}, owners: ArrayDependencyRegion[] = [], stored: string[] = [], unavailable: string[] = [];
      const put = (sheet: string, row: number, column: number, value: Value) => { ((cells[sheet] ??= {})[row] ??= {})[column] = value; };
      for (const [id, value] of result.scalar) if (!limited.has(id)) { const [sheet, row, column] = JSON.parse(id) as [string, number, number]; put(sheet, row, column, value); }
      for (const limitedCell of policy.limited) {
        const id = key(limitedCell.sheetId, limitedCell.row, limitedCell.column), source = sourceCells.get(id);
        if (source?.formula === limitedCell.formula && source.kind !== 'blank') { stored.push(id); put(limitedCell.sheetId, limitedCell.row, limitedCell.column, { kind: source.kind, value: source.value }); }
        else unavailable.push(id);
      }
      if (result.owners.length > 4096) fail('Array owner count exceeds its live budget.');
      candidates.bulkInsert(result.owners.map(owner => { const matrix = result.values.get(key(owner.sheetId, owner.row, owner.column)); return { id: key(owner.sheetId, owner.row, owner.column), unitId, sheetId: owner.sheetId, range: !limited.has(key(owner.sheetId, owner.row, owner.column)) && matrix ? { startRow: owner.row, startColumn: owner.column, endRow: owner.row + matrix.length - 1, endColumn: owner.column + matrix[0]!.length - 1 } : owner.range }; }));
      let area = 0;
      for (const owner of result.owners) {
        const id = key(owner.sheetId, owner.row, owner.column), source = sourceOwners.get(id);
        if (limited.has(id)) { if (source?.formula === owner.formula) { owners.push({ ...owner, range: { ...source.range } }); for (let row = source.range.startRow; row <= source.range.endRow; row++) for (let column = source.range.startColumn; column <= source.range.endColumn; column++) { const cell = sourceCells.get(key(owner.sheetId, row, column)); if (cell) put(owner.sheetId, row, column, { kind: cell.kind, value: cell.value }); } } continue; }
        let matrix = result.values.get(id); if (!matrix) fail('Array typed results are missing.');
        const actual = at(result.snapshot, owner.sheetId, owner.row, owner.column);
        let range = { startRow: owner.row, startColumn: owner.column, endRow: owner.row + matrix.length - 1, endColumn: owner.column + matrix[0]!.length - 1 };
        if (model.sheets.find(sheet => sheet.id === owner.sheetId)!.merges.some(merge => merge.startRow <= range.endRow && merge.endRow >= range.startRow && merge.startColumn <= range.endColumn && merge.endColumn >= range.startColumn)) fail('Merged array collisions remain unqualified.');
        for (const other of candidates.searchGenerator({ unitId, sheetId: owner.sheetId, range })) if (other !== id) fail('Array candidates overlap.');
        for (const item of index.searchGenerator({ unitId, sheetId: owner.sheetId, range })) {
          const input = inputs[Number(item)]!, cell = input.cell;
          if (input.row === owner.row && input.column === owner.column) continue;
          if (!cell.f && cell.v === '') fail('Empty-string spill collisions remain unqualified.');
          if (actual?.v !== '#SPILL!' || actual.t !== CellValueType.STRING) fail('Array collision authority is ambiguous.');
          matrix = [[{ kind: 'error', value: '#SPILL!' }]]; range = { ...range, endRow: owner.row, endColumn: owner.column };
        }
        const first = matrix[0]![0]!, expected = first.kind === 'boolean' ? first.value ? 1 : 0 : first.value;
        if (!(first.kind === 'blank' && actual != null && actual.v == null) && actual?.v !== expected && actual?.v !== first.value) fail('Typed array result and kernel anchor disagree.');
        if (source?.calculation === 'fixed' && (range.endRow !== source.range.endRow || range.endColumn !== source.range.endColumn)) fail('A fixed source array changed shape.');
        if ((area += matrix.length * matrix[0]!.length) > 100_000) fail('Array result area exceeds its budget.');
        owners.push({ ...owner, range });
        for (let row = 0; row < matrix.length; row++) for (let column = 0; column < matrix[row]!.length; column++) put(owner.sheetId, owner.row + row, owner.column + column, matrix[row]![column]!);
      }
      let count = 0, text = 0; for (const sheet of Object.values(cells)) for (const row of Object.values(sheet)) for (const value of Object.values(row)) { count++; text += typeof value.value === 'string' ? value.value.length : 0; }
      if (count > 100_000 || text > 8 * 1024 * 1024) fail('Array projection exceeds its cell/text budget.');
      return { cells, owners, stored, unavailable };
    } finally { lexer.dispose(); index.dispose(); candidates.dispose(); }
  }
  return {
    original: structuredClone(original), initial: structuredClone(initial),
    invalidate() { revision++; },
    async calculate(input: IWorkbookData, generation: number): Promise<QualifiedArrayProjection> {
      const ticket = ++revision, current = structuredClone(input), digest = workbookCalculationInputSha256(current);
      if (current.id !== unitId || current.dateSystem !== original.dateSystem || JSON.stringify(current.sheetOrder) !== JSON.stringify(original.sheetOrder)) fail('Array calculation source scope changed.');
      if (!Number.isSafeInteger(generation) || generation < 1) fail('Invalid calculation generation.');
      for (const [sheet, value] of Object.entries(original.sheets)) if (current.sheets[sheet]?.name !== value.name || current.sheets[sheet]?.rowCount !== value.rowCount || current.sheets[sheet]?.columnCount !== value.columnCount || JSON.stringify(current.sheets[sheet]?.mergeData) !== JSON.stringify(value.mergeData)) fail('Array calculation worksheet scope changed.');
      assertWorkbookCalculationBudget([current], true);
      for (const [id, owner] of sourceOwners) if (owner.calculation === 'fixed' && at(current, owner.sheetId, owner.row, owner.column)?.f !== owner.formula) fail('Fixed source array structural edits remain unsupported.');
      const discovery = finalize(current, await pass(current, new Map()));
      if (ticket !== revision) fail('Array calculation was superseded.');
      const admitted = new Map(discovery.owners.map(owner => [key(owner.sheetId, owner.row, owner.column), owner.range]));
      const final = finalize(current, await pass(current, admitted));
      if (ticket !== revision || discovery.owners.length !== final.owners.length || final.owners.some(owner => JSON.stringify(admitted.get(key(owner.sheetId, owner.row, owner.column))) !== JSON.stringify(owner.range))) fail('Array ownership changed during calculation.');
      return structuredClone({ ...final, sourceSha256, workbookCalculation: { version: 1, unitId, inputSha256: digest, generation, valid: true } });
    },
  };
}
