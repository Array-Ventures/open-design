import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
import { sourceArrayEngineData, sourceArrayInteractiveSnapshot } from '../../src/components/embedded/workbook/source-array-engine-data';

const require = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url))));
const core = require('@univerjs/core') as typeof import('@univerjs/presets');
const { FUniver } = require('@univerjs/core/facade') as typeof import('@univerjs/presets');
const engine = require('@univerjs/engine-formula') as typeof import('@univerjs/preset-sheets-core');
const sheets = require('@univerjs/sheets') as typeof import('@univerjs/preset-sheets-core');
const formula = require('@univerjs/sheets-formula') as typeof import('@univerjs/preset-sheets-core');
const English = require('@univerjs/preset-sheets-core/locales/en-US');
for (const name of ['@univerjs/sheets/facade', '@univerjs/engine-formula/facade', '@univerjs/sheets-formula/facade']) require(name);
const closers: (() => void)[] = [];
type Tree = { treeId: number; unitId: string; subUnitId: string; row: number; column: number; formula: string; parents: number[]; children: number[]; rangeList: { unitId: string; sheetId: string; range: { startRow: number; endRow: number; startColumn: number; endColumn: number } }[] };
afterEach(() => { for (const close of closers.splice(0).reverse()) close(); vi.unstubAllGlobals(); });

function fixture(projectSource = false, varyingResults = false) {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 'inputs', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 'inputs', name: 'Inputs', visibility: 'visible', rowCount: 100, columnCount: 20, frozenRows: 0, frozenColumns: 0, merges: [], rowDimensions: [], columnDimensions: [], arrayFormulas: [{ kind: 'array', row: 2, column: 3, range: { startRow: 2, endRow: 4, startColumn: 3, endColumn: 3 } }], cells: [
    { row: 1, column: 1, kind: 'number', value: 15000 }, { row: 2, column: 3, kind: 'number', value: varyingResults ? 15000 : 1, formula: varyingResults ? '=SEQUENCE(3,1,B2)' : '=SEQUENCE(B2/5000)' },
    { row: 3, column: 3, kind: 'number', value: varyingResults ? 15001 : 2 }, { row: 4, column: 3, kind: 'number', value: varyingResults ? 15002 : 3 },
    { row: 5, column: 3, kind: 'number', value: 99 },
  ] }] };
  model.sheets.push({ id: 'summary', name: 'Summary', visibility: 'visible', rowCount: 100, columnCount: 20, frozenRows: 0, frozenColumns: 0, merges: [], rowDimensions: [], columnDimensions: [], arrayFormulas: [], cells: [{ row: 0, column: 0, kind: 'number', value: varyingResults ? 15011 : 12, formula: '=Inputs!D4+10' }] });
  const fetch = vi.fn(() => { throw Error('Formula network access is forbidden.'); }); vi.stubGlobal('fetch', fetch);
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } }); closers.push(() => univer.dispose());
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: false }); univer.registerPlugin(sheets.UniverSheetsPlugin);
  univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { initialFormulaComputing: formula.CalculationMode.NO_CALCULATION });
  univer.__getInjector().get(core.IConfigService).setConfig(engine.ENGINE_FORMULA_RETURN_DEPENDENCY_TREE, true);
  const api = FUniver.newAPI(univer);
  const loadedSource = gridWorkbook(model, 'source-array', 'Source array').data as import('@univerjs/presets').IWorkbookData;
  const projection = projectSource ? sourceArrayInteractiveSnapshot(model, loadedSource) : null;
  if (projection && projection.state !== 'known') throw Error(projection.reason);
  const book = api.createWorkbook(projection?.state === 'known' ? projection.interactiveSnapshot : loadedSource), original = book.save();
  const arrayModel = univer.__getInjector().get(engine.FormulaDataModel);
  const seed = projection ?? sourceArrayEngineData(model, original); expect(seed.state).toBe('known');
  if (seed.state !== 'known') throw Error(seed.reason);
  expect(seed.calculation).toBe('unverified'); // probes are not production eligibility
  api.syncExecuteCommand(engine.SetArrayFormulaDataMutation.id, seed.data, { onlyLocal: true });
  const events: string[] = [], graphs: Tree[][] = [], sourceFormulaMaps: unknown[] = [];
  const observe = univer.__getInjector().get(core.ICommandService).beforeCommandExecuted(command => {
    if (command.id === engine.SetFormulaCalculationStartMutation.id) events.push('start');
    if (command.id === engine.SetArrayFormulaDataMutation.id) events.push('array');
    if (command.id === engine.SetFormulaDependencyCalculationResultMutation.id) { events.push('graph'); graphs.push((command.params as { result: Tree[] }).result); }
    if (command.id === engine.SetFormulaCalculationResultMutation.id) { events.push('scalar'); sourceFormulaMaps.push(structuredClone((command.params as { sourceFormulaData: unknown }).sourceFormulaData)); }
  }); closers.push(() => observe.dispose());
  const calculated = (change: () => void) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { end.dispose(); reject(Error('Pinned source array calculation did not finish.')); }, 2000);
    const end = api.getFormula().calculationEnd(state => { if (state === 3) { clearTimeout(timer); end.dispose(); resolve(); } }); change();
  });
  return { model, api, book, original, arrayModel, calculated, fetch, events, graphs, sourceFormulaMaps, loadedSource };
}

it('loads source ownership/cache without changing any raw formula, reference or value', () => {
  const f = fixture();
  expect(f.book.save()).toEqual(f.original);
  expect(f.arrayModel.getArrayFormulaCellData()['source-array']?.inputs?.[3]?.[3]?.v).toBe(2);
  const unknown = structuredClone(f.model); delete unknown.sheets[0]!.arrayFormulas;
  expect(sourceArrayEngineData(unknown, f.original).state).toBe('unknown');
  const changed = structuredClone(f.original); changed.sheets.inputs!.cellData![3]![3]!.v = 123;
  expect(sourceArrayEngineData(f.model, changed).state).toBe('conflict');
  expect(changed.sheets.inputs!.cellData![3]![3]!.v).toBe(123);
  const holes = structuredClone(f.model); holes.sheets[0]!.cells = holes.sheets[0]!.cells.filter(cell => cell.row !== 3 || cell.column !== 3);
  const blank = gridWorkbook(holes, 'source-array', 'Source array').data as typeof f.original;
  const blankSeed = sourceArrayEngineData(holes, blank); expect(blankSeed.state).toBe('known');
  if (blankSeed.state === 'known') expect(blankSeed.data.arrayFormulaCellData['source-array']?.inputs?.[3]?.[3]).toBeUndefined();
  (blank.sheets.inputs!.cellData![3] ??= {})[3] = { v: 77, t: core.CellValueType.NUMBER };
  expect(sourceArrayEngineData(holes, blank).state).toBe('conflict');
});

it('retains the engine’s real input collision checks for growth into a non-array literal', async () => {
  const f = fixture(); await f.calculated(() => f.book.getActiveSheet().getRange('B2').setValue(20000));
  expect(f.book.save().sheets.inputs!.cellData![2]![3]!.v).toBe('#SPILL!');
  expect(f.book.save().sheets.inputs!.cellData![5]![3]!.v).toBe(99);
  expect(f.book.save().sheets.inputs!.cellData![2]![3]!.f).toBe('=SEQUENCE(B2/5000)');
  expect(f.fetch).not.toHaveBeenCalled();
});

it('exposes a missing spill-follower dependency link in matching calculation output', async () => {
  const f = fixture(); await f.calculated(() => f.book.getActiveSheet().getRange('B2').setValue(10000));
  expect(f.events.lastIndexOf('array')).toBeGreaterThan(f.events.indexOf('start'));
  expect(f.events.lastIndexOf('array')).toBeLessThan(f.events.lastIndexOf('graph'));
  expect(f.events.lastIndexOf('graph')).toBeLessThan(f.events.lastIndexOf('scalar'));
  const graph = f.graphs.at(-1)!, owner = graph.find(tree => tree.subUnitId === 'inputs' && tree.row === 2 && tree.column === 3)!;
  const dependent = graph.find(tree => tree.subUnitId === 'summary' && tree.row === 0 && tree.column === 0)!;
  expect(owner.formula).toBe('=SEQUENCE(B2/5000)');
  // The reference is intact, but the emitted graph does not link that spill
  // follower to its array owner. Parent-only propagation is therefore unsafe
  // for limited arrays; the source/runtime ownership relation must be used too.
  expect(dependent.formula).toBe('=Inputs!D4+10');
  expect(f.book.save().sheets.summary!.cellData![0]![0]!.f).toBe('=Inputs!D4+10');
  expect(f.api.getFormula().sequenceNodesBuilder(dependent.formula)).toContainEqual(expect.objectContaining({ nodeType: engine.sequenceNodeType.REFERENCE, token: 'Inputs!D4' }));
  expect(dependent.rangeList).toEqual([]);
  expect(dependent.children).not.toContain(owner.treeId); expect(owner.parents).not.toContain(dependent.treeId);
  expect(f.sourceFormulaMaps.at(-1)).toMatchObject({ 'source-array': { summary: { 0: { 0: { f: '=Inputs!D4+10' } } } } });
  expect(f.sourceFormulaMaps.every(value => !(value as Record<string, Record<string, Record<number, Record<number, unknown>>>>)['source-array']?.inputs?.[2]?.[3])).toBe(true);
});

it('exposes a retired raw cache after contraction as an unresolved display blocker', async () => {
  const f = fixture(); await f.calculated(() => f.book.getActiveSheet().getRange('B2').setValue(10000));
  expect(f.arrayModel.getArrayFormulaCellData()['source-array']?.inputs?.[2]?.[3]?.v).toBe(1);
  expect(f.arrayModel.getArrayFormulaCellData()['source-array']?.inputs?.[3]?.[3]?.v).toBe(2);
  expect(f.book.save().sheets.inputs!.cellData![2]![3]!.f).toBe('=SEQUENCE(B2/5000)');
  expect(f.book.save().sheets.inputs!.cellData![4]![3]!.v).toBe(3);
  expect(f.arrayModel.getArrayFormulaCellData()['source-array']?.inputs?.[4]?.[3]).toBeUndefined();
  // The stale source value can resurface once the overlay disappears. Do not
  // make this probe look correct by clearing raw inputs or changing references.
  // The writer still correctly sees only the genuine input edit.
  expect(workbookGridEdits(f.model, 'a'.repeat(64), f.original, f.book.save()).edits).toEqual([
    { sheetId: 'inputs', cell: { row: 1, column: 1, kind: 'number', value: 10000 } },
  ]);
  expect(f.fetch).not.toHaveBeenCalled();
});

it('projects only proven follower caches into the overlay and qualifies contraction without changing source values', async () => {
  const f = fixture(true), source = structuredClone(f.loadedSource), model = structuredClone(f.model);
  expect(f.original.sheets.inputs!.cellData?.[3]?.[3]).toBeUndefined();
  expect(f.arrayModel.getArrayFormulaCellData()['source-array']?.inputs?.[3]?.[3]?.v).toBe(2);
  await f.calculated(() => f.book.getActiveSheet().getRange('B2').setValue(10000));
  expect(f.arrayModel.getArrayFormulaCellData()['source-array']?.inputs?.[4]?.[3]).toBeUndefined();
  expect(f.book.save().sheets.inputs!.cellData?.[4]?.[3]).toBeUndefined();
  expect(f.loadedSource).toEqual(source); expect(f.model).toEqual(model);
  expect(f.loadedSource.sheets.inputs!.cellData![4]![3]!.v).toBe(3);
  expect(f.book.save().sheets.inputs!.cellData![2]![3]!.f).toBe('=SEQUENCE(B2/5000)');
  expect(workbookGridEdits(f.model, 'a'.repeat(64), f.original, f.book.save()).edits).toEqual([{ sheetId: 'inputs', cell: { row: 1, column: 1, kind: 'number', value: 10000 } }]);
  expect(f.fetch).not.toHaveBeenCalled();
});

it('preserves the real outside literal and admits later real edits with the source projection', async () => {
  const f = fixture(true); await f.calculated(() => f.book.getActiveSheet().getRange('B2').setValue(20000));
  expect(f.book.save().sheets.inputs!.cellData![2]![3]!.v).toBe('#SPILL!');
  expect(f.book.save().sheets.inputs!.cellData![5]![3]!.v).toBe(99);
  f.book.getActiveSheet().getRange('D3').setValue(77); f.book.getActiveSheet().getRange('D4').setValue(42);
  expect(workbookGridEdits(f.model, 'a'.repeat(64), f.original, f.book.save()).edits).toEqual([
    { sheetId: 'inputs', cell: { row: 1, column: 1, kind: 'number', value: 20000 } },
    { sheetId: 'inputs', cell: { row: 2, column: 3, kind: 'number', value: 77 } },
    { sheetId: 'inputs', cell: { row: 3, column: 3, kind: 'number', value: 42 } },
  ]);
});

it('checks real cross-sheet dependent values from a varying array without rewriting its reference', async () => {
  const f = fixture(true, true); await f.calculated(() => f.book.getActiveSheet().getRange('B2').setValue(10000));
  expect(f.arrayModel.getArrayFormulaCellData()['source-array']?.inputs?.[3]?.[3]?.v).toBe(10001);
  expect(f.book.save().sheets.summary!.cellData![0]![0]!.f).toBe('=Inputs!D4+10');
  expect(f.book.save().sheets.summary!.cellData![0]![0]!.v).toBe(10011);
  expect(f.book.save().sheets.inputs!.cellData![2]![3]!.f).toBe('=SEQUENCE(3,1,B2)');
  expect(f.loadedSource.sheets.inputs!.cellData![3]![3]!.v).toBe(15001);
});
