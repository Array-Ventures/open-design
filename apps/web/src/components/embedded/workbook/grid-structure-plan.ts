import type { ICellData, IWorkbookData } from '@univerjs/core';
import type { WorkbookDocument, WorkbookStructureEdit } from '@open-design/contracts/runtime/workbook';
import { workbookAxisProjection } from '@open-design/contracts/runtime/workbook-structure';
import { gridStructureIdentity, hasWorkbookStructureIdentity, stripWorkbookStructureIdentity } from './grid-structure-identity';

/** Compare SDK output against a moved source baseline. The contained writer
 * independently performs the same geometric ownership transform on actual XML;
 * ordinary scalar/style/dimension deltas are then expressed in final coordinates. */
export function gridStructuralBaseline(model: WorkbookDocument, sourceSha256: string, initial: IWorkbookData, current: IWorkbookData) {
  const before = stripWorkbookStructureIdentity(initial), after = stripWorkbookStructureIdentity(current);
  // Older protected drafts retain scalar editing. Missing identity is never
  // interpreted as deletion of all source axes, and never enables the menu.
  if (!model.worksheetStructureEditable || !hasWorkbookStructureIdentity(initial) || !hasWorkbookStructureIdentity(current)) return { model, before, after, structure: [] as WorkbookStructureEdit[] };
  const maps = gridStructureIdentity(initial, current, sourceSha256), next = structuredClone(model), structure: WorkbookStructureEdit[] = [];
  for (const sheet of next.sheets) {
    const old = before.sheets[sheet.id]!;
    const map = maps[sheet.id];
    if (!map) {
      // An acknowledged SDK window can retain inserted blank tail axes that
      // a fresh source preview does not materialize. Its validated identities
      // still own those coordinates; unchanged dimensions are not new edits.
      sheet.rowCount = Math.max(sheet.rowCount, old.rowCount!);
      sheet.columnCount = Math.max(sheet.columnCount, old.columnCount!);
      continue;
    }
    const rows = workbookAxisProjection(old.rowCount!, map.rows, 1048576), columns = workbookAxisProjection(old.columnCount!, map.columns, 16384);
    const move = (row: number, column: number) => { const r = rows.point(row), c = columns.point(column); return r === null || c === null ? null : { row: r, column: c }; };
    const range = (bounds: { startRow: number; endRow: number; startColumn: number; endColumn: number }) => {
      const row = rows.interval(bounds.startRow, bounds.endRow), column = columns.interval(bounds.startColumn, bounds.endColumn);
      return !row || !column ? null : { ...bounds, startRow: row[0], endRow: row[1], startColumn: column[0], endColumn: column[1] };
    };
    const matrix: typeof old.cellData = {};
    for (const [row, cells] of Object.entries(old.cellData ?? {})) for (const [column, cell] of Object.entries(cells ?? {})) { const position = move(Number(row), Number(column)); if (position) (matrix[position.row] ??= {})[position.column] = cell as ICellData; }
    old.cellData = matrix;
    for (const [axis, field, origins] of [['row', 'rowData', map.rows], ['column', 'columnData', map.columns]] as const) {
      const retained = old[field] ?? {}, dimensions: Record<number, NonNullable<typeof old.rowData>[number]> = {};
      for (const [index, origin] of origins.entries()) if (origin !== null && retained[origin]) dimensions[index] = retained[origin]!;
      if (axis === 'row') old.rowData = dimensions; else old.columnData = dimensions;
    }
    old.rowCount = sheet.rowCount = map.rows.length; old.columnCount = sheet.columnCount = map.columns.length;
    old.mergeData = (old.mergeData ?? []).flatMap(bounds => { const next = range(bounds); return next && (next.startRow !== next.endRow || next.startColumn !== next.endColumn) ? [next] : []; });
    sheet.merges = sheet.merges.flatMap(bounds => { const next = range(bounds); return next && (next.startRow !== next.endRow || next.startColumn !== next.endColumn) ? [next] : []; });
    sheet.cells = sheet.cells.flatMap(cell => { const position = move(cell.row, cell.column); return position ? [{ ...cell, ...position }] : []; });
    sheet.rowDimensions = sheet.rowDimensions.flatMap(entry => { const index = rows.point(entry.index); return index === null ? [] : [{ ...entry, index }]; });
    sheet.columnDimensions = sheet.columnDimensions.flatMap(entry => { const index = columns.point(entry.index); return index === null ? [] : [{ ...entry, index }]; });
    structure.push({ sheetId: sheet.id, sourceRows: rows.sourceCount, sourceColumns: columns.sourceCount, rows: map.rows, columns: map.columns });
  }
  return { model: next, before, after, structure };
}
