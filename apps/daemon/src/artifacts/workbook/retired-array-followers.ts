import { RTree } from '@univerjs/core';
import type { WorkbookCellEdit, WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { ReadWorkbook } from './reader.js';
import { formulaCellKey } from './formula-cache-policy.js';
import { WorkbookFormatError } from './package.js';

const refuse = (message: string): never => { throw new WorkbookFormatError(message, 'WORKBOOK_UNSUPPORTED'); };
export interface RetiredFollowerPlan {
  ordinary: WorkbookCellEdit[]; deferred: WorkbookCellEdit[];
  owners: Map<string, { sheetId: string; row: number; column: number; formula: string }>;
}
/** Source package ownership and explicit authored edits are the only evidence.
 * Browser projections, submitted result caches and asserted modes are ignored. */
export function partitionRetiredFollowerEdits(source: ReadWorkbook, edits: readonly WorkbookCellEdit[], dynamic: ReadonlySet<string>): RetiredFollowerPlan {
  const requested = new Map<string, WorkbookCellEdit>();
  for (const edit of edits) { const id = formulaCellKey(edit.sheetId, edit.cell.row, edit.cell.column); if (requested.has(id)) throw new WorkbookFormatError('Duplicate workbook cell edit.'); requested.set(id, edit); }
  const followers = new Map<string, { sheetId: string; row: number; column: number; formula: string }>();
  for (const sheet of source.model.sheets) {
    const cells = new Map(sheet.cells.map(cell => [formulaCellKey(sheet.id, cell.row, cell.column), cell]));
    for (const owner of sheet.arrayFormulas ?? []) {
      const id = formulaCellKey(sheet.id, owner.row, owner.column), formula = cells.get(id)?.formula;
      if (!dynamic.has(id) || !formula || requested.has(id) && requested.get(id)!.cell.formula !== formula) continue;
      for (let row = owner.range.startRow; row <= owner.range.endRow; row++) for (let column = owner.range.startColumn; column <= owner.range.endColumn; column++) if (row !== owner.row || column !== owner.column) followers.set(formulaCellKey(sheet.id, row, column), { sheetId: sheet.id, row: owner.row, column: owner.column, formula });
    }
  }
  const result: RetiredFollowerPlan = { ordinary: [], deferred: [], owners: new Map() };
  for (const edit of edits) {
    const owner = followers.get(formulaCellKey(edit.sheetId, edit.cell.row, edit.cell.column));
    if (!owner) result.ordinary.push(edit);
    else { result.deferred.push(edit); result.owners.set(formulaCellKey(owner.sheetId, owner.row, owner.column), owner); }
  }
  return result;
}
export function assertRetiredFollowersOutsideOwners(model: WorkbookDocument, plan: RetiredFollowerPlan): void {
  const cells = new Map(model.sheets.flatMap(sheet => sheet.cells.map(cell => [formulaCellKey(sheet.id, cell.row, cell.column), cell] as const)));
  for (const [id, owner] of plan.owners) if (cells.get(id)?.formula !== owner.formula) refuse('The source array owner changed during retired follower admission.');
  const index = new RTree(), unitId = 'retired-follower-admission';
  try {
    index.bulkInsert(model.sheets.flatMap(sheet => (sheet.arrayFormulas ?? []).map(owner => ({ id: formulaCellKey(sheet.id, owner.row, owner.column), unitId, sheetId: sheet.id, range: owner.range }))));
    for (const { sheetId, cell } of plan.deferred) if (!index.searchGenerator({ unitId, sheetId, range: { startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column } }).next().done) refuse('A requested follower is still owned by an array. Save the owner change before editing that cell.');
  } finally { index.dispose(); }
}
export function arrayTopology(model: WorkbookDocument): Map<string, string> {
  return new Map(model.sheets.flatMap(sheet => (sheet.arrayFormulas ?? []).map(owner => [formulaCellKey(sheet.id, owner.row, owner.column), JSON.stringify([owner.kind, owner.range.startRow, owner.range.endRow, owner.range.startColumn, owner.range.endColumn])] as const)));
}
export function assertSameArrayTopology(before: WorkbookDocument, after: WorkbookDocument): void {
  const expected = arrayTopology(before), final = arrayTopology(after);
  if (expected.size !== final.size || [...final].some(([id, shape]) => expected.get(id) !== shape)) refuse('Retired follower inputs changed array topology. Save the owner change before editing those cells.');
}
