// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { ICommandService, UniverInstanceType, LocaleType, Univer, type Workbook, type IWorkbookData } from '@univerjs/presets';
import * as kernel from '@univerjs/preset-sheets-core';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { restoreCsvViewDimensions } from '../../src/components/embedded/workbook/csv-view-dimensions';
import { csvGridEdits } from '../../src/components/embedded/workbook/csv-grid-edits';
const model: WorkbookDocument = { version: 1, sourceFormat: 'csv', date1904: false, activeSheetId: 'csv', styles: [{ numberFormat: '@' }], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 'csv', name: 'Data', visibility: 'visible', rowCount: 3, columnCount: 3, merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0, cells: [{ row: 0, column: 0, kind: 'string', value: 'old', style: 0 }] }] };
it('retains only bounded width/height preferences without importing old content or formatting', () => {
  const fresh = gridWorkbook(model, 'grid', 'CSV').data.sheets!.csv!;
  const before = { columnData: { 1: { w: 148, s: 'old', hd: 1 }, 3: { w: 300 }, 0: { w: NaN } }, rowData: { 2: { h: 42, s: 'old' }, 3: { h: 200 }, 0: { h: -3 } }, cellData: { 0: { 0: { v: 'stale' } } } };
  restoreCsvViewDimensions(fresh, before as unknown as IWorkbookData['sheets'][string]);
  expect(fresh.columnData).toEqual({ 1: { w: 148 } }); expect(fresh.rowData).toEqual({ 2: { h: 42 } });
  expect(fresh.cellData![0]![0]!.v).toBe('old');
});
it('reopens an actual pinned kernel with resized CSV view and authoritative refreshed literal cells, without dimensions in its save plan', () => {
  const instances: Univer[] = [];
  const open = (data: IWorkbookData) => {
    const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); instances.push(univer);
    univer.registerPlugin(kernel.UniverDocsPlugin); univer.registerPlugin(kernel.UniverFormulaEnginePlugin, { notExecuteFormula: true }); univer.registerPlugin(kernel.UniverSheetsPlugin, { notExecuteFormula: true });
    const core = univer.createUnit<IWorkbookData, Workbook>(UniverInstanceType.UNIVER_SHEET, data);
    const commands = univer.__getInjector().get(ICommandService);
    const mutate = (id: string, params: object) => { expect(commands.syncExecuteCommand(id, { unitId: core.getUnitId(), subUnitId: 'csv', ...params })).toBe(true); };
    return { save: () => structuredClone(core.getSnapshot()), mutate };
  };
  try {
    const initial = gridWorkbook(model, 'grid', 'CSV').data as IWorkbookData, old = open(structuredClone(initial));
    old.mutate(kernel.SetWorksheetColWidthMutation.id, { ranges: [{ startRow: 0, endRow: 2, startColumn: 1, endColumn: 1 }], colWidth: 148 }); old.mutate(kernel.SetWorksheetRowHeightMutation.id, { ranges: [{ startRow: 2, endRow: 2, startColumn: 0, endColumn: 2 }], rowHeight: 42 });
    old.mutate(kernel.SetRangeValuesMutation.id, { cellValue: { 0: { 0: { v: 'unsaved-old', t: 4 } } } });
    const previous = old.save(); expect(previous.sheets.csv!.columnData![1]!.w).toBe(148);
    const next = structuredClone(model); next.sheets[0]!.cells[0]!.value = 'new-source';
    const prepared = gridWorkbook(next, 'grid', 'CSV').data as IWorkbookData;
    restoreCsvViewDimensions(prepared.sheets.csv!, previous.sheets.csv!);
    const fresh = open(prepared), snapshot = fresh.save();
    expect(snapshot.sheets.csv!.columnData![1]!.w).toBe(148); expect(snapshot.sheets.csv!.rowData![2]!.h).toBe(42);
    expect(snapshot.sheets.csv!.cellData![0]![0]!.v).toBe('new-source');
    fresh.mutate(kernel.SetRangeValuesMutation.id, { cellValue: { 0: { 0: { v: 'new-edit', t: 4 } } } });
    const plan = csvGridEdits(next, 'a'.repeat(64), snapshot, fresh.save());
    expect(plan).not.toHaveProperty('dimensions'); expect(plan.edits[0]!.cell.value).toBe('new-edit');
  } finally { for (const instance of instances) instance.dispose(); }
});
