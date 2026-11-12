import { expect, it } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';

it.each(['SUM(Inputs!4:4)', 'SUM(Inputs!E:E)'])('retains the original cache for follower-only whole-axis dependency %s', async formula => {
  const book = new ExcelJS.Workbook(), inputs = book.addWorksheet('Inputs'), summary = book.addWorksheet('Summary');
  inputs.getCell('A1').value = 1;
  inputs.getCell('D3').value = { formula: 'MISSING(A1)', result: 10 };
  inputs.getCell('E3').value = 11; inputs.getCell('D4').value = 12; inputs.getCell('E4').value = 13;
  summary.getCell('A1').value = { formula, result: 4321 };
  summary.getCell('B1').value = { formula: 'IFERROR(A1,999)+1', result: 4322 };
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer()), path = 'xl/worksheets/sheet1.xml';
  zip.file(path, (await zip.file(path)!.async('string')).replace('<f>', '<f t="array" ref="D3:E4">'));
  const source = await readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  const { bytes } = await calculateWorkbookCellEdits(source, [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 2 } }]);
  const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from(bytes).buffer);
  expect(reopened.worksheets[1]!.getCell('A1').result).toBe(4321);
  expect(reopened.worksheets[1]!.getCell('B1').result).toBe(4322);
});
