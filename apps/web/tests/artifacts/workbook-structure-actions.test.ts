import { afterEach, expect, it } from 'vitest';
import { IUniverInstanceService, LocaleType, Univer } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin, CalculationMode } from '@univerjs/sheets-formula';
import '@univerjs/sheets/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-formula/facade';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
import { seedWorkbookStructureIdentity, ownWorkbookAxisIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { workbookStructureController } from '../../src/components/embedded/workbook/grid-structure-actions';
const sha = 'a'.repeat(64), closers: (() => void)[] = [];
afterEach(() => closers.splice(0).reverse().forEach(close => close()));
function source(): WorkbookDocument {
  return { version: 1, date1904: false, worksheetStructureEditable: true, calculationMetadata: 'verified', richTextMetadata: 'verified', activeSheetId: 's', styles: [{}, { font: { name: 'Arial', size: 24, bold: true } }], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 8, columnCount: 6, defaultRowHeight: 15, cells: [{ row: 0, column: 0, kind: 'string', value: 'Header', style: 1 }, { row: 1, column: 1, kind: 'number', value: 12 }, { row: 2, column: 2, kind: 'number', value: 12, formula: '=SUM(B2:B3)' }], merges: [], arrayFormulas: [], rowDimensions: [{ index: 1, height: 30 }], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
}
function fixture(model = source()) {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); closers.push(() => univer.dispose());
  let book: ReturnType<FUniver['createWorkbook']> | undefined; const scope = { projectId: 'project', controllerId: 'controller', blocked: false };
  const identity = ownWorkbookAxisIdentity(univer, () => book?.save(), () => !scope.blocked && Boolean(book?.getWorkbookPermission().canEdit())); closers.push(() => identity.dispose());
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true }); univer.registerPlugin(UniverSheetsPlugin, { notExecuteFormula: true }); univer.registerPlugin(UniverSheetsFormulaPlugin, { notExecuteFormula: false, initialFormulaComputing: CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer); book = api.createWorkbook(seedWorkbookStructureIdentity(gridWorkbook(model, 'actions', 'Actions').data as IWorkbookData, sha)); book.setEditable(true);
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId()); const initial = book.save(), sheet = book.getActiveSheet(); sheet.setActiveRange(sheet.getRange(1, 1));
  const controller = workbookStructureController(univer, api, () => ({ model, sourceSha256: sha, acknowledged: initial }), () => scope); closers.push(() => controller.dispose());
  return { model, api, book, initial, sheet, controller, scope };
}
it('executes canonical UI insertion with source formatting retained and inherited height expressed separately', async () => {
  const { model, api, book, initial, controller } = fixture(); const selection = controller.read()!;
  expect(selection.allowed['row-before']).toBe(true); controller.run('row-before', selection.key);
  const saved = book.save(), plan = workbookGridEdits(model, sha, initial, saved);
  expect(saved.sheets.s!.cellData?.[0]?.[0]?.s).toBe('1');
  expect(saved.sheets.s!.cellData?.[1]?.[0]).toBeUndefined();
  expect(saved.sheets.s!.cellData?.[3]?.[2]?.f).toBe('=SUM(B3:B4)');
  expect(plan.structure?.[0]!.rows.slice(0, 4)).toEqual([0, null, 1, 2]); expect(plan.styles).toBeUndefined();
  expect(plan.dimensions).toContainEqual({ sheetId: 's', axis: 'row', index: 1, size: 30 });
  await api.undo(); expect(workbookGridEdits(model, sha, initial, book.save()).structure).toBeUndefined();
  await api.redo(); expect(workbookGridEdits(model, sha, initial, book.save()).structure?.[0]!.rows[1]).toBeNull();
});
it('rejects stale selection, withdrawn controller, read-only and retired actions before mutation', () => {
  const { book, sheet, controller, scope } = fixture(), first = controller.read()!; sheet.setActiveRange(sheet.getRange(2, 1));
  expect(() => controller.run('row-before', first.key)).toThrow('Select'); expect(book.save().sheets.s!.rowCount).toBe(8);
  const current = controller.read()!; scope.blocked = true; expect(controller.read()).toBeNull(); expect(() => controller.run('row-before', current.key)).toThrow(); scope.blocked = false;
  book.setEditable(false); expect(controller.read()).toBeNull(); book.setEditable(true); controller.dispose(); expect(() => controller.run('row-before', current.key)).toThrow();
  expect(book.save().sheets.s!.rowCount).toBe(8);
});
it('disables partial merged-anchor deletion while allowing a surviving follower to be removed', () => {
  const model = source(); model.sheets[0]!.merges = [{ startRow: 3, endRow: 4, startColumn: 0, endColumn: 1 }]; model.sheets[0]!.cells.push({ row: 3, column: 0, kind: 'string', value: 'Merged' });
  const { sheet, controller } = fixture(model); sheet.setActiveRange(sheet.getRange(3, 3)); expect(controller.read()!.allowed['row-delete']).toBe(false);
  sheet.setActiveRange(sheet.getRange(4, 3)); const follower = controller.read()!; expect(follower.allowed['row-delete']).toBe(true); controller.run('row-delete', follower.key);
});
it('refuses newly typed unsupported/broadcasting formulas instead of relying on stale source capability', () => {
  const { sheet, controller } = fixture(); sheet.getRange(0, 4).setValue({ f: '=SUM(B2:B3+1)' }); expect(controller.read()).toBeNull();
});

it.each(['row-before', 'row-after', 'row-delete', 'column-before', 'column-after', 'column-delete'] as const)('admits the exact canonical UI mutation for %s', action => {
  const { model, book, initial, controller } = fixture(), selected = controller.read()!;
  expect(selected.allowed[action]).toBe(true); controller.run(action, selected.key);
  const plan = workbookGridEdits(model, sha, initial, book.save()), edit = plan.structure![0]!;
  expect(edit.sourceRows).toBe(8); expect(edit.sourceColumns).toBe(6);
  expect(edit.rows.length).toBe(action.startsWith('row-') ? action.endsWith('-delete') ? 7 : 9 : 8);
  expect(edit.columns.length).toBe(action.startsWith('column-') ? action.endsWith('-delete') ? 5 : 7 : 6);
});

it.each([
  ['row-before', 'C4', '=SUM(B3:B4)', "='Input cells'!B3"],
  ['row-after', 'C4', '=SUM(B2:B4)', "='Input cells'!B2"],
  ['row-delete', 'C2', '=SUM(B2)', '=#REF!'],
  ['column-before', 'D3', '=SUM(C2:C3)', "='Input cells'!C2"],
  ['column-after', 'D3', '=SUM(B2:B3)', "='Input cells'!B2"],
  ['column-delete', 'B3', '=SUM(#REF!)', '=#REF!'],
] as const)('keeps local and quoted cross-sheet references through %s and actual Undo/Redo', async (action, address, formula, dependent) => {
  const model = source(); model.sheets[0]!.name = 'Input cells';
  model.sheets.push({ ...structuredClone(model.sheets[0]!), id: 'other', name: 'Other',
    cells: [{ row: 0, column: 0, kind: 'number', value: 12, formula: "='Input cells'!B2" }], rowDimensions: [] });
  const { book, sheet, controller, api } = fixture(model), selection = controller.read()!;
  const other = book.getSheetBySheetId('other')!;
  const changed = () => {
    expect(sheet.getRange(address).getFormulas()).toEqual([[formula]]);
    expect(other.getRange('A1').getFormulas()).toEqual([[dependent]]);
    const range = sheet.getRange(address).getRange();
    expect(book.save().sheets.s!.cellData![range.startRow]![range.startColumn]!.f).toBe(formula);
    expect(book.save().sheets.other!.cellData![0]![0]!.f).toBe(dependent);
  };
  controller.run(action, selection.key); changed();
  await api.undo();
  expect(sheet.getRange('C3').getFormulas()).toEqual([['=SUM(B2:B3)']]);
  expect(other.getRange('A1').getFormulas()).toEqual([["='Input cells'!B2"]]);
  await api.redo(); changed();
});
