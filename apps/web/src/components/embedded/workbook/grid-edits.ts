import { CellValueType, type ICellData, type IWorkbookData } from '@univerjs/presets';
import { workbookEditPlanSchema, type WorkbookCell, type WorkbookDimensionEdit, type WorkbookDocument, type WorkbookStyleEdit } from '@open-design/contracts/runtime/workbook';

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
      if (value == null) result[property] = null;
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
const sheetContent = ['name', 'hidden', 'rowCount', 'columnCount', 'mergeData', 'freeze', 'defaultRowHeight', 'defaultColumnWidth', 'defaultStyle'] as const;
function positions(matrix: IWorkbookData['sheets'][string]['cellData']) {
  const result = new Set<string>();
  for (const [row, cells] of Object.entries(matrix ?? {})) for (const column of Object.keys(cells ?? {})) result.add(`${row}:${column}`);
  return result;
}
function cellAt(matrix: IWorkbookData['sheets'][string]['cellData'], row: number, column: number): ICellData { return matrix?.[row]?.[column] ?? {}; }
function richText(cell: ICellData): string | undefined {
  if (!cell.p) return undefined;
  const text = cell.p.body?.dataStream;
  if (typeof text !== 'string' || !text.endsWith('\r\n')) return fail('This cell contains unsupported text content. Your changes are still in the workbook.');
  return text.slice(0, -2);
}
function scalar(cell: ICellData, original: WorkbookCell | undefined, row: number, column: number): WorkbookCell {
  const position = { row, column, ...(original?.style === undefined ? {} : { style: original.style }) };
  if (cell.f) return { ...position, kind: 'blank', value: null, formula: cell.f };
  const rich = richText(cell), value = rich ?? cell.v;
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
  if (!same(initial.sheetOrder, current.sheetOrder) || !same(Object.keys(initial.sheets).sort(), Object.keys(current.sheets).sort())) fail('Sheet structure changed. Keep this workbook open; these changes cannot be saved yet.');
  if (!unchangedStyles(initial.styles, current.styles) || initial.dateSystem !== current.dateSystem) fail('Workbook formatting changed. Keep this workbook open; these changes cannot be saved yet.');
  const edits: { sheetId: string; cell: WorkbookCell }[] = [];
  const dimensions: WorkbookDimensionEdit[] = [];
  const styles: WorkbookStyleEdit[] = [];
  for (const sheet of model.sheets) {
    const before = initial.sheets[sheet.id], after = current.sheets[sheet.id];
    if (!before || !after) return fail('Sheet structure changed. Keep this workbook open.');
    if (sheetContent.some(key => !same(before[key], after[key]))) fail('Sheet formatting or structure changed. Keep this workbook open; these changes cannot be saved yet.');
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
      if (af && af === bf && same(ap, bp)) continue; // cached results are not user edits
      if (same({ v: av, t: at, f: af, p: ap }, { v: bv, t: bt, f: bf, p: bp })) continue;
      if (bp && !same(ap, bp)) {
        const runs = bp.body?.textRuns ?? [];
        if (runs.some(run => run.ts && Object.values(run.ts).some(value => value !== undefined))) fail('Rich text formatting changed. Keep this workbook open; these changes cannot be saved yet.');
      }
      edits.push({ sheetId: sheet.id, cell: scalar(b, originals.get(coordinate), row, column) });
    }
  }
  return workbookEditPlanSchema.parse({ sourceSha256, edits, ...(dimensions.length ? { dimensions } : {}), ...(styles.length ? { styles } : {}) });
}
