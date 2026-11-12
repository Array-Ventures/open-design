// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { CellValueType, Styles, Worksheet, type ICellData, type IStyleData, type IWorkbookData } from '@univerjs/presets';
import { EditingRenderController } from '@univerjs/preset-sheets-core';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';

const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{ font: { name: 'Calibri', size: 11 } }], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 1, column: 1, kind: 'number', value: 10000 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
// Exercise the pinned editor's own inherited-style removal, rather than
// reproducing its algorithm or assuming a plain value edit has no style.
const editing = EditingRenderController.prototype as unknown as { _removeComposedCellStyleInCellData(cell: ICellData, inherited: IStyleData): void };
it('lets the pinned editor remove inherited foreground before style interning and permits scalar save', () => {
  const initial = gridWorkbook(model, 'project:Forecast.xlsx', 'Forecast', '#0a0a0a').data as IWorkbookData;
  const current = structuredClone(initial), styles = new Styles(current.styles), sheet = new Worksheet(initial.id, current.sheets.s!, styles);
  initial.sheets.s = structuredClone(sheet.getSnapshot()); // the real grid baseline includes Univer defaults
  const inherited = sheet.getComposedCellStyleWithoutSelf(1, 1);
  expect(inherited).toMatchObject({ cl: { rgb: '#0a0a0a' }, ff: 'Calibri', fs: 11 });
  const edited: ICellData = { v: 13579, t: CellValueType.NUMBER, s: { cl: { rgb: '#0a0a0a' } } };
  editing._removeComposedCellStyleInCellData(edited, inherited);
  expect(edited.s).toEqual({}); edited.s = styles.setValue(edited.s as IStyleData);
  current.sheets.s!.cellData![1]![1] = edited;
  expect(workbookGridEdits(model, 'a'.repeat(64), initial, current).edits).toEqual([{ sheetId: 's', cell: { row: 1, column: 1, kind: 'number', value: 13579 } }]);
});
it('preserves inherited authored fonts and emits a sparse genuine editor color change', () => {
  const authored = structuredClone(model); authored.styles[0]!.font!.color = { kind: 'rgb', argb: 'FF123456' };
  const initial = gridWorkbook(authored, 'project:Forecast.xlsx', 'Forecast', '#0a0a0a').data as IWorkbookData;
  const current = structuredClone(initial), styles = new Styles(current.styles), sheet = new Worksheet(initial.id, current.sheets.s!, styles);
  initial.sheets.s = structuredClone(sheet.getSnapshot()); // the real grid baseline includes Univer defaults
  const inherited = sheet.getComposedCellStyleWithoutSelf(1, 1);
  expect(inherited).toMatchObject({ cl: { rgb: '#123456' }, ff: 'Calibri' });
  const edited: ICellData = { v: 13579, t: CellValueType.NUMBER, s: { cl: { rgb: '#ff0000' } } };
  editing._removeComposedCellStyleInCellData(edited, inherited); expect(edited.s).toEqual({ cl: { rgb: '#ff0000' } });
  edited.s = styles.setValue(edited.s as IStyleData); current.sheets.s!.cellData![1]![1] = edited;
  const plan = workbookGridEdits(authored, 'a'.repeat(64), initial, current);
  expect(plan.styles).toEqual([{ sheetId: 's', row: 1, column: 1, fontColor: 'FFff0000' }]);
  expect(plan.edits).toEqual([{ sheetId: 's', cell: { row: 1, column: 1, kind: 'number', value: 13579 } }]);
});
