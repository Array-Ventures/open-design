import type { IColumnData, IRowData, IWorksheetData } from '@univerjs/presets';
import type { WorkbookDimensionEdit, WorkbookSheet } from '@open-design/contracts/runtime/workbook';

function dimension(input: Partial<IRowData & IColumnData>, axis: 'row' | 'column') {
  const { h, w, ah, ia, hd, s, ...other } = input;
  return { size: axis === 'row' ? ia ? ah ?? h : h : w, hidden: Boolean(hd),
    format: JSON.stringify({ ...other, ...(s === undefined || s === null || s === '0' ? {} : { s }) }) };
}
/** Grid pixels become Excel points/character units; unrelated row/column
 * metadata is never inferred as a resize or silently dropped. */
export function gridDimensionEdits(sheet: WorkbookSheet, before: Partial<IWorksheetData>, after: Partial<IWorksheetData>): WorkbookDimensionEdit[] {
  const edits: WorkbookDimensionEdit[] = [];
  for (const [axis, key] of [['row', 'rowData'], ['column', 'columnData']] as const) {
    const old = before[key] ?? {}, next = after[key] ?? {};
    for (const indexText of new Set([...Object.keys(old), ...Object.keys(next)])) {
      const index = Number(indexText), a = dimension(old[index] ?? {}, axis), b = dimension(next[index] ?? {}, axis);
      if (!Number.isSafeInteger(index) || index < 0 || index >= (axis === 'row' ? sheet.rowCount : sheet.columnCount) || a.format !== b.format) throw new Error('Row or column formatting changed. Keep this workbook open; these changes cannot be saved yet.');
      const defaultSize = axis === 'row' ? before.defaultRowHeight : before.defaultColumnWidth;
      const size = b.size ?? defaultSize, sizeChanged = size !== (a.size ?? defaultSize), hiddenChanged = b.hidden !== a.hidden;
      if (sizeChanged && (typeof size !== 'number' || !Number.isFinite(size))) throw new Error('The resized dimension could not be validated.');
      if (sizeChanged || hiddenChanged) edits.push({ sheetId: sheet.id, axis, index,
        ...(sizeChanged ? { size: axis === 'row' ? size! * 3 / 4 : size! < 12 ? size! / 12 : (size! - 5) / 7 } : {}),
        ...(hiddenChanged ? { hidden: b.hidden } : {}) });
    }
  }
  return edits;
}
