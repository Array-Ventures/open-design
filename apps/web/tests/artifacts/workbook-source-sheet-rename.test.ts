import { afterEach, expect, it } from 'vitest';
import { Univer, LocaleType, ICommandService, IUniverInstanceService, type IWorkbookData } from '@univerjs/core';
import { UniverSheetsPlugin, SetWorksheetNameCommand } from '@univerjs/sheets';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
import { workbookGridPlan, workbookPlanHasChanges } from '../../src/components/embedded/workbook/grid-plan';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
const scope = { projectId: '11111111-1111-4111-8111-111111111111', fileName: 'book.xlsx' };
const sourceSha256 = 'a'.repeat(64);
const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).reverse().forEach(close => close()));

function fixture(withFormulas = false) {
  const model: WorkbookDocument = {
    version: 1, date1904: false, activeSheetId: '1',
    worksheetStructureEditable: true, calculationMetadata: 'verified',
    styles: [{}, { font: { bold: true, size: 11 } }],
    features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: ['1', '2', '3'].map(id => ({
      id, name: `Sheet ${id}`, visibility: 'visible', rowCount: 100, columnCount: 26,
      cells: [{ row: 0, column: 0, kind: 'number', value: 12, style: id === '2' ? 1 : 0 }],
      merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0, arrayFormulas: [],
    })),
  };
  if (withFormulas) {
    model.sheets[2]!.cells.push({
      row: 1, column: 0, kind: 'number', value: 24, formula: "='Sheet 2'!A1+'Sheet 1'!A1",
    });
  }
  const initial = seedWorkbookStructureIdentity(gridWorkbook(model, `${scope.projectId}:${scope.fileName}`, 'Workbook').data as IWorkbookData, sourceSha256);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  closers.push(() => univer.dispose());
  if (withFormulas) univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(UniverSheetsPlugin);
  if (withFormulas) univer.registerPlugin(UniverSheetsFormulaPlugin, { notExecuteFormula: false, initialFormulaComputing: CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer);
  const book = api.createWorkbook(initial);
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  const checkpoint: WorkbookCheckpoint = { version: 1, source: { sourceSha256, model }, acknowledged: book.save(), desired: book.save(), pending: null };
  return { api, book, checkpoint, commands: univer.__getInjector().get(ICommandService) };
}
function rename(f: ReturnType<typeof fixture>, name: string) {
  return f.commands.syncExecuteCommand(SetWorksheetNameCommand.id, {
    unitId: f.book.getId(), subUnitId: '2', name,
  });
}

it('derives a standalone rename from the actual SDK and preserves its dependent formula rewrite without deletion contexts', () => {
  const f = fixture(true);
  const before = structuredClone(f.checkpoint);
  expect(rename(f, "Quarter's plan")).toBe(true);
  const plan = workbookGridPlan(f.checkpoint.source.model, sourceSha256, f.checkpoint.acknowledged, f.book.save());
  expect(plan.sheets?.map(sheet => [sheet.sheetId, sheet.name, sheet.origin])).toEqual([
    ['1', 'Sheet 1', 'source'], ['2', "Quarter's plan", 'source'], ['3', 'Sheet 3', 'source'],
  ]);
  expect(plan.edits.find(edit => edit.sheetId === '3')?.cell.formula).toBe("='Quarter''s plan'!A1+'Sheet 1'!A1");
  expect(f.checkpoint).toEqual(before);
});
it('retains later scalar edits while repeated rename Undo returns to an ordinary source plan', async () => {
  const f = fixture(true);
  expect(rename(f, 'First')).toBe(true);
  expect(rename(f, 'Second')).toBe(true);
  await f.api.undo();
  expect(f.book.getSheetBySheetId('2')!.getSheetName()).toBe('First');
  f.book.getSheetBySheetId('1')!.getRange('A1').setValue(27);
  const plan = workbookGridPlan(f.checkpoint.source.model, sourceSha256, f.checkpoint.acknowledged, f.book.save());
  expect(plan.sheets?.[1]?.name).toBe('First');
  expect(plan.edits.find(edit => edit.sheetId === '1')?.cell.value).toBe(27);
  await f.api.undo();
  await f.api.undo();
  expect(workbookPlanHasChanges(workbookGridPlan(f.checkpoint.source.model, sourceSha256, f.checkpoint.acknowledged, f.book.save()))).toBe(false);
});
it('keeps no-op plans empty and refuses invalid membership, names, source axes, and unsupported metadata', () => {
  const f = fixture();
  const original = f.book.save();
  const plan = (snapshot: IWorkbookData) => workbookGridPlan(
    f.checkpoint.source.model, sourceSha256, f.checkpoint.acknowledged, snapshot,
  );
  expect(workbookPlanHasChanges(plan(original))).toBe(false);
  const invalidChanges: ((snapshot: IWorkbookData) => void)[] = [
    snapshot => { snapshot.sheets['2']!.name = 'Bad/name'; },
    snapshot => {
      snapshot.sheets['2']!.name = 'Renamed';
      snapshot.styles['1'] = { ...snapshot.styles['1'], fs: 42 };
    },
    snapshot => { snapshot.sheets['2']!.name = 'sheet 1'; },
    snapshot => { snapshot.sheetOrder.reverse(); },
    snapshot => {
      snapshot.sheets['4'] = { ...snapshot.sheets['2']!, id: '4', name: 'New' };
      snapshot.sheetOrder.push('4');
    },
    snapshot => {
      snapshot.sheets['2']!.name = 'Renamed';
      delete snapshot.sheets['2']!.rowData![0]!.custom;
    },
  ];
  for (const change of invalidChanges) {
    const snapshot = structuredClone(original);
    change(snapshot);
    expect(() => plan(snapshot)).toThrow();
  }
  expect(rename(f, 'Renamed')).toBe(true);
  const unsupportedMetadata = [
    { definedNames: [{ name: 'Owned', formula: "'Sheet 1'!A1" }] },
    { tables: [{
      name: 'Owned', sheetId: '1',
      range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
      columns: ['A'], header: true, totals: false,
    }] },
  ];
  for (const metadata of unsupportedMetadata) {
    expect(() => workbookGridPlan(
      { ...f.checkpoint.source.model, ...metadata }, sourceSha256,
      f.checkpoint.acknowledged, f.book.save(),
    )).toThrow();
  }
});

it('refuses invalid/colliding actual SDK outcomes even when the low-level command permits them', () => {
  for (const name of ['Bad/name', 'sheet 1', '', 'x'.repeat(32)]) {
    const f = fixture();
    rename(f, name);
    const snapshot = f.book.save();
    const plan = () => workbookGridPlan(
      f.checkpoint.source.model, sourceSha256, f.checkpoint.acknowledged, snapshot,
    );
    // Validation in SDK UI is not source admission: this pin's command itself
    // can accept invalid names. A refused command may instead leave a no-op.
    if (snapshot.sheets['2']!.name === 'Sheet 2') {
      expect(workbookPlanHasChanges(plan())).toBe(false);
    } else {
      expect(snapshot.sheets['2']!.name).toBe(name);
      expect(plan).toThrow();
    }
  }
});
