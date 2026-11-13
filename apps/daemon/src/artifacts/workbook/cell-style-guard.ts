import type { WorkbookCell, WorkbookCellEdit, WorkbookSheet, WorkbookStyle, WorkbookStructureEdit } from '@open-design/contracts/runtime/workbook';
import type { ReadWorkbook } from './reader.js';
import { WorkbookFormatError } from './package.js';
import { assertWorkbookSheetResourceContinuity } from './sheet-resources.js';

export interface WorkbookCellStyleSource { sheet: WorkbookSheet; styles: readonly WorkbookStyle[]; stylesheet: Buffer | undefined }
export type WorkbookCellStyleSources = ReadonlyMap<string, WorkbookCellStyleSource>;
/** Retain only the selected reader cell/style owners, not entire historical ZIP
 * packages. A historical reader must first qualify its prefix against the exact
 * current stylesheet that membership/axis preparation must leave unchanged. */
export function workbookCellStyleSource(source: ReadWorkbook, sheetId: string, current: ReadWorkbook = source): WorkbookCellStyleSource {
  if (source !== current) assertWorkbookSheetResourceContinuity(source, current);
  const sheet = source.model.sheets.find(sheet => sheet.id === sheetId);
  if (!sheet) throw new WorkbookFormatError('Workbook cell style source identity is missing.');
  return { sheet, styles: source.model.styles, stylesheet: current.parts.get('xl/styles.xml') };
}
export const workbookCellStyleSources = (source: ReadWorkbook): WorkbookCellStyleSources => new Map(source.model.sheets.map(sheet => [sheet.id, workbookCellStyleSource(source, sheet.id)]));
const key = (row: number, column: number) => `${row}:${column}`;
const invalid = (): never => { throw new WorkbookFormatError('Style edits need the formatting patch adapter.', 'WORKBOOK_UNSUPPORTED'); };

/** Cell.style is a preservation guard, never a style assignment. A qualified
 * membership/axis writer can compact the reader's style table without changing
 * a cell's raw style owner. Rebind only the exact original coordinate and the
 * reader's existing normalized-style equality under unchanged/prefix resources.
 * Existing exact prepared guards retain their established semantics.
 */
export function rebaseWorkbookCellStyleGuards(sources: WorkbookCellStyleSources, prepared: ReadWorkbook, edits: readonly WorkbookCellEdit[], structure: readonly WorkbookStructureEdit[] = []): readonly WorkbookCellEdit[] {
  if (!edits.length) return edits;
  const current = new Map(prepared.model.sheets.map(sheet => [sheet.id, new Map(sheet.cells.map(cell => [key(cell.row, cell.column), cell]))]));
  const indexed = new Map<string, Map<string, WorkbookCell>>(), projections = new Map(structure.map(edit => [edit.sheetId, edit]));
  const qualified = new Set<Buffer>();
  return edits.map(edit => {
    const actual = current.get(edit.sheetId)?.get(key(edit.cell.row, edit.cell.column)), actualIndex = actual?.style ?? 0, supplied = edit.cell.style ?? 0;
    if (supplied === actualIndex) return edit;
    const source = sources.get(edit.sheetId), projection = projections.get(edit.sheetId);
    const row = projection ? projection.rows[edit.cell.row] : edit.cell.row, column = projection ? projection.columns[edit.cell.column] : edit.cell.column;
    if (!source || !actual || row == null || column == null) return invalid();
    let cells = indexed.get(edit.sheetId);
    if (!cells) {
      if (source.sheet.id !== edit.sheetId) return invalid();
      cells = new Map(source.sheet.cells.map(cell => [key(cell.row, cell.column), cell])); indexed.set(edit.sheetId, cells);
    }
    const original = cells.get(key(row, column));
    if (!original || supplied !== (original.style ?? 0) || !source.styles[supplied] || !prepared.model.styles[actualIndex]
      || JSON.stringify(source.styles[supplied]) !== JSON.stringify(prepared.model.styles[actualIndex])) return invalid();
    const before = source.stylesheet;
    if (!before) return invalid();
    if (!qualified.has(before)) {
      const after = prepared.parts.get('xl/styles.xml');
      if (!after || !before.equals(after)) return invalid();
      qualified.add(before);
    }
    return { ...edit, cell: { ...edit.cell, style: actualIndex } };
  });
}
