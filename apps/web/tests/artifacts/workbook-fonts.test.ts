import { expect, it } from 'vitest';
import { workbookFontFamily } from '../../src/components/embedded/workbook/grid-fonts';

it('uses only source family classification and quotes the authored font name', () => {
  expect(workbookFontFamily({ name: 'Calibri', family: 2 }).value).toBe('"Calibri", sans-serif');
  expect(workbookFontFamily({ name: 'Calibri', family: 1 }).value).toBe('"Calibri", serif');
  expect(workbookFontFamily({ name: 'Anything', family: 3 }).value).toBe('"Anything", monospace');
  expect(workbookFontFamily({ name: 'Anything', family: 4 }).value).toBe('"Anything", cursive');
  expect(workbookFontFamily({ name: 'Anything', family: 5 }).value).toBe('"Anything", fantasy');
  expect(workbookFontFamily({ name: 'Times New Roman' }).value).toBe('"Times New Roman", sans-serif');
  expect(workbookFontFamily({ family: 2 }).value).toBe('sans-serif');
});
it('does not let quoted commas, CSS keywords or escapes become extra renderer font families', () => {
  for (const name of ['Family, serif', 'A"quoted', 'A\\escaped', 'serif', 'initial', 'Bad\nName']) {
    expect(workbookFontFamily({ name, family: 3 })).toEqual({ value: 'monospace', limited: true });
  }
});

it('keeps the authored name in the source model and rejects an authored editor font change', async () => {
  const { gridWorkbook } = await import('../../src/components/embedded/workbook/grid-model');
  const { workbookGridEdits } = await import('../../src/components/embedded/workbook/grid-edits');
  const model = { version: 1 as const, date1904: false, activeSheetId: 's', styles: [{ font: { name: 'Exact authored name', family: 2 } }], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible' as const, rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number' as const, value: 1 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
  const source = structuredClone(model);
  const initial = gridWorkbook(model, 'font-test', 'Fonts').data as import('@univerjs/presets').IWorkbookData;
  expect(model).toEqual(source);
  const plain = structuredClone(initial); plain.sheets.s!.cellData![0]![0]!.v = 2;
  expect(workbookGridEdits(model, 'a'.repeat(64), initial, plain)).toEqual({ sourceSha256: 'a'.repeat(64), edits: [{ sheetId: 's', cell: { row: 0, column: 0, kind: 'number', value: 2 } }] });
  const bold = structuredClone(initial); bold.sheets.s!.cellData![0]![0]!.s = { bl: 1 };
  expect(workbookGridEdits(model, 'a'.repeat(64), initial, bold).styles).toEqual([{ sheetId: 's', row: 0, column: 0, bold: true }]);
  bold.sheets.s!.cellData![0]![0]!.s = { ff: 'Other authored family' };
  expect(() => workbookGridEdits(model, 'a'.repeat(64), initial, bold)).toThrow('formatting change');
});
