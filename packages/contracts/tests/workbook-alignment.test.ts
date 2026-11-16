import { expect, it } from 'vitest';
import { workbookStyleEditSchema, workbookHorizontalAlignmentSchema } from '../src/runtime/workbook';

it('admits only explicit bounded sparse horizontal alignment changes', () => {
  for (const horizontalAlignment of ['general', 'left', 'center', 'right', 'fill', 'justify', 'centerContinuous', 'distributed']) {
    const edit = { sheetId: '1', row: 0, column: 0, horizontalAlignment };
    expect(workbookStyleEditSchema.parse(edit)).toEqual(edit);
  }
  for (const horizontalAlignment of [null, '', 'diagonal', 'centre', 0]) {
    expect(workbookStyleEditSchema.safeParse({ sheetId: '1', row: 0, column: 0, horizontalAlignment }).success).toBe(false);
  }
  expect(workbookStyleEditSchema.safeParse({ sheetId: '1', row: 0, column: 0 }).success).toBe(false);
  expect(workbookStyleEditSchema.safeParse({ sheetId: '1', row: 0, column: 0, horizontalAlignment: 'left', verticalAlignment: 'top' }).success).toBe(false);
});

it('keeps user-facing alignment commands limited to four choices', () => {
  for (const value of ['general', 'left', 'center', 'right']) expect(workbookHorizontalAlignmentSchema.safeParse(value).success).toBe(true);
  for (const value of ['fill', 'justify', 'centerContinuous', 'distributed', null]) expect(workbookHorizontalAlignmentSchema.safeParse(value).success).toBe(false);
});
