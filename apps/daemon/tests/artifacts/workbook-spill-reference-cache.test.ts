import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';

async function fixture() {
  const book = new ExcelJS.Workbook(), inputs = book.addWorksheet('Inputs'), summary = book.addWorksheet('Summary');
  inputs.getCell('A1').value = 2; inputs.getCell('D3').value = 1; inputs.getCell('D4').value = 2; inputs.getCell('D5').value = 3;
  summary.getCell('A1').value = { formula: 'SUM(Inputs!D3#)', result: 111 };
  summary.getCell('B1').value = { formula: 'IFERROR(A1,999)+1', result: 112 };
  summary.getCell('C1').value = { formula: 'Inputs!A1*2', result: 4 };
  return readXlsxWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
}
it('preserves original unsupported spill-reference caches and masked dependents rather than saving the pinned #VALUE result', async () => {
  const source = await fixture();
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 3 } }]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[1]!.getCell('A1').result).toBe(111); expect(book.worksheets[1]!.getCell('B1').result).toBe(112); expect(book.worksheets[1]!.getCell('C1').result).toBe(6);
});
it('refuses a newly entered unsupported spill reference but accepts literal # strings and real errors', async () => {
  const source = await fixture();
  await expect(calculateWorkbookCellEdits(source, [{ sheetId: '2', cell: { row: 1, column: 0, kind: 'number', value: 666, formula: '=SUM(Inputs!D3#)' } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED' });
  const { bytes } = await calculateWorkbookCellEdits(source, [
    { sheetId: '2', cell: { row: 1, column: 0, kind: 'string', value: 'forged', formula: '="#"&Inputs!A1' } },
    { sheetId: '2', cell: { row: 1, column: 1, kind: 'string', value: 'forged', formula: '=#NAME?' } },
  ]);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(book.worksheets[1]!.getCell('A2').result).toBe('#2'); expect(book.worksheets[1]!.getCell('B2').result).toEqual({ error: '#NAME?' });
});
