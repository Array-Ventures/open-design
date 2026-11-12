import { RANGE_TYPE, RTree } from '@univerjs/core';
import { deserializeRangeWithSheet, sequenceNodeType } from '@univerjs/engine-formula';
import type { WorkbookDocument, WorkbookRange } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError } from './package.js';
import { formulaCellKey, type FormulaDependencyNode } from './formula-cache-policy.js';

/** The pinned scalar graph omits references to array followers. Add only edges
 * established by explicit source ownership and the pinned reference decoder.
 * Names/tables in array workbooks are refused at admission until their expanded
 * reference ownership is available; no formula parser is invented here. */
export function withArrayFollowerDependencies(model: WorkbookDocument, trees: readonly FormulaDependencyNode[], unitId: string,
  nodes: (formula: string) => readonly (string | { nodeType: number; token: string })[] | undefined, executionRanges: ReadonlyMap<string, WorkbookRange> = new Map()): FormulaDependencyNode[] {
  const result = trees.map(tree => ({ ...tree, parents: [...tree.parents] }));
  const byCell = new Map(result.filter(tree => tree.unitId === unitId).map(tree => [formulaCellKey(tree.subUnitId, tree.row, tree.column), tree]));
  const owners = model.sheets.flatMap(sheet => (sheet.arrayFormulas ?? []).map(owner => ({ ...owner, sheetId: sheet.id, range: executionRanges.get(formulaCellKey(sheet.id, owner.row, owner.column)) ?? owner.range })));
  if (!owners.length) return result;
  const sheets = new Map(model.sheets.map(sheet => [sheet.name.toLowerCase(), sheet.id]));
  const index = new RTree();
  let work = 0;
  try {
    index.bulkInsert(owners.map((owner, id) => ({ id, unitId, sheetId: owner.sheetId, range: owner.range })));
    for (const sheet of model.sheets) for (const cell of sheet.cells) {
      if (!cell.formula) continue;
      const consumer = byCell.get(formulaCellKey(sheet.id, cell.row, cell.column));
      if (!consumer) throw new WorkbookFormatError('Array dependent graph is incomplete.', 'WORKBOOK_UNSUPPORTED');
      const tokens = nodes(cell.formula);
      if (!tokens) throw new WorkbookFormatError('Array reference analysis is unavailable.', 'WORKBOOK_UNSUPPORTED');
      work += tokens.length;
      if (work > 1_000_000) throw new WorkbookFormatError('Array reference analysis exceeds its work limit.', 'WORKBOOK_LIMIT');
      for (const token of tokens) {
        if (typeof token === 'string' || token.nodeType !== sequenceNodeType.REFERENCE) continue;
        const ref = deserializeRangeWithSheet(token.token);
        if (ref.unitId) throw new WorkbookFormatError('External array references are unsupported.', 'WORKBOOK_UNSUPPORTED');
        const sheetId = ref.sheetName ? sheets.get(ref.sheetName.toLowerCase()) : sheet.id;
        if (!sheetId) throw new WorkbookFormatError('Array reference sheet is unavailable.', 'WORKBOOK_UNSUPPORTED');
        const bounds = { ...ref.range };
        if (bounds.rangeType === RANGE_TYPE.ROW || bounds.rangeType === RANGE_TYPE.ALL) { bounds.startColumn = 0; bounds.endColumn = 16_383; }
        if (bounds.rangeType === RANGE_TYPE.COLUMN || bounds.rangeType === RANGE_TYPE.ALL) { bounds.startRow = 0; bounds.endRow = 1_048_575; }
        if (![bounds.startRow, bounds.endRow, bounds.startColumn, bounds.endColumn].every(value => Number.isSafeInteger(value) && value >= 0) || bounds.startRow > bounds.endRow || bounds.startColumn > bounds.endColumn || bounds.endRow >= 1_048_576 || bounds.endColumn >= 16_384) throw new WorkbookFormatError('Array reference bounds are unavailable.', 'WORKBOOK_UNSUPPORTED');
        for (const id of index.searchGenerator({ unitId, sheetId, range: bounds })) {
          if (++work > 1_000_000) throw new WorkbookFormatError('Array dependent analysis exceeds its work limit.', 'WORKBOOK_LIMIT');
          const owner = owners[Number(id)]!, node = byCell.get(formulaCellKey(owner.sheetId, owner.row, owner.column));
          if (!node) throw new WorkbookFormatError('Array owner graph is incomplete.', 'WORKBOOK_UNSUPPORTED');
          if (node.treeId !== consumer.treeId && !node.parents.includes(consumer.treeId)) node.parents.push(consumer.treeId);
        }
      }
    }
    return result;
  } finally { index.dispose(); }
}
