import { expect, it } from 'vitest';
import type { WorkbookSheet } from '@open-design/contracts/runtime/workbook';
import { sourceArrayOwner, sourceArrayCachedCells, sourceArrayOwnershipKnown } from '../../src/components/embedded/workbook/source-array-ownership';

it('uses only explicit source ownership and preserves cached followers without assuming they are literal edits', () => {
  const array = { kind: 'array' as const, row: 2, column: 2, range: { startRow: 2, endRow: 4, startColumn: 2, endColumn: 2 } };
  const sheet: Pick<WorkbookSheet, 'arrayFormulas' | 'cells'> = { arrayFormulas: [array], cells: [
    { row: 2, column: 2, kind: 'number', value: 1, formula: '=SEQUENCE(3)' },
    { row: 3, column: 2, kind: 'number', value: 2 }, { row: 4, column: 2, kind: 'number', value: 3 },
    { row: 5, column: 2, kind: 'number', value: 4 },
  ] };
  expect(sourceArrayOwner(sheet, 3, 2)).toBe(array);
  expect(sourceArrayOwner(sheet, 5, 2)).toBeUndefined();
  expect(sourceArrayOwner({ arrayFormulas: undefined }, 3, 2)).toBeUndefined();
  expect(sourceArrayOwnershipKnown({ arrayFormulas: undefined })).toBe(false);
  expect(sourceArrayOwnershipKnown({ arrayFormulas: [] })).toBe(true);
  const caches = sourceArrayCachedCells(sheet, array); expect(caches.map(cell => cell.value)).toEqual([1, 2, 3]);
  caches[0]!.value = 99; expect(sheet.cells[0]!.value).toBe(1);
  expect(sourceArrayCachedCells(sheet, { ...array })).toEqual([]);
});
