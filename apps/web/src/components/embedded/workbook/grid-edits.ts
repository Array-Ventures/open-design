import { CellValueType, type ICellData, type IWorkbookData } from '@univerjs/presets';
import { workbookEditPlanSchema, type WorkbookCell, type WorkbookDimensionEdit, type WorkbookDocument } from '@open-design/contracts/runtime/workbook';

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
const sheetContent = ['name', 'hidden', 'rowCount', 'columnCount', 'mergeData', 'freeze', 'defaultRowHeight', 'defaultColumnWidth'] as const;
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
  if (!same(initial.styles, current.styles) || initial.dateSystem !== current.dateSystem) fail('Workbook formatting changed. Keep this workbook open; these changes cannot be saved yet.');
  const edits: { sheetId: string; cell: WorkbookCell }[] = [];
  const dimensions: WorkbookDimensionEdit[] = [];
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
      const { v: av, t: at, f: af, p: ap, ...aFormatting } = a;
      const { v: bv, t: bt, f: bf, p: bp, ...bFormatting } = b;
      // Deleting a cell may remove its grid style; the OOXML patch retains the
      // original style. Any positive new style change needs its own writer.
      if (!same(aFormatting, bFormatting) && !(Object.keys(b).length === 0)) fail('Cell formatting changed. Keep this workbook open; these changes cannot be saved yet.');
      if (af && af === bf && same(ap, bp)) continue; // cached results are not user edits
      if (same({ v: av, t: at, f: af, p: ap }, { v: bv, t: bt, f: bf, p: bp })) continue;
      if (bp && !same(ap, bp)) {
        const runs = bp.body?.textRuns ?? [];
        if (runs.some(run => run.ts && Object.values(run.ts).some(value => value !== undefined))) fail('Rich text formatting changed. Keep this workbook open; these changes cannot be saved yet.');
      }
      edits.push({ sheetId: sheet.id, cell: scalar(b, originals.get(coordinate), row, column) });
    }
  }
  return workbookEditPlanSchema.parse({ sourceSha256, edits, ...(dimensions.length ? { dimensions } : {}) });
}
