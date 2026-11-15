import { expect, it } from 'vitest';
import { workbookStyleEditSchema } from '../src/runtime/workbook';

it('admits only explicit bounded sparse horizontal alignment changes', () => {
  for (const horizontalAlignment of ['general', 'left', 'center', 'right']) {
    const edit = { sheetId: '1', row: 0, column: 0, horizontalAlignment };
    expect(workbookStyleEditSchema.parse(edit)).toEqual(edit);
  }
  for (const horizontalAlignment of [null, '', 'justify', 'distributed', 0]) {
    expect(workbookStyleEditSchema.safeParse({ sheetId: '1', row: 0, column: 0, horizontalAlignment }).success).toBe(false);
  }
  expect(workbookStyleEditSchema.safeParse({ sheetId: '1', row: 0, column: 0 }).success).toBe(false);
  expect(workbookStyleEditSchema.safeParse({ sheetId: '1', row: 0, column: 0, horizontalAlignment: 'left', verticalAlignment: 'top' }).success).toBe(false);
});
