import { expect, it } from 'vitest';
import { BooleanNumber, CellValueType, DateSystem, WorksheetHiddenState } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';

function fixture(): WorkbookDocument {
  return { version: 1, date1904: true, activeSheetId: 'inputs', features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    styles: [{ font: { name: 'Calibri', size: 11, bold: true, color: { kind: 'rgb', argb: 'FF123456' } }, numberFormat: '$#,##0.00', fill: { pattern: 'solid', foreground: { kind: 'rgb', argb: 'FF654321' } } }],
    sheets: [{ id: 'inputs', name: 'Inputs', visibility: 'visible', rowCount: 1_048_576, columnCount: 26, cells: [
      { row: 0, column: 0, kind: 'number', value: 2, style: 0 }, { row: 0, column: 1, kind: 'string', value: '0012' },
      { row: 8, column: 1, kind: 'boolean', value: false }, { row: 100_000, column: 2, kind: 'number', value: 4, formula: '=A1*2' },
    ], merges: [{ startRow: 1, endRow: 1, startColumn: 0, endColumn: 2 }], rowDimensions: [{ index: 2, height: 30, hidden: true, style: 0 }], columnDimensions: [{ index: 2, width: 12, style: 0 }], frozenRows: 1, frozenColumns: 1 },
    { id: 'hidden', name: 'Hidden', visibility: 'veryHidden', rowCount: 100, columnCount: 26, cells: [], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }],
  };
}
it('keeps a million-row sheet sparse and preserves cached formulas and scalar types', () => {
  const input = fixture(), before = structuredClone(input), output = gridWorkbook(input, 'owned-grid', 'Revenue');
  expect(output.data.dateSystem).toBe(DateSystem.Date1904); expect(output.activeSheetId).toBe('inputs');
  const cells = output.data.sheets!.inputs!.cellData!;
  expect(Object.keys(cells)).toEqual(['0', '8', '100000']);
  expect(cells[0]![0]).toMatchObject({ v: 2, t: CellValueType.NUMBER, s: '0' });
  expect(cells[0]![1]).toMatchObject({ v: '0012', t: CellValueType.FORCE_STRING });
  expect(cells[8]![1]).toMatchObject({ v: 0, t: CellValueType.BOOLEAN });
  expect(cells[100000]![2]).toMatchObject({ v: 4, f: '=A1*2' }); expect(input).toEqual(before);
});
it('retains styles, merged ranges, hidden sheets, dimensions and freezes', () => {
  const output = gridWorkbook(fixture(), 'owned-grid', 'Revenue'), sheet = output.data.sheets!.inputs!;
  expect(output.data.styles!['0']).toMatchObject({ ff: 'Calibri', fs: 11, bl: BooleanNumber.TRUE, cl: { rgb: '#123456' }, bg: { rgb: '#654321' }, n: { pattern: '$#,##0.00' } });
  expect(sheet.freeze).toEqual({ xSplit: 1, ySplit: 1, startRow: 1, startColumn: 1 }); expect(sheet.mergeData).toHaveLength(1);
  expect(sheet.rowData![2]).toMatchObject({ h: 40, hd: BooleanNumber.TRUE, s: '0' });
  expect(sheet.columnData![2]).toMatchObject({ w: 89, s: '0' });
  expect(output.data.sheets!.hidden!.hidden).toBe(WorksheetHiddenState.VERY_HIDDEN);
});
it('keeps rich text runs and styled blanks instead of flattening them into strings', () => {
  const input = fixture(); input.sheets[0]!.cells.push({ row: 4, column: 0, kind: 'blank', value: null, style: 0 }, { row: 5, column: 0, kind: 'string', value: 'One two', runs: [{ text: 'One ', font: { bold: true } }, { text: 'two', font: { italic: true } }] });
  input.sheets[1]!.cells = [structuredClone(input.sheets[0]!.cells.at(-1)!)];
  const sheets = gridWorkbook(input, 'owned-grid', 'Revenue').data.sheets!;
  const cells = sheets.inputs!.cellData!;
  expect(cells[4]![0]).toEqual({ s: '0' });
  expect(cells[5]![0]?.p?.body).toMatchObject({ dataStream: 'One two\r\n', textRuns: [{ st: 0, ed: 4, ts: { bl: BooleanNumber.TRUE } }, { st: 4, ed: 7, ts: { it: BooleanNumber.TRUE } }] });
  expect(cells[5]![0]?.p?.id).not.toBe(sheets.hidden!.cellData![5]![0]?.p?.id);
});
it('resolves workbook theme colors as content independently of the app theme', () => {
  const input = fixture(); input.themeColors = Array.from({ length: 12 }, () => 'FFABCDEF'); input.styles[0]!.font!.color = { kind: 'theme', index: 4 };
  expect(gridWorkbook(input, 'owned-grid', 'Revenue').data.styles!['0']?.cl).toEqual({ rgb: '#ABCDEF' });
});
it('reports unsupported visual fidelity rather than claiming a complete rendering', () => {
  const input = fixture(); input.styles[0]!.font!.color = { kind: 'indexed', index: 10 }; input.styles[0]!.fill = { gradient: 'angle', degree: 45, stops: [{ position: 0, color: { kind: 'rgb', argb: 'FF123456' } }, { position: 1, color: { kind: 'rgb', argb: 'FF654321' } }] }; input.features.charts = 1;
  expect(gridWorkbook(input, 'owned-grid', 'Revenue').gaps).toEqual(expect.arrayContaining(['indexed-colors', 'gradient-fills', 'drawings']));
});
