import { randomUUID } from 'node:crypto';
import { BooleanNumber, ICommandService, IConfigService, RTree, CellValueType, DateSystem, LocaleType, Univer, type ICellData, type IObjectMatrixPrimitiveType, type IWorkbookData, type IUnitRange } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { BaseFunction, BooleanValue, DependencyManagerService, IDependencyManagerService, ERROR_TYPE_SET, type ErrorType, ENGINE_FORMULA_RETURN_DEPENDENCY_TREE, IDefinedNamesService, IFunctionService, ISuperTableService, SetFormulaDependencyCalculationResultMutation, SetArrayFormulaDataMutation, type ISetArrayFormulaDataMutationParams, deserializeRangeWithSheet, quoteSheetName, sequenceNodeType, splitTableStructuredRef, type ISetFormulaDependencyCalculationResultMutation, SetDefinedNameMutation, SetSuperTableMutation, UniverFormulaEnginePlugin, type ArrayValueObject, type BaseValueObject, type BaseReferenceObject, type FunctionVariantType, NumberValueObject } from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-formula/facade';
import { workbookCellSchema, workbookDocumentSchema, type WorkbookCell, type WorkbookDocument, type WorkbookRange } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError } from './package.js';
import { createFormulaCacheAnalysis, retainedFormulaCaches, formulaCellKey, type FormulaDependencyNode } from './formula-cache-policy.js';
import { withArrayFollowerDependencies } from './array-dependencies.js';
import { calculationFormula } from './formula-input.js';

function engineCell(cell: WorkbookCell, capture: string, normalized?: string): ICellData {
  if (cell.formula) return { f: `=${capture}(${normalized ?? cell.formula.slice(1)})` };
  switch (cell.kind) {
    case 'blank': return {};
    case 'string': return { v: cell.value, t: CellValueType.FORCE_STRING };
    case 'boolean': return { v: cell.value ? 1 : 0, t: CellValueType.BOOLEAN };
    case 'number': return { v: cell.value, t: CellValueType.NUMBER };
    // A literal Excel error must propagate as an error, not a string input.
    case 'error': return { f: `=${cell.value}` };
  }
}
interface TypedResult { kind: 'number' | 'boolean' | 'string' | 'error' | 'blank'; value: number | boolean | string | null }
// Excel column references are case-insensitive. Univer accepts a local Map but
// otherwise only tries exact title lookups; preserve original titles/iteration
// while making its lookup obey workbook semantics.
class TableColumnMap extends Map<string, number> {
  private readonly folded: Map<string, number>;
  constructor(columns: readonly string[]) {
    super(columns.map((column, index) => [column, index]));
    this.folded = new Map(columns.map((column, index) => [column.toLowerCase(), index]));
  }
  override get(key: string): number | undefined { return super.get(key) ?? this.folded.get(key.toLowerCase()); }
}
function resultCell(original: WorkbookCell, result: TypedResult | undefined): WorkbookCell {
  const base = { row: original.row, column: original.column, ...(original.style === undefined ? {} : { style: original.style }), formula: original.formula! };
  if (!result) throw new WorkbookFormatError('Formula calculation did not produce a typed result.', 'WORKBOOK_UNSUPPORTED');
  return workbookCellSchema.parse({ ...base, ...result });
}

function storedResultCell(current: WorkbookCell, stored: WorkbookCell): WorkbookCell {
  // Normalized style IDs can be re-interned when worksheet cells are ordered.
  // Keep the current package's style identity; only source cache data transfers.
  return workbookCellSchema.parse({ row: current.row, column: current.column, ...(current.style === undefined ? {} : { style: current.style }), formula: current.formula!,
    kind: stored.kind, value: stored.value, ...(stored.kind === 'string' && stored.runs ? { runs: stored.runs } : {}) });
}

/** Pure model calculation, for execution inside the bounded workbook worker.
 * Does not write files or trust cached results supplied by a browser. */
export async function calculateWorkbookResults(input: WorkbookDocument, original: WorkbookDocument = input, dynamicOwners: ReadonlySet<string> = new Set(), executionRanges: ReadonlyMap<string, WorkbookRange> = new Map(), allowNewArrays = false): Promise<{ model: WorkbookDocument; retained: Set<string> }> {
  const model = workbookDocumentSchema.parse(input);
  if (model.sheets.some(sheet => sheet.arrayFormulas?.some(array => array.kind === 'dataTable'))) {
    throw new WorkbookFormatError('Excel data tables cannot be recalculated here. Their saved results are preserved.', 'WORKBOOK_UNSUPPORTED');
  }
  if (model.sheets.some(sheet => sheet.arrayFormulas?.length) && (model.definedNames?.length || model.tables?.length)) throw new WorkbookFormatError('Array formulas with names or tables need their dependency adapter.', 'WORKBOOK_UNSUPPORTED');
  if (!model.sheets.some(sheet => sheet.cells.some(cell => cell.formula))) return { model, retained: new Set() };
  const capture = `EVEBOT_CACHE_${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const results = new Map<string, TypedResult>();
  const dynamic = new Set(dynamicOwners);
  let capturedCells = 0;
  const capturedSizes = new Map<string, number>();
  let arrayLimit: 'cells' | 'owners' | undefined;
  const arrayResults = new Map<string, TypedResult[][]>();
  const owners = new Map(model.sheets.flatMap(sheet => (sheet.arrayFormulas ?? []).map(array => [formulaCellKey(sheet.id, array.row, array.column), { sheetId: sheet.id, ...array }] as const)));
  const originalFormulas = new Map(original.sheets.flatMap(sheet => sheet.cells.map(cell => [formulaCellKey(sheet.id, cell.row, cell.column), cell.formula] as const)));
  const currentFormulas = new Map(model.sheets.flatMap(sheet => sheet.cells.map(cell => [formulaCellKey(sheet.id, cell.row, cell.column), cell.formula] as const)));
  const sourceOwnerKeys = new Set(owners.keys());
  let unsupportedArray = false;
  const mismatchedArrays = new Set<string>();
  const followers = new Set<string>();
  for (const owner of owners.values()) for (let row = owner.row; row <= owner.range.endRow; row++) for (let column = owner.column; column <= owner.range.endColumn; column++) if (row !== owner.row || column !== owner.column) followers.add(formulaCellKey(owner.sheetId, row, column));
  // Capture the engine's value object before its snapshot flattens errors and
  // error-looking strings. This function returns the original value unchanged
  // and exists only in this disposable calculation instance, never in exports.
  class CaptureResult extends BaseFunction {
    minParams = 1;
    maxParams = 1;
    needsReferenceObject = true;
    calculate(incoming: FunctionVariantType): FunctionVariantType {
      const reference = incoming.isReferenceObject() ? incoming as BaseReferenceObject : undefined;
      if (reference && reference.getRowCount() * reference.getColumnCount() > 100_000) { arrayLimit = 'cells'; return incoming; }
      const value = reference ? reference.toArrayValueObject() : incoming as BaseValueObject;
      let scalar: BaseValueObject | null | undefined | void = value;
      if (value.isArray()) {
        const array = value as ArrayValueObject;
        const key = formulaCellKey(this.subUnitId!, this.row, this.column);
        let owner = owners.get(key);
        const rows = array.getRowCount(), columns = array.getColumnCount();
        const size = rows * columns;
        capturedCells += size - (capturedSizes.get(key) ?? 0); capturedSizes.set(key, size);
        if (!Number.isSafeInteger(size) || size < 1 || capturedCells > 100_000) { arrayLimit = 'cells'; return incoming; }
        if (!owner && allowNewArrays && (!reference || rows !== 1 || columns !== 1) && originalFormulas.get(key) !== currentFormulas.get(key)) {
          if (owners.size >= 4096) { arrayLimit = 'owners'; return incoming; }
          owner = { sheetId: this.subUnitId!, kind: 'array', row: this.row, column: this.column, range: { startRow: this.row, startColumn: this.column, endRow: this.row + rows - 1, endColumn: this.column + columns - 1 } };
          owners.set(key, owner); dynamic.add(key);
        }
        if (owner) {
          if (!dynamic.has(key) && (rows !== owner.range.endRow - owner.row + 1 || columns !== owner.range.endColumn - owner.column + 1)) { mismatchedArrays.add(key); return incoming; }
          const values: TypedResult[][] = [];
          for (let row = 0; row < rows; row++) {
            const cells: TypedResult[] = [];
            for (let column = 0; column < columns; column++) {
              let item = array.get(row, column);
              if (item && rows === 1 && columns === 1 && item.isNull()) item = NumberValueObject.create(0);
              if (!item || item.isArray()) { unsupportedArray = true; return incoming; }
              cells.push({ kind: item.isNull() ? 'blank' : item.isError() ? 'error' : item.isBoolean() ? 'boolean' : item.isNumber() ? 'number' : 'string', value: item.isNull() ? null : item.getValue() });
            }
            values.push(cells);
          }
          arrayResults.set(key, values);
        } else if (rows !== 1 || columns !== 1) { unsupportedArray = true; return incoming; }
        scalar = array.get(0, 0);
      }
      if (scalar && value.isArray() && (value as ArrayValueObject).getRowCount() === 1 && (value as ArrayValueObject).getColumnCount() === 1 && scalar.isNull()) scalar = NumberValueObject.create(0);
      if (scalar) {
        const kind = scalar.isNull() ? 'blank' : scalar.isError() ? 'error' : scalar.isBoolean() ? 'boolean' : scalar.isNumber() ? 'number' : 'string';
        const typed: TypedResult = { kind, value: scalar.isNull() ? null : scalar.getValue() };
        results.set(`${this.subUnitId}:${this.row}:${this.column}`, typed);
        const key = formulaCellKey(this.subUnitId!, this.row, this.column), owner = owners.get(key);
        if (!value.isArray() && (dynamic.has(key) || owner && owner.range.endRow === owner.row && owner.range.endColumn === owner.column)) arrayResults.set(key, [[typed]]);
      }
      return incoming;
    }
  }
  const sheets: IWorkbookData['sheets'] = {};
  const engineFormulas = new Map<string, string>(), normalized = new Map<string, string>();
  for (const sheet of model.sheets) {
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {};
    for (const cell of sheet.cells) {
      const formula = cell.formula ? calculationFormula(cell.formula, sheet.id, cell, model.tables ?? []) : undefined;
      const follower = followers.has(formulaCellKey(sheet.id, cell.row, cell.column));
      if (follower && cell.formula) throw new WorkbookFormatError('Array follower contains a formula input.', 'WORKBOOK_UNSUPPORTED');
      const value = follower ? {} : engineCell(cell, capture, formula);
      (cellData[cell.row] ??= {})[cell.column] = { ...value, ...(cell.style === undefined ? {} : { s: String(cell.style) }) };
      if (cell.formula) { const key = formulaCellKey(sheet.id, cell.row, cell.column); engineFormulas.set(key, value.f!); normalized.set(key, `=${formula}`); }
    }
    // The model extent is a sparse display/used range, not Excel's limit.
    // Pinned kernels such as SEQUENCE/ROWS use these registered bounds.
    sheets[sheet.id] = { id: sheet.id, name: sheet.name, rowCount: 1_048_576, columnCount: 16_384, cellData,
      rowData: Object.fromEntries(sheet.rowDimensions.map(row => [row.index, { hd: row.hidden ? BooleanNumber.TRUE : BooleanNumber.FALSE, ...(row.style === undefined ? {} : { s: String(row.style) }) }])),
      columnData: Object.fromEntries(sheet.columnDimensions.map(column => [column.index, { hd: column.hidden ? BooleanNumber.TRUE : BooleanNumber.FALSE, ...(column.style === undefined ? {} : { s: String(column.style) }) }])),
    };
  }
  let arrayData: ISetArrayFormulaDataMutationParams | undefined;
  let blockerIndex: RTree | undefined, mergeIndex: RTree | undefined, candidateIndex: RTree | undefined;
  let subscription: { dispose(): void } | undefined;
  // The pinned generator queries dependents at an owner's anchor. Its public
  // dependency service can expand that query to explicit source ownership before
  // execution, making follower consumers participate in genuine engine order.
  class SourceArrayDependencyManager extends DependencyManagerService {
    override searchDependency(search: IUnitRange[], exceptTreeIds?: Set<number>): Set<number> {
      return super.searchDependency(search.map(item => {
        if (item.unitId !== 'evebot-workbook-calculation' || item.range.startRow !== item.range.endRow || item.range.startColumn !== item.range.endColumn) return item;
        const key = formulaCellKey(item.sheetId, item.range.startRow, item.range.startColumn), bounds = executionRanges.get(key) ?? owners.get(key)?.range;
        return bounds ? { ...item, range: { ...bounds } } : item;
      }), exceptTreeIds);
    }
  }
  class SourceArrayFormulaEnginePlugin extends UniverFormulaEnginePlugin {
    protected override _initializeWithOverride(): void {
      super._initializeWithOverride();
      if (owners.size || allowNewArrays) this._injector.replace([IDependencyManagerService, { useClass: SourceArrayDependencyManager }]);
    }
  }
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: SheetsEnUS } });
  try {
    univer.registerPlugin(SourceArrayFormulaEnginePlugin, { function: [[CaptureResult, capture]] });
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin, { initialFormulaComputing: CalculationMode.NO_CALCULATION });
    univer.__getInjector().get(IConfigService).setConfig(ENGINE_FORMULA_RETURN_DEPENDENCY_TREE, true);
    let trees: FormulaDependencyNode[] | null = null;
    const commands = univer.__getInjector().get(ICommandService);
    subscription = commands.beforeCommandExecuted(command => {
      if (command.id === SetArrayFormulaDataMutation.id) arrayData = command.params as ISetArrayFormulaDataMutationParams;
      if (command.id === SetFormulaDependencyCalculationResultMutation.id) trees = (command.params as ISetFormulaDependencyCalculationResultMutation).result;
    });
    const api = FUniver.newAPI(univer);
    const workbook = api.createWorkbook({ id: 'evebot-workbook-calculation', name: 'Workbook', dateSystem: model.date1904 ? DateSystem.Date1904 : DateSystem.Date1900,
      sheetOrder: model.sheets.map(sheet => sheet.id), sheets,
      styles: Object.fromEntries(model.styles.map((style, index) => [String(index), style.numberFormat ? { n: { pattern: style.numberFormat } } : {}])),
    });
    const unitId = 'evebot-workbook-calculation';
    if (owners.size) {
      const seed: ISetArrayFormulaDataMutationParams = { arrayFormulaRange: { [unitId]: {} }, arrayFormulaCellData: { [unitId]: {} }, arrayFormulaEmbedded: {} };
      for (const owner of owners.values()) {
        // The pin treats a seeded one-cell range as fixed CSE. A verified
        // dynamic singleton has no followers to seed and must remain growable.
        if (dynamic.has(formulaCellKey(owner.sheetId, owner.row, owner.column)) && owner.range.endRow === owner.row && owner.range.endColumn === owner.column) continue;
        const ranges = seed.arrayFormulaRange[unitId]![owner.sheetId] ??= {};
        (ranges[owner.row] ??= {})[owner.column] = { ...owner.range };
      }
      api.syncExecuteCommand(SetArrayFormulaDataMutation.id, seed, { onlyLocal: true });
    }
    for (const table of model.tables ?? []) api.syncExecuteCommand(SetSuperTableMutation.id, { unitId, tableName: table.name,
      reference: { sheetId: table.sheetId, range: table.range, titleMap: new TableColumnMap(table.columns), showHeader: table.header, showFooter: table.totals } }, { local: true });
    for (const [index, name] of (model.definedNames ?? []).entries()) api.syncExecuteCommand(SetDefinedNameMutation.id, { unitId, id: `name-${index}`, name: name.name, formulaOrRefString: name.formula,
      ...(name.sheetId === undefined ? {} : { localSheetId: name.sheetId }), ...(name.hidden === undefined ? {} : { hidden: name.hidden }) }, { local: true });
    const formula = api.getFormula();
    const functions = univer.__getInjector().get(IFunctionService), names = univer.__getInjector().get(IDefinedNamesService), tables = univer.__getInjector().get(ISuperTableService);
    const tableNames = new Set([...tables.getTableMap(unitId)?.keys() ?? []].map(name => name.toLowerCase()));
    const qualifiedNames = new Map<string, NonNullable<ReturnType<typeof names.getValueByName>>>();
    for (const sheet of model.sheets) for (const name of model.definedNames ?? []) {
      if (name.sheetId !== undefined && name.sheetId !== sheet.id) continue;
      const resolved = names.getValueByName(unitId, name.name, sheet.id); if (!resolved) continue;
      qualifiedNames.set(`${sheet.name}!${name.name}`.toLowerCase(), resolved);
      qualifiedNames.set(`'${quoteSheetName(sheet.name)}'!${name.name}`.toLowerCase(), resolved);
    }
    const analysis = createFormulaCacheAnalysis({
      nodes: expression => formula.sequenceNodesBuilder(expression), hasExecutor: name => functions.hasExecutor(name), isLiteral: token => ERROR_TYPE_SET.has(token as ErrorType) || token.toUpperCase() === BooleanValue.TRUE || token.toUpperCase() === BooleanValue.FALSE, types: sequenceNodeType,
      externalReference: token => Boolean(deserializeRangeWithSheet(token).unitId),
      name: (token, sheetId) => { const value = names.getValueByName(unitId, token, sheetId) ?? qualifiedNames.get(token.toLowerCase()); return value ? { id: value.id, formula: value.formulaOrRefString, ...(value.localSheetId ? { sheetId: value.localSheetId } : {}) } : undefined; },
      table: token => { const parsed = splitTableStructuredRef(token); return !parsed.unitQualifier && tableNames.has(parsed.tableName.toLowerCase()); },
    });
    for (const sheet of model.sheets) for (const cell of sheet.cells) if (cell.formula) analysis.admit(normalized.get(formulaCellKey(sheet.id, cell.row, cell.column))!, sheet.id);
    formula.executeCalculation();
    await formula.onCalculationResultApplied(5000);
    if (arrayLimit) throw new WorkbookFormatError(arrayLimit === 'owners' ? 'Array calculation exceeds its new-owner count limit.' : 'Array calculation exceeds its aggregate cell limit.', 'WORKBOOK_LIMIT');
    if (unsupportedArray) throw new WorkbookFormatError('Array formulas need explicit source ownership or a newly entered supported dynamic formula. Your file has not changed.', 'WORKBOOK_UNSUPPORTED');
    if (!trees) throw new WorkbookFormatError('Formula dependency results are missing.', 'WORKBOOK_UNSUPPORTED');
    if (owners.size && (model.definedNames?.length || model.tables?.length)) throw new WorkbookFormatError('Array formulas with names or tables need their dependency adapter.', 'WORKBOOK_UNSUPPORTED');
    for (const [key, owner] of owners) if (!sourceOwnerKeys.has(key)) {
      const sheet = model.sheets.find(sheet => sheet.id === owner.sheetId)!;
      (sheet.arrayFormulas ??= []).push({ kind: 'array', row: owner.row, column: owner.column, range: { ...owner.range } });
    }
    const retained = retainedFormulaCaches(model, original, unitId, withArrayFollowerDependencies(model, trees, unitId, expression => formula.sequenceNodesBuilder(expression), executionRanges), engineFormulas, normalized, analysis);
    // Source array followers are caches, never editable calculation inputs.
    // Retained owners keep their complete source range; calculated owners replace
    // every owned cache, including absent physical follower cells.
    const snapshot = workbook.save();
    const declaredArrays = new Map(model.sheets.flatMap(sheet => (sheet.arrayFormulas ?? []).map(owner => [formulaCellKey(sheet.id, owner.row, owner.column), owner] as const)));
    const cellsBySheet = new Map(model.sheets.map(sheet => [sheet.id, new Map(sheet.cells.map(cell => [`${cell.row}:${cell.column}`, cell]))]));
    const sheetsById = new Map(model.sheets.map(sheet => [sheet.id, sheet]));
    const blockerCells = model.sheets.flatMap(sheet => sheet.cells.filter(cell => cell.formula || cell.kind !== 'blank').map(cell => ({ sheetId: sheet.id, cell })));
    if (dynamic.size) {
      blockerIndex = new RTree(); blockerIndex.bulkInsert(blockerCells.map(({ sheetId, cell }, id) => ({ id, unitId, sheetId, range: { startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column } })));
      candidateIndex = new RTree(); candidateIndex.bulkInsert([...owners].map(([key, owner]) => {
        const values = arrayResults.get(key);
        return { id: key, unitId, sheetId: owner.sheetId, range: !retained.has(key) && values ? { startRow: owner.row, startColumn: owner.column, endRow: owner.row + values.length - 1, endColumn: owner.column + values[0]!.length - 1 } : owner.range };
      }));
      mergeIndex = new RTree(); mergeIndex.bulkInsert(model.sheets.flatMap(sheet => sheet.merges.map((range, id) => ({ id: `${sheet.id}:${id}`, unitId, sheetId: sheet.id, range }))));
    }
    for (const owner of owners.values()) {
      const key = formulaCellKey(owner.sheetId, owner.row, owner.column);
      if (retained.has(key)) continue;
      if (mismatchedArrays.has(key)) throw new WorkbookFormatError('Array calculation must match its fixed source range.', 'WORKBOOK_UNSUPPORTED');
      let values = arrayResults.get(key);
      let bounds = arrayData?.arrayFormulaRange[unitId]?.[owner.sheetId]?.[owner.row]?.[owner.column];
      if (dynamic.has(key) && values) {
        const endRow = owner.row + values.length - 1, endColumn = owner.column + values[0]!.length - 1;
        const sheet = sheetsById.get(owner.sheetId)!;
        if (endRow >= 1_048_576 || endColumn >= 16_384) throw new WorkbookFormatError('Dynamic array exceeds worksheet bounds.', 'WORKBOOK_LIMIT');
        if (!mergeIndex!.searchGenerator({ unitId, sheetId: owner.sheetId, range: { startRow: owner.row, endRow, startColumn: owner.column, endColumn } }).next().done) throw new WorkbookFormatError('Dynamic array merged-cell collisions are unsupported.', 'WORKBOOK_UNSUPPORTED');
        for (const id of candidateIndex!.searchGenerator({ unitId, sheetId: owner.sheetId, range: { startRow: owner.row, endRow, startColumn: owner.column, endColumn } })) if (id !== key) throw new WorkbookFormatError('Overlapping array candidates need a separate collision adapter.', 'WORKBOOK_UNSUPPORTED');
        let blocker = false;
        for (const id of blockerIndex!.searchGenerator({ unitId, sheetId: owner.sheetId, range: { startRow: owner.row, endRow, startColumn: owner.column, endColumn } })) {
          const cell = blockerCells[Number(id)]!.cell;
          if (!(sourceOwnerKeys.has(key) ? cell.row >= owner.range.startRow && cell.row <= owner.range.endRow && cell.column >= owner.range.startColumn && cell.column <= owner.range.endColumn : cell.row === owner.row && cell.column === owner.column)) {
            if (!cell.formula && cell.kind === 'string' && cell.value === '') throw new WorkbookFormatError('Empty-string spill inputs need a separate collision adapter.', 'WORKBOOK_UNSUPPORTED');
            blocker = true; break;
          }
        }
        const actual = snapshot.sheets[owner.sheetId]?.cellData?.[owner.row]?.[owner.column];
        // This pin encodes errors as STRING and error-looking strings as
        // FORCE_STRING. Neither the text nor candidate geometry alone is proof.
        if (blocker && (actual?.v !== '#SPILL!' || actual.t !== CellValueType.STRING)) throw new WorkbookFormatError('Dynamic array collision did not produce an authoritative spill error.', 'WORKBOOK_UNSUPPORTED');
        if (blocker && actual?.v === '#SPILL!') {
          values = [[{ kind: 'error', value: '#SPILL!' }]];
          arrayResults.set(key, values); results.set(`${owner.sheetId}:${owner.row}:${owner.column}`, values[0]![0]!);
          bounds = { startRow: owner.row, endRow: owner.row, startColumn: owner.column, endColumn: owner.column };
        }
      }
      if (!bounds && (dynamic.has(key) || owner.range.endRow === owner.row && owner.range.endColumn === owner.column) && values?.length === 1 && values[0]?.length === 1) bounds = { startRow: owner.row, startColumn: owner.column, endRow: owner.row, endColumn: owner.column };
      if (!bounds || bounds.startRow !== owner.row || bounds.startColumn !== owner.column || (!dynamic.has(key) && (bounds.endRow !== owner.range.endRow || bounds.endColumn !== owner.range.endColumn))) throw new WorkbookFormatError('Calculated array ownership does not match its fixed source range.', 'WORKBOOK_UNSUPPORTED');
      if (!values) throw new WorkbookFormatError('Fixed source array did not produce an exact typed array result.', 'WORKBOOK_UNSUPPORTED');
      const actual = snapshot.sheets[owner.sheetId]?.cellData?.[owner.row]?.[owner.column], first = values[0]![0]!;
      const expected = first.kind === 'boolean' ? first.value ? 1 : 0 : first.value;
      const blank = first.kind === 'blank' && actual != null && actual.v == null;
      if (!blank && actual?.v !== expected && actual?.v !== first.value) throw new WorkbookFormatError('Array typed result and final engine anchor disagree.', 'WORKBOOK_UNSUPPORTED');
      const sheet = sheetsById.get(owner.sheetId)!;
      if (dynamic.has(key)) {
        const declared = declaredArrays.get(key)!;
        declared.range = { startRow: owner.row, startColumn: owner.column, endRow: owner.row + values.length - 1, endColumn: owner.column + values[0]!.length - 1 };
        sheet.rowCount = Math.max(sheet.rowCount, declared.range.endRow + 1); sheet.columnCount = Math.max(sheet.columnCount, declared.range.endColumn + 1);
        if (bounds.endRow !== declared.range.endRow || bounds.endColumn !== declared.range.endColumn) throw new WorkbookFormatError('Dynamic array matrix and ownership disagree.', 'WORKBOOK_UNSUPPORTED');
      }
      const cells = cellsBySheet.get(owner.sheetId)!;
      for (let row = 0; row < values.length; row++) for (let column = 0; column < values[row]!.length; column++) {
        if (!row && !column) continue;
        const position = { row: owner.row + row, column: owner.column + column }, previous = cells.get(`${position.row}:${position.column}`);
        cells.set(`${position.row}:${position.column}`, workbookCellSchema.parse({ ...position, ...(previous?.style === undefined ? {} : { style: previous.style }), ...values[row]![column]! }));
      }
      if (dynamic.has(key)) for (let row = owner.row; row <= owner.range.endRow; row++) for (let column = owner.column; column <= owner.range.endColumn; column++) {
        if (row === owner.row && column === owner.column || row < owner.row + values.length && column < owner.column + values[0]!.length) continue;
        const previous = cells.get(`${row}:${column}`);
        if (previous) cells.set(`${row}:${column}`, workbookCellSchema.parse({ row, column, ...(previous.style === undefined ? {} : { style: previous.style }), kind: 'blank', value: null }));
      }
    }
    if ([...cellsBySheet.values()].reduce((count, cells) => count + cells.size, 0) > 100_000) throw new WorkbookFormatError('Calculated cells exceed the workbook cell limit.', 'WORKBOOK_LIMIT');
    for (const sheet of model.sheets) sheet.cells = [...cellsBySheet.get(sheet.id)!.values()].sort((a, b) => a.row - b.row || a.column - b.column);
    const originals = new Map(original.sheets.flatMap(sheet => sheet.cells.map(cell => [formulaCellKey(sheet.id, cell.row, cell.column), cell] as const)));
    for (const sheet of model.sheets) sheet.cells = sheet.cells.map(cell => !cell.formula ? cell : retained.has(formulaCellKey(sheet.id, cell.row, cell.column))
      ? storedResultCell(cell, originals.get(formulaCellKey(sheet.id, cell.row, cell.column))!) : resultCell(cell, results.get(`${sheet.id}:${cell.row}:${cell.column}`)));
    return { model: workbookDocumentSchema.parse(model), retained };
  } finally { subscription?.dispose(); blockerIndex?.dispose(); mergeIndex?.dispose(); candidateIndex?.dispose(); univer.dispose(); }
}

export async function calculateWorkbook(input: WorkbookDocument): Promise<WorkbookDocument> { return (await calculateWorkbookResults(input)).model; }
