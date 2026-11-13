import { gridStructuralBaseline } from './grid-structure-plan';
import { CellValueType, WorksheetHiddenState, type ICellData, type IWorkbookData } from '@univerjs/presets';
import { workbookEditPlanSchema, type WorkbookCell, type WorkbookDimensionEdit, type WorkbookDocument, type WorkbookStyleEdit, type WorkbookVisibilityEdit } from '@open-design/contracts/runtime/workbook';

import { workbookRichText } from './grid-rich-text';
import { gridDimensionEdits } from './grid-dimensions';

export class WorkbookEditError extends Error {}
const fail = (message: string): never => { throw new WorkbookEditError(message); };
/** Object insertion order is not a workbook change. */
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
function same(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
function unchangedStyles(initial: IWorkbookData['styles'], current: IWorkbookData['styles']) {
  return Object.entries(initial).every(([key, value]) => Object.hasOwn(current, key) && same(value, current[key]));
}
function formatting(cell: ICellData) {
  const other = { ...cell };
  for (const key of ['v', 't', 'f', 'p', 's'] as const) delete other[key];
  return other;
}
function resolvedStyle(cell: ICellData, styles: IWorkbookData['styles'], inherited: unknown) {
  const resolve = (value: unknown): Record<string, unknown> => {
    if (typeof value === 'string' && !Object.hasOwn(styles, value)) return fail('This cell style is missing from the workbook.');
    const result = typeof value === 'string' ? styles[value] : value;
    if (result == null) return {};
    if (typeof result !== 'object' || Array.isArray(result)) return fail('This cell style cannot be validated.');
    return result as Record<string, unknown>;
  };
  return { ...resolve(inherited), ...resolve(cell.s) };
}
function styleDelta(a: Record<string, unknown>, b: Record<string, unknown>): Partial<WorkbookStyleEdit> {
  const result: Partial<WorkbookStyleEdit> = {};
  const remainderA = { ...a }, remainderB = { ...b };
  if (b.fs !== undefined && (typeof b.fs !== 'number' || !Number.isFinite(b.fs) || b.fs <= 0 || b.fs > 512)) return fail('This font size cannot be saved.');
  if (!same(a.fs, b.fs)) {
    if (typeof b.fs !== 'number') return fail('This font size cannot be saved.');
    result.fontSize = b.fs;
  }
  delete remainderA.fs; delete remainderB.fs;
  for (const [key, property] of [['bl', 'bold'], ['it', 'italic']] as const) {
    if (!same(a[key], b[key])) {
      if (b[key] !== undefined && b[key] !== null && b[key] !== 0 && b[key] !== 1) fail('This font change cannot be saved yet.');
      result[property] = b[key] === 1;
    }
    delete remainderA[key]; delete remainderB[key];
  }
  for (const [key, property] of [['cl', 'fontColor'], ['bg', 'fillColor']] as const) {
    if (!same(a[key], b[key])) {
      const value = b[key] as { rgb?: unknown } | null | undefined;
      if (value?.rgb === (key === 'cl' ? 'rgb(0, 0, 0)' : 'rgba(0,0,0,0)') || value == null || typeof value === 'object' && (Object.keys(value).length === 0 || Object.keys(value).length === 1 && value.rgb === null)) result[property] = null;
      else {
        if (typeof value !== 'object' || Object.keys(value).some(key => key !== 'rgb') || typeof value.rgb !== 'string' || !/^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$/.test(value.rgb)) fail('This color change cannot be saved yet.');
        const rgb = value.rgb as string; result[property] = rgb.length === 7 ? `FF${rgb.slice(1)}` : `${rgb.slice(7)}${rgb.slice(1, 7)}`;
      }
    }
    delete remainderA[key]; delete remainderB[key];
  }
  if (!same(remainderA, remainderB)) fail('This formatting change cannot be saved yet. Keep this workbook open.');
  return result;
}
const sheetContent = ['name', 'rowCount', 'columnCount', 'mergeData', 'freeze', 'defaultRowHeight', 'defaultColumnWidth', 'defaultStyle'] as const;
function positions(matrix: IWorkbookData['sheets'][string]['cellData']) {
  const result = new Set<string>();
  for (const [row, cells] of Object.entries(matrix ?? {})) for (const column of Object.keys(cells ?? {})) result.add(`${row}:${column}`);
  return result;
}
function cellAt(matrix: IWorkbookData['sheets'][string]['cellData'], row: number, column: number): ICellData { return matrix?.[row]?.[column] ?? {}; }
function scalar(cell: ICellData, original: WorkbookCell | undefined, row: number, column: number, model: WorkbookDocument): WorkbookCell {
  if(original?.kind==='string'&&original.runs!==undefined&&model.richTextMetadata!=='verified')return fail('This rich draft uses an older source preview. Keep the draft; verify the source before saving rich edits.');
  const position = { row, column, ...(original?.style === undefined ? {} : { style: original.style }) };
  if (cell.f) return { ...position, kind: 'blank', value: null, formula: cell.f };
  let rich: ReturnType<typeof workbookRichText>;try { rich=workbookRichText(cell,original,model); }catch(error){return fail(error instanceof Error?error.message:'The rich cell could not be validated.');}
  if(rich)return {...position,kind:'string',...rich};
  const value = cell.v;
  if (value === null || value === undefined) return { ...position, kind: 'blank', value: null };
  if (cell.t === CellValueType.BOOLEAN) {
    if (value !== 0 && value !== 1 && typeof value !== 'boolean') return fail('The boolean cell value could not be validated.');
    return { ...position, kind: 'boolean', value: Boolean(value) };
  }
  if (cell.t === CellValueType.NUMBER || typeof value === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail('The numeric cell value could not be validated.');
    return { ...position, kind: 'number', value };
  }
  if (typeof value !== 'string') return fail('This cell value cannot be saved yet. Your changes are still in the workbook.');
  return { ...position, kind: 'string', value };
}
/** Compare against the grid's actual initial snapshot (including its defaults),
 * never serialize Univer as XLSX. Unchanged formula caches/rich runs remain in
 * the source package. Unsupported mutations block the whole save, not just the
 * unsupported cells, so a successful save cannot silently discard an edit. */
export function workbookGridEdits(model: WorkbookDocument, sourceSha256: string, initial: IWorkbookData, current: IWorkbookData) {
  const projected = gridStructuralBaseline(model, sourceSha256, initial, current);
  model = projected.model; initial = projected.before; current = projected.after;
  if (!same(initial.sheetOrder, current.sheetOrder) || !same(Object.keys(initial.sheets).sort(), Object.keys(current.sheets).sort())) fail('Sheet structure changed. Keep this workbook open; these changes cannot be saved yet.');
  if (!unchangedStyles(initial.styles, current.styles) || initial.dateSystem !== current.dateSystem) fail('Workbook formatting changed. Keep this workbook open; these changes cannot be saved yet.');
  const edits: { sheetId: string; cell: WorkbookCell }[] = [];
  const dimensions: WorkbookDimensionEdit[] = [];
  const styles: WorkbookStyleEdit[] = [];
  const visibility: WorkbookVisibilityEdit[] = [];
  for (const sheet of model.sheets) {
    const before = initial.sheets[sheet.id], after = current.sheets[sheet.id];
    if (!before || !after) return fail('Sheet structure changed. Keep this workbook open.');
    if (sheetContent.some(key => !same(before[key], after[key]))) fail('Sheet formatting or structure changed. Keep this workbook open; these changes cannot be saved yet.');
    if (!same(before.hidden, after.hidden)) {
      if (!model.worksheetVisibilityEditable || sheet.visibility === 'veryHidden' || after.hidden !== WorksheetHiddenState.VISIBLE && after.hidden !== WorksheetHiddenState.HIDDEN) fail('This worksheet visibility change cannot be saved.');
      visibility.push({ sheetId: sheet.id, visibility: after.hidden === WorksheetHiddenState.HIDDEN ? 'hidden' : 'visible' });
    }
    dimensions.push(...gridDimensionEdits(sheet, before, after));
    const originals = new Map(sheet.cells.map(cell => [`${cell.row}:${cell.column}`, cell]));
    const coordinates = new Set([...positions(before.cellData), ...positions(after.cellData)]);
    for (const coordinate of coordinates) {
      const [row, column] = coordinate.split(':').map(Number) as [number, number];
      if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 0 || column < 0 || row >= sheet.rowCount || column >= sheet.columnCount) fail('An edited cell is outside the workbook.');
      const a = cellAt(before.cellData, row, column), b = cellAt(after.cellData, row, column);
      if (same(a, b)) continue;
      const { v: av, t: at, f: af, p: ap } = a;
      const { v: bv, t: bt, f: bf, p: bp } = b;
      const aFormatting = formatting(a), bFormatting = formatting(b);
      // Deleting a cell may remove its grid style; the OOXML patch retains the
      // original style. Any positive new style change needs its own writer.
      if (!same(aFormatting, bFormatting) && !(Object.keys(b).length === 0)) fail('Cell metadata changed. Keep this workbook open; these changes cannot be saved yet.');
      if (Object.keys(b).length !== 0) {
        const inherited = before.rowData?.[row]?.s ?? before.columnData?.[column]?.s ?? before.defaultStyle;
        const delta = styleDelta(resolvedStyle(a, initial.styles, inherited), resolvedStyle(b, current.styles, inherited));
        if (Object.keys(delta).length) {
          if (ap || bp) fail('Rich text formatting changes cannot be saved yet. Keep this workbook open.');
          styles.push({ sheetId: sheet.id, row, column, ...delta });
        }
      }
      if (bf && bp && !same(ap,bp)) fail('Replace the formula before authoring rich cell content.');
      if (af && af === bf && same(ap, bp)) continue; // cached results are not user edits
      if (same({ v: av, t: at, f: af, p: ap }, { v: bv, t: bt, f: bf, p: bp })) continue;
      const next = scalar(b, originals.get(coordinate), row, column, model);
      if (!same(next,originals.get(coordinate))) edits.push({sheetId:sheet.id,cell:next});
    }
  }
  // Clean ACK windows are not edits. Carry their validated ownership only
  // when formatting needs a coordinate the fresh XML has not materialized yet.
  for (const window of projected.logicalWindows) {
    const needsWindow = styles.some(edit => edit.sheetId === window.sheetId && (edit.row >= window.sourceRows || edit.column >= window.sourceColumns))
      || dimensions.some(edit => edit.sheetId === window.sheetId && edit.index >= (edit.axis === 'row' ? window.sourceRows : window.sourceColumns));
    if (needsWindow) projected.structure.push({ sheetId: window.sheetId, sourceRows: window.rowCount, sourceColumns: window.columnCount,
      rows: Array.from({ length: window.rowCount }, (_, index) => index), columns: Array.from({ length: window.columnCount }, (_, index) => index) });
  }
  if (!Object.values(current.sheets).some(sheet => sheet.hidden === undefined || sheet.hidden === WorksheetHiddenState.VISIBLE)) fail('Keep at least one worksheet visible.');
  return workbookEditPlanSchema.parse({ sourceSha256, edits, ...(dimensions.length ? { dimensions } : {}), ...(styles.length ? { styles } : {}), ...(visibility.length ? { visibility } : {}), ...(projected.structure.length ? { structure: projected.structure } : {}) });
}
