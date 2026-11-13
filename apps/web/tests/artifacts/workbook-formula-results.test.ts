import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { workbookFormulaPolicy, preserveWorkbookFormulaResults, type FormulaDependencyNode, type WorkbookFormulaCalculationStatus } from '../../src/components/embedded/workbook/formula-result-policy';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';

// Load the actual pinned headless engine, not the browser UI preset. The preset
// supplies the dependency resolution root; no production code depends on pnpm paths.
const require = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url))));
const core = require('@univerjs/core') as typeof import('@univerjs/presets');
const { FUniver } = require('@univerjs/core/facade') as typeof import('@univerjs/presets');
const engine = require('@univerjs/engine-formula') as typeof import('@univerjs/preset-sheets-core');
const sheets = require('@univerjs/sheets') as typeof import('@univerjs/preset-sheets-core');
const formula = require('@univerjs/sheets-formula') as typeof import('@univerjs/preset-sheets-core');
const English = require('@univerjs/preset-sheets-core/locales/en-US');
for (const name of ['@univerjs/sheets/facade', '@univerjs/engine-formula/facade', '@univerjs/sheets-formula/facade']) require(name);
const dispose: (() => void)[] = [];
afterEach(() => { for (const close of dispose.splice(0).reverse()) close(); vi.unstubAllGlobals(); });

function fixture(includeArray = false) {
  const fetch = vi.fn(() => { throw Error('Formula network access is forbidden.'); }); vi.stubGlobal('fetch', fetch);
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } });
  dispose.push(() => univer.dispose());
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: false });
  univer.registerPlugin(sheets.UniverSheetsPlugin);
  univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { initialFormulaComputing: formula.CalculationMode.NO_CALCULATION });
  univer.__getInjector().get(core.IConfigService).setConfig(engine.ENGINE_FORMULA_RETURN_DEPENDENCY_TREE, true);
  const api = FUniver.newAPI(univer);
  const functions = univer.__getInjector().get(engine.IFunctionService);
  const formulas = ['=B2-C2', '=sum( B2 , C2 )', '=IF(B2>C2,"up","down")', '=DOESNOTEXIST(B2)', "='[external.xlsx]Sheet1'!B2", '=D6*2', '=D7+B2', '=1/(B2-B2)', '=WEBSERVICE("https://fixture.invalid/?"&B2)', '=HYPERLINK("https://fixture.invalid/","label")'];
  if (includeArray) formulas.push('=SEQUENCE(2+B2/15000)');
  const cellData: Record<number, Record<number, { v: number; t: number; f?: string }>> = { 1: { 1: { v: 12000, t: 2 }, 2: { v: 7000, t: 2 } } };
  for (let index = 0; index < formulas.length; index++) cellData[index + 2] = { 3: { f: formulas[index], v: 5000 + index, t: 2 } };
  const book = api.createWorkbook({ id: 'formula-results', name: 'Formula results', appVersion: '1.4.0', locale: core.LocaleType.EN_US, sheetOrder: ['inputs', 'summary'], styles: {}, sheets: { inputs: { id: 'inputs', name: 'Inputs', rowCount: 100, columnCount: 20, cellData }, summary: { id: 'summary', name: 'Summary', rowCount: 100, columnCount: 20, cellData: { 0: { 0: { f: '=Inputs!D6+1', v: 777, t: 2 } } } } } });
  const original = book.save();
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 'inputs', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 1, macros: false, signed: false }, sheets: [{ id: 'inputs', name: 'Inputs', visibility: 'visible', rowCount: 100, columnCount: 20, frozenRows: 0, frozenColumns: 0, merges: [], rowDimensions: [], columnDimensions: [], cells: Object.entries(cellData).flatMap(([row, cells]) => Object.entries(cells).map(([column, cell]) => ({ row: Number(row), column: Number(column), kind: 'number' as const, value: cell.v, ...(cell.f ? { formula: cell.f } : {}) }))) }] };
  model.sheets.push({ id: 'summary', name: 'Summary', visibility: 'visible', rowCount: 100, columnCount: 20, frozenRows: 0, frozenColumns: 0, merges: [], rowDimensions: [], columnDimensions: [], cells: [{ row: 0, column: 0, kind: 'number', value: 777, formula: '=Inputs!D6+1' }] });
  let trees: FormulaDependencyNode[] = [], status: WorkbookFormulaCalculationStatus | undefined;
  const arrayResults: unknown[] = [];
  const commands = univer.__getInjector().get(core.ICommandService);
  const interception = commands.beforeCommandExecuted(command => {
    if (command.id === engine.SetArrayFormulaDataMutation.id) arrayResults.push(structuredClone(command.params));
    if (command.id === engine.SetFormulaDependencyCalculationResultMutation.id) trees = (command.params as { result: FormulaDependencyNode[] }).result;
    if (command.id === engine.SetFormulaCalculationResultMutation.id) {
      const current = book.save();
      const policy = workbookFormulaPolicy(current, trees, {
        sequenceNodesBuilder: value => api.getFormula().sequenceNodesBuilder(value), hasExecutor: name => functions.hasExecutor(name),
        deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType,
      });
      status = preserveWorkbookFormulaResults(command.params as Parameters<typeof preserveWorkbookFormulaResults>[0], original, current, policy);
    }
  });
  dispose.push(() => interception.dispose());
  const calculated = (change: () => void) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { end.dispose(); reject(Error('Pinned formula engine did not finish.')); }, 2000);
    const end = api.getFormula().calculationEnd(state => { if (state === 3) { clearTimeout(timer); end.dispose(); resolve(); } });
    change();
  });
  return { api, book, original, model, fetch, calculated, status: () => status, formulas, arrayResults, arrayModel: univer.__getInjector().get(engine.FormulaDataModel) };
}

it('calculates supported scalar formulas while preserving limited caches and their dependent chains', async () => {
  const f = fixture();
  expect(f.book.save().sheets.inputs!.cellData![2]![3]!.v).toBe(5000);
  await f.calculated(() => f.book.getActiveSheet().getRange('B2').setValue(15000));
  const cells = f.book.save().sheets.inputs!.cellData!;
  expect(cells[2]![3]!.v).toBe(8000);
  expect(cells[3]![3]!.v).toBe(22000);
  expect(cells[4]![3]!.v).toBe('up');
  for (const row of [5, 6, 7, 8, 10]) expect(cells[row]![3]!.v).toBe(f.original.sheets.inputs!.cellData![row]![3]!.v);
  expect(cells[9]![3]!.v).toBe('#DIV/0!'); // genuine supported-formula errors are not hidden
  for (let index = 0; index < f.formulas.length; index++) expect(cells[index + 2]![3]!.f).toBe(f.formulas[index]);
  expect(f.book.save().sheets.summary!.cellData![0]![0]).toMatchObject({ v: 777, f: '=Inputs!D6+1' });
  expect(f.status()).toMatchObject({ limitedCells: 7, storedResults: 7, unavailableResults: 0 });
  expect(f.status()!.cells.filter(cell => cell.reason === 'dependent')).toHaveLength(3);
  expect(f.fetch).not.toHaveBeenCalled();
  expect(workbookGridEdits(f.model, 'a'.repeat(64), f.original, f.book.save()).edits).toEqual([{ sheetId: 'inputs', cell: { row: 1, column: 1, kind: 'number', value: 15000 } }]);
});

it('exposes the separate array mutation boundary rather than claiming scalar filtering prevents spills', async () => {
  const f = fixture(true);
  await f.calculated(() => f.book.getActiveSheet().getRange('B2').setValue(15000));
  expect(f.status()!.cells.find(cell => cell.row === 12)).toMatchObject({ reason: 'dynamic-result', result: 'stored' });
  expect(f.book.save().sheets.inputs!.cellData![12]![3]!.v).toBe(5010);
  // Even with the anchor cache protected, Univer independently publishes spill
  // ranges/cells. The grid must not enable arbitrary live formulas until this
  // additional derived-data path has an accepted display AND writer boundary.
  expect(f.arrayResults.some(value => {
    const mutation = value as { arrayFormulaRange?: Record<string, Record<string, Record<number, Record<number, { endRow: number }>>>> };
    return mutation.arrayFormulaRange?.['formula-results']?.inputs?.[12]?.[3]?.endRow === 14;
  })).toBe(true);
  expect(f.arrayModel.getArrayFormulaCellData()['formula-results']?.inputs?.[13]?.[3]?.v).toBe(2);
  expect(f.book.save().sheets.inputs!.cellData?.[13]?.[3]).toBeUndefined();
  expect(workbookGridEdits(f.model, 'a'.repeat(64), f.original, f.book.save()).edits).toEqual([{ sheetId: 'inputs', cell: { row: 1, column: 1, kind: 'number', value: 15000 } }]);
  expect(f.fetch).not.toHaveBeenCalled();
});

it('admits an actual literal edit after its old calculated spill is removed', async () => {
  const f = fixture(true);
  await f.calculated(() => f.book.getActiveSheet().getRange('B2').setValue(15000));
  f.book.getActiveSheet().getRange('D13').setValue(99);
  await vi.waitFor(() => expect(f.arrayModel.getArrayFormulaCellData()['formula-results']?.inputs?.[13]?.[3]).toBeFalsy());
  f.book.getActiveSheet().getRange('D14').setValue(42);
  expect(workbookGridEdits(f.model, 'a'.repeat(64), f.original, f.book.save()).edits).toEqual([
    { sheetId: 'inputs', cell: { row: 1, column: 1, kind: 'number', value: 15000 } },
    { sheetId: 'inputs', cell: { row: 12, column: 3, kind: 'number', value: 99 } },
    { sheetId: 'inputs', cell: { row: 13, column: 3, kind: 'number', value: 42 } },
  ]);
});

it('does not reuse the source cache for a different or newly entered unsupported formula', async () => {
  const f = fixture();
  await f.calculated(() => f.book.getActiveSheet().getRange('D3').setValue({ f: '=NEWUNKNOWN(B2)' }));
  expect(f.book.save().sheets.inputs!.cellData![2]![3]!.v).toBe('#NAME?');
  expect(f.status()!.cells.find(cell => cell.row === 2)).toMatchObject({ result: 'unavailable', reason: 'unsupported-function' });
  await f.calculated(() => f.book.getActiveSheet().getRange('E20').setValue({ f: '=OTHERUNKNOWN(B2)' }));
  expect(f.book.save().sheets.inputs!.cellData![19]![4]!.v).toBe('#NAME?');
  expect(f.status()!.cells.find(cell => cell.row === 19)).toMatchObject({ result: 'unavailable' });
  expect(f.fetch).not.toHaveBeenCalled();
});

it('protects genuine saved values and avoids hyperlink rich-document mutations on explicit full calculation', async () => {
  const f = fixture();
  await f.calculated(() => f.api.getFormula().executeCalculation());
  const link = f.book.save().sheets.inputs!.cellData![11]![3]!;
  expect(link.v).toBe(5009); expect(link.p ?? null).toBeNull();
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.status()!.cells.find(cell => cell.row === 11)).toMatchObject({ result: 'stored', reason: 'dynamic-result' });
});
