import { randomUUID } from 'node:crypto';
import { BooleanNumber, CellValueType, DateSystem, LocaleType, Univer, type ICellData, type IObjectMatrixPrimitiveType, type IWorkbookData } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { BaseFunction, SetDefinedNameMutation, SetSuperTableMutation, UniverFormulaEnginePlugin, type ArrayValueObject, type BaseValueObject } from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-formula/facade';
import { workbookCellSchema, workbookDocumentSchema, type WorkbookCell, type WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError } from './package.js';
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
interface TypedResult { kind: 'number' | 'boolean' | 'string' | 'error'; value: number | boolean | string }
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

/** Pure model calculation, for execution inside the bounded workbook worker.
 * Does not write files or trust cached results supplied by a browser. */
export async function calculateWorkbook(input: WorkbookDocument): Promise<WorkbookDocument> {
  const model = workbookDocumentSchema.parse(input);
  if (!model.sheets.some(sheet => sheet.cells.some(cell => cell.formula))) return model;
  const capture = `EVEBOT_CACHE_${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const results = new Map<string, TypedResult>();
  let unsupportedArray = false;
  // Capture the engine's value object before its snapshot flattens errors and
  // error-looking strings. This function returns the original value unchanged
  // and exists only in this disposable calculation instance, never in exports.
  class CaptureResult extends BaseFunction {
    minParams = 1;
    maxParams = 1;
    calculate(value: BaseValueObject): BaseValueObject {
      let scalar: BaseValueObject | null | undefined | void = value;
      if (value.isArray()) {
        const array = value as ArrayValueObject;
        if (array.getRowCount() !== 1 || array.getColumnCount() !== 1) { unsupportedArray = true; return value; }
        scalar = array.get(0, 0);
      }
      if (scalar) {
        const kind = scalar.isError() ? 'error' : scalar.isBoolean() ? 'boolean' : scalar.isNumber() ? 'number' : 'string';
        results.set(`${this.subUnitId}:${this.row}:${this.column}`, { kind, value: scalar.getValue() });
      }
      return value;
    }
  }
  const sheets: IWorkbookData['sheets'] = {};
  for (const sheet of model.sheets) {
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {};
    for (const cell of sheet.cells) (cellData[cell.row] ??= {})[cell.column] = { ...engineCell(cell, capture, cell.formula ? calculationFormula(cell.formula, sheet.id, cell, model.tables ?? []) : undefined), ...(cell.style === undefined ? {} : { s: String(cell.style) }) };
    sheets[sheet.id] = { id: sheet.id, name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, cellData,
      rowData: Object.fromEntries(sheet.rowDimensions.map(row => [row.index, { hd: row.hidden ? BooleanNumber.TRUE : BooleanNumber.FALSE, ...(row.style === undefined ? {} : { s: String(row.style) }) }])),
      columnData: Object.fromEntries(sheet.columnDimensions.map(column => [column.index, { hd: column.hidden ? BooleanNumber.TRUE : BooleanNumber.FALSE, ...(column.style === undefined ? {} : { s: String(column.style) }) }])),
    };
  }
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: SheetsEnUS } });
  try {
    univer.registerPlugin(UniverFormulaEnginePlugin, { function: [[CaptureResult, capture]] });
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    const api = FUniver.newAPI(univer);
    api.createWorkbook({ id: 'evebot-workbook-calculation', name: 'Workbook', dateSystem: model.date1904 ? DateSystem.Date1904 : DateSystem.Date1900,
      sheetOrder: model.sheets.map(sheet => sheet.id), sheets,
      styles: Object.fromEntries(model.styles.map((style, index) => [String(index), style.numberFormat ? { n: { pattern: style.numberFormat } } : {}])),
    });
    const unitId = 'evebot-workbook-calculation';
    for (const table of model.tables ?? []) api.syncExecuteCommand(SetSuperTableMutation.id, { unitId, tableName: table.name,
      reference: { sheetId: table.sheetId, range: table.range, titleMap: new TableColumnMap(table.columns), showHeader: table.header, showFooter: table.totals } }, { local: true });
    for (const [index, name] of (model.definedNames ?? []).entries()) api.syncExecuteCommand(SetDefinedNameMutation.id, { unitId, id: `name-${index}`, name: name.name, formulaOrRefString: name.formula,
      ...(name.sheetId === undefined ? {} : { localSheetId: name.sheetId }), ...(name.hidden === undefined ? {} : { hidden: name.hidden }) }, { local: true });
    const formula = api.getFormula();
    formula.executeCalculation();
    await formula.onCalculationResultApplied(5000);
    if (unsupportedArray) throw new WorkbookFormatError('Spill calculation needs its workbook adapter.', 'WORKBOOK_UNSUPPORTED');
    for (const sheet of model.sheets) sheet.cells = sheet.cells.map(cell => cell.formula ? resultCell(cell, results.get(`${sheet.id}:${cell.row}:${cell.column}`)) : cell);
    return workbookDocumentSchema.parse(model);
  } finally { univer.dispose(); }
}
