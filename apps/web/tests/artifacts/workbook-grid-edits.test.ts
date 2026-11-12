import { expect, it } from 'vitest';
import { CellValueType, type IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';

const hash = 'a'.repeat(64);
function fixture() {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's1', styles: [{ numberFormat: '$0.00' }],
    features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's1', name: 'Sheet 1', visibility: 'visible', rowCount: 1_048_576, columnCount: 26, frozenRows: 0, frozenColumns: 0, merges: [], rowDimensions: [], columnDimensions: [], cells: [
      { row: 0, column: 0, kind: 'number', value: 2, style: 0 },
      { row: 1, column: 0, kind: 'number', value: 4, formula: '=A1*2' },
      { row: 2, column: 0, kind: 'string', value: 'Bold', runs: [{ text: 'Bold', font: { bold: true } }] },
    ] }] };
  const initial = gridWorkbook(model, 'grid', 'Forecast').data as IWorkbookData;
  return { model, initial, current: structuredClone(initial) };
}
it('creates sparse typed edits and retains original style identities without modifying the baseline', () => {
  const { model, initial, current } = fixture(), original = structuredClone(initial);
  current.sheets.s1!.cellData![0]![0] = { v: 12, t: CellValueType.NUMBER, s: '0' };
  current.sheets.s1!.cellData![100000] = { 2: { v: '0012', t: CellValueType.FORCE_STRING }, 3: { v: 0, t: CellValueType.BOOLEAN } };
  expect(workbookGridEdits(model, hash, initial, current)).toEqual({ sourceSha256: hash, edits: [
    { sheetId: 's1', cell: { row: 0, column: 0, kind: 'number', value: 12, style: 0 } },
    { sheetId: 's1', cell: { row: 100000, column: 2, kind: 'string', value: '0012' } },
    { sheetId: 's1', cell: { row: 100000, column: 3, kind: 'boolean', value: false } },
  ] });
  expect(initial).toEqual(original);
});
it('does not replace unedited rich runs or recalculate formula caches in the browser', () => {
  const { model, initial, current } = fixture(); current.sheets.s1!.cellData![1]![0]!.v = 99;
  expect(workbookGridEdits(model, hash, initial, current).edits).toEqual([]);
});
it('writes changed formulas without trusting their stale cached value and removes formulas when replaced', () => {
  const { model, initial, current } = fixture();
  current.sheets.s1!.cellData![1]![0] = { f: '=A1*3', v: 4, t: CellValueType.NUMBER };
  expect(workbookGridEdits(model, hash, initial, current).edits[0]?.cell).toEqual({ row: 1, column: 0, kind: 'blank', value: null, formula: '=A1*3' });
  current.sheets.s1!.cellData![1]![0] = { v: 'literal', t: CellValueType.FORCE_STRING };
  expect(workbookGridEdits(model, hash, initial, current).edits[0]?.cell).toEqual({ row: 1, column: 0, kind: 'string', value: 'literal' });
});
it('clears cells while retaining their source formatting and permits undo back to a clean plan', () => {
  const { model, initial, current } = fixture(); delete current.sheets.s1!.cellData![0]![0];
  expect(workbookGridEdits(model, hash, initial, current).edits).toEqual([{ sheetId: 's1', cell: { row: 0, column: 0, kind: 'blank', value: null, style: 0 } }]);
  expect(workbookGridEdits(model, hash, initial, structuredClone(initial)).edits).toEqual([]);
});
it('blocks an entire save containing unsupported formatting rather than partially saving the valid cells', () => {
  const { model, initial, current } = fixture(); current.sheets.s1!.cellData![0]![0]!.v = 100;
  current.sheets.s1!.cellData![1]![0]!.s = { fs: 20 };
  expect(() => workbookGridEdits(model, hash, initial, current)).toThrow('This formatting change cannot be saved yet');
  current.sheets.s1!.cellData![1]![0] = structuredClone(initial.sheets.s1!.cellData![1]![0]!);
  current.sheets.s1!.mergeData = [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }];
  expect(() => workbookGridEdits(model, hash, initial, current)).toThrow('Sheet formatting or structure changed');
});
it('rejects sheet additions, out-of-bounds cells, invalid values and unrepresentable rich-format mutations', () => {
  for (const mutate of [
    (current: IWorkbookData) => { current.sheetOrder.push('new'); },
    (current: IWorkbookData) => { current.sheets.s1!.cellData![1048576] = { 0: { v: 1 } }; },
    (current: IWorkbookData) => { current.sheets.s1!.cellData![0]![0]!.v = Infinity; },
    (current: IWorkbookData) => { current.sheets.s1!.cellData![2]![0]!.p!.body!.textRuns![0]!.ts = { ol: {s:1} }; },
  ]) { const { model, initial, current } = fixture(); mutate(current); expect(() => workbookGridEdits(model, hash, initial, current)).toThrow(); }
});
it('allows view changes without inventing content edits', () => {
  const { model, initial, current } = fixture(); current.sheets.s1!.scrollTop = 40; current.sheets.s1!.zoomRatio = 1.2;
  expect(workbookGridEdits(model, hash, initial, current).edits).toEqual([]);
});
it('records row and column resizing as dimensions instead of rejecting or inventing cell edits', () => {
  const { model, initial, current } = fixture();
  current.sheets.s1!.rowData![10] = { h: 48, ia: 0, hd: 0, s: null };
  current.sheets.s1!.columnData![2] = { w: 180, hd: 0 };
  const plan = workbookGridEdits(model, hash, initial, current);
  expect(plan.edits).toEqual([]); expect(plan.dimensions).toEqual([
    { sheetId: 's1', axis: 'row', index: 10, size: 36 }, { sheetId: 's1', axis: 'column', index: 2, size: 25 },
  ]);
});
it('accepts empty aliases and sparse authored colors while rejecting mutation of loaded styles', () => {
  const { model, initial, current } = fixture();
  current.styles.empty = {}; current.sheets.s1!.cellData![100] = { 0: { v: 7, t: CellValueType.NUMBER, s: 'empty' } };
  expect(workbookGridEdits(model, hash, initial, current).edits).toContainEqual({ sheetId: 's1', cell: { row: 100, column: 0, kind: 'number', value: 7 } });
  current.styles.empty = { cl: { rgb: '#0a0a0a' } };
  expect(workbookGridEdits(model, hash, initial, current).styles).toEqual([{ sheetId: 's1', row: 100, column: 0, fontColor: 'FF0a0a0a' }]);
  current.styles.empty = {}; current.styles['0'] = { cl: { rgb: '#ff0000' } };
  expect(() => workbookGridEdits(model, hash, initial, current)).toThrow('Workbook formatting changed');
});

it('emits sparse style deltas for real formatting without rewriting a formula cache', () => {
  const { model, initial, current } = fixture();
  current.styles.authored = { bl: 1, it: 1, cl: { rgb: '#123456' }, bg: { rgb: '#abcdef' } };
  current.sheets.s1!.cellData![1]![0]!.s = 'authored';
  current.sheets.s1!.cellData![1]![0]!.v = 999;
  const plan = workbookGridEdits(model, hash, initial, current);
  expect(plan.edits).toEqual([]);
  expect(plan.styles).toEqual([{ sheetId: 's1', row: 1, column: 0, bold: true, italic: true, fontColor: 'FF123456', fillColor: 'FFabcdef' }]);
  expect(workbookGridEdits(model, hash, initial, structuredClone(initial)).styles).toBeUndefined();
});
it('blocks unsupported styles even when a permitted style is changed in the same save', () => {
  const { model, initial, current } = fixture();
  current.sheets.s1!.cellData![0]![0]!.s = { bl: 1, bd: { b: { s: 1, cl: { rgb: '#123456' } } } };
  expect(() => workbookGridEdits(model, hash, initial, current)).toThrow('This formatting change cannot be saved yet');
  current.sheets.s1!.cellData![0]![0]!.s = { bl: 1 };
  current.sheets.s1!.cellData![2]![0]!.s = { bl: 1 };
  expect(() => workbookGridEdits(model, hash, initial, current)).toThrow('Rich text formatting changes');
});

it('represents explicit automatic color and no fill without reviving authored Normal colors', () => {
  const { model } = fixture();
  model.styles[0] = { font: { color: { kind: 'rgb', argb: 'FF123456' } }, fill: { pattern: 'solid', foreground: { kind: 'rgb', argb: 'FFABCDEF' } } };
  model.styles.push({ font: { color: { kind: 'auto' } }, fill: { pattern: 'none' } });
  model.sheets[0]!.cells[0]!.style = 1;
  const data = gridWorkbook(model, 'grid', 'Forecast').data as IWorkbookData;
  expect(data.styles['1']).toMatchObject({ cl: { rgb: 'rgb(0, 0, 0)' }, bg: { rgb: 'rgba(0,0,0,0)' } });
  expect(workbookGridEdits(model, hash, data, structuredClone(data)).styles).toBeUndefined();
});
