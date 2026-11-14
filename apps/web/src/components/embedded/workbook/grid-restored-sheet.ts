import type { z } from 'zod';
import { WORKBOOK_MODEL_LIMITS, type WorkbookDocument, workbookEditPlanSchema } from '@open-design/contracts/runtime/workbook';
import { canonicalCommentJson } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { WorkbookSourceDeleteContext } from './sheet-delete-context';
type WorkbookEditPlan = z.infer<typeof workbookEditPlanSchema>;

/** Diff-only model closure. Compact reader ordinals from two reads are not
 * interchangeable, even when the retained raw OOXML style prefix is unchanged.
 * No style here authorizes a source write; actual historical assets are checked
 * independently by the contained writer. */
export function appendRestoredSheetModel(model: WorkbookDocument, context: WorkbookSourceDeleteContext) {
  const baseline = context.baseline;
  if (model.date1904 !== baseline.date1904 || canonicalCommentJson(model.themeColors) !== canonicalCommentJson(baseline.themeColors)
    || canonicalCommentJson(model.styles[0]) !== canonicalCommentJson(baseline.styleDefinitions[0]!.style)) throw Error('The restored worksheet interpretation changed.');
  const indices = new Map(model.styles.map((style, index) => [canonicalCommentJson(style), index]));
  const remap = new Map<number, number>();
  for (const entry of baseline.styleDefinitions) {
    const key = canonicalCommentJson(entry.style);
    let index = indices.get(key);
    if (index === undefined) {
      if (model.styles.length >= WORKBOOK_MODEL_LIMITS.styles) throw Error('The restored worksheet style closure exceeds its limit.');
      index = model.styles.length;
      model.styles.push(structuredClone(entry.style)); indices.set(key, index);
    }
    remap.set(entry.index, index);
  }
  const sheet = structuredClone(baseline.sheet);
  for (const item of [...sheet.cells, ...sheet.rowDimensions, ...sheet.columnDimensions]) {
    if (item.style === undefined) continue;
    const index = remap.get(item.style);
    if (index === undefined) throw Error('The restored worksheet style closure is incomplete.');
    item.style = index;
  }
  model.sheets.push(sheet);
  return sheet;
}

function indexHistoricalSheet(context: WorkbookSourceDeleteContext) {
  return {
    cells: new Map(context.baseline.sheet.cells.map(cell => [`${cell.row}:${cell.column}`, cell])),
    styles: new Map(context.baseline.styleDefinitions.map(entry => [entry.index, entry.style])),
  };
}

/** Translate only an exact historical cell's preservation guard. Formatting
 * edits remain in their existing adapter; absent/new coordinates cannot borrow
 * a neighboring style or turn a synthetic diff ordinal into source authority. */
export function restoreHistoricalCellGuards(plan: WorkbookEditPlan, model: WorkbookDocument, contexts: ReadonlyMap<string, WorkbookSourceDeleteContext>): WorkbookEditPlan {
  const owners = new Map<string, ReturnType<typeof indexHistoricalSheet>>();
  const structures = new Map(plan.structure?.map(item => [item.sheetId, item]));
  for (const edit of plan.edits) {
    const context = contexts.get(edit.sheetId);
    if (!context || edit.cell.style === undefined) continue;
    let owner = owners.get(edit.sheetId);
    if (!owner) { owner = indexHistoricalSheet(context); owners.set(edit.sheetId, owner); }
    const structure = structures.get(edit.sheetId);
    const row = structure ? structure.rows[edit.cell.row] : edit.cell.row;
    const column = structure ? structure.columns[edit.cell.column] : edit.cell.column;
    if (row === null || row === undefined || column === null || column === undefined) throw Error('A new restored coordinate has no historical cell style guard.');
    const historical = owner.cells.get(`${row}:${column}`);
    const originalStyle = historical?.style;
    const definition = owner.styles.get(originalStyle ?? 0);
    if (!historical || !definition || canonicalCommentJson(definition) !== canonicalCommentJson(model.styles[edit.cell.style])) throw Error('The restored cell style guard changed.');
    if (originalStyle === undefined) delete edit.cell.style;
    else edit.cell.style = originalStyle;
  }
  return plan;
}

