import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { patchWorkbookStyles } from '../../src/artifacts/workbook/style-patch.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
it('reads actual OOXML font families and keeps authored font names through scalar and style edits', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Fonts');
  const authored = 'Authored font, "quoted" \\ face';
  sheet.getCell('A1').value = 10; sheet.getCell('A1').font = { name: authored, family: 3, size: 11 };
  const source = await readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  const cell = source.model.sheets[0]!.cells[0]!;
  expect(source.model.styles[cell.style!]?.font).toMatchObject({ name: authored, family: 3 });
  expect(source.model.styles[0]?.font).toMatchObject({ name: 'Calibri', family: 2 });
  const scalar = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { ...cell, kind: 'number', value: 20 } }]);
  const styled = await patchWorkbookStyles(await readXlsxWorkbook(scalar.bytes), [{ sheetId: '1', row: 0, column: 0, bold: true }]);
  const independent = new ExcelJS.Workbook(); await independent.xlsx.load(Uint8Array.from(styled).buffer);
  expect(independent.worksheets[0]!.getCell('A1').font).toMatchObject({ name: authored, family: 3, bold: true });
  expect(independent.worksheets[0]!.getCell('A1').value).toBe(20);
});
