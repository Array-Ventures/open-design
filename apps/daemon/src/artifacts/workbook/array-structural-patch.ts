import type { WorkbookCellEdit } from '@open-design/contracts/runtime/workbook';
import type { ReadWorkbook } from './reader.js';
import { readXlsxWorkbook } from './reader.js';
import { address, child, children, xmlPart } from './parts.js';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { formulaCellKey } from './formula-cache-policy.js';
import { writeWorkbookXml } from './xml.js';

/** Retire only proven dynamic ownership whose anchor formula is actually edited.
 * Clear source caches before applying the explicit edit batch, so a real new
 * follower input survives. Legacy arrays and unchanged owners remain protected.
 * This is an internal transaction preparation, never a persisted intermediate. */
export async function prepareDynamicArrayOwnerEdits(source: ReadWorkbook, edits: readonly WorkbookCellEdit[], dynamicOwners: ReadonlySet<string>): Promise<ReadWorkbook> {
  const requested = new Map(edits.map(edit => [formulaCellKey(edit.sheetId, edit.cell.row, edit.cell.column), edit.cell]));
  const output = new Map(source.parts);
  let changed = false;
  for (const sheet of source.model.sheets) {
    const cells = new Map(sheet.cells.map(cell => [formulaCellKey(sheet.id, cell.row, cell.column), cell]));
    const retiring = (sheet.arrayFormulas ?? []).filter(owner => {
      const key = formulaCellKey(sheet.id, owner.row, owner.column), edit = requested.get(key);
      return dynamicOwners.has(key) && edit && edit.formula !== cells.get(key)?.formula;
    });
    if (!retiring.length) continue;
    const owned = new Set<string>(), anchors = new Set<string>();
    for (const owner of retiring) {
      anchors.add(`${owner.row}:${owner.column}`);
      for (let row = owner.row; row <= owner.range.endRow; row++) for (let column = owner.column; column <= owner.range.endColumn; column++) owned.add(`${row}:${column}`);
    }
    const part = source.sheetParts.get(sheet.id)!, document = xmlPart(source.parts, part), data = child(document.documentElement!, 'sheetData');
    let previousRow = 0;
    for (const row of data ? children(data, 'row') : []) {
      const rowNumber = row.hasAttribute('r') ? Number(row.getAttribute('r')) : previousRow + 1; previousRow = rowNumber;
      let previousColumn = -1;
      for (const cell of children(row, 'c')) {
        const position = cell.hasAttribute('r') ? address(cell.getAttribute('r')!) : { row: rowNumber - 1, column: previousColumn + 1 }; previousColumn = position.column;
        const key = `${position.row}:${position.column}`;
        if (!owned.has(key)) continue;
        if (child(cell, 'f') && !anchors.has(key)) throw new WorkbookFormatError('Array follower contains authored formula content.', 'WORKBOOK_UNSUPPORTED');
        for (const name of anchors.has(key) ? ['f', 'v', 'is'] : ['v', 'is']) for (const item of children(cell, name)) cell.removeChild(item);
        cell.removeAttribute('t');
        if (anchors.has(key)) cell.removeAttribute('cm');
      }
    }
    output.set(part, writeWorkbookXml(document)); changed = true;
  }
  return changed ? readXlsxWorkbook(await writeWorkbookPackage(output)) : source;
}
