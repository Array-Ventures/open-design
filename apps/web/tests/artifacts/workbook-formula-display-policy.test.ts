import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormulaDisplay } from '../../src/components/embedded/workbook/formula-display-policy';
import { workbookCalculationInputSha256 } from '../../src/components/embedded/workbook/formula-input-provenance';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { sourceArrayInteractiveSnapshot } from '../../src/components/embedded/workbook/source-array-engine-data';
const pinned = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url))));
const core = pinned('@univerjs/core'), engine = pinned('@univerjs/engine-formula'), sheets = pinned('@univerjs/sheets'), formula = pinned('@univerjs/sheets-formula');
const { FUniver } = pinned('@univerjs/core/facade'); pinned('@univerjs/engine-formula/facade'); pinned('@univerjs/sheets/facade');
const closers: (() => void)[] = []; afterEach(() => closers.splice(0).reverse().forEach(close => close()));
function fixture(array = false) {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Inputs', visibility: 'visible', rowCount: 100, columnCount: 20, frozenRows: 0, frozenColumns: 0, merges: [], rowDimensions: [], columnDimensions: [], arrayFormulas: array ? [{ kind: 'array', row: 0, column: 1, range: { startRow: 0, endRow: 2, startColumn: 1, endColumn: 1 } }] : [], cells: array ? [{ row: 0, column: 0, kind: 'number', value: 3 }, { row: 0, column: 1, kind: 'number', value: 1, formula: '=SEQUENCE(A1)' }, { row: 1, column: 1, kind: 'number', value: 2 }, { row: 2, column: 1, kind: 'number', value: 3 }] : [{ row: 0, column: 0, kind: 'number', value: 2 }, { row: 0, column: 1, kind: 'number', value: 999, formula: '=A1+3' }, { row: 0, column: 2, kind: 'number', value: 55, formula: '=UNKNOWN(A1)' }, { row: 0, column: 3, kind: 'number', value: 56, formula: '=C1+1' }] }] };
  const original = gridWorkbook(model, 'display', 'Display').data as IWorkbookData, projection = sourceArrayInteractiveSnapshot(model, original); if (projection.state !== 'known') throw Error(projection.reason);
  const initial = projection.interactiveSnapshot;
  const English = pinned('@univerjs/preset-sheets-core/locales/en-US'), univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } }); closers.push(() => univer.dispose());
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: true }); univer.registerPlugin(sheets.UniverSheetsPlugin); univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { initialFormulaComputing: formula.CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer); api.createWorkbook(structuredClone(initial));
  const functions = univer.__getInjector().get(engine.IFunctionService), runtime = { sequenceNodesBuilder: (value: string) => api.getFormula().sequenceNodesBuilder(value), hasExecutor: (name: string) => functions.hasExecutor(name), deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType };
  return { model, original, initial, display: new WorkbookFormulaDisplay(model, original, initial, runtime) };
}
function tag(current: IWorkbookData, generation = 1) { return { version: 1, unitId: current.id, inputSha256: workbookCalculationInputSha256(current), generation, valid: true }; }
function graph(current: IWorkbookData) { return Object.entries(current.sheets.s!.cellData![0]!).flatMap(([column, cell]) => cell?.f ? [{ treeId: Number(column), unitId: current.id, subUnitId: 's', row: 0, column: Number(column), formula: cell.f, parents: Number(column) === 2 ? [3] : [] }] : []); }
it('separates calculated scalar output, genuine limited caches and pending display authority', () => {
  const f = fixture(), current = structuredClone(f.initial); current.sheets.s!.cellData![0]![0]!.v = 7; f.display.update(current, true);
  const proof = tag(current); f.display.graphResult({ workbookCalculation: proof, result: graph(current) });
  const result = { workbookCalculation: proof, unitData: { display: { s: { 0: { 1: { v: 10, t: 2 }, 2: { v: '#NAME?', t: 4 }, 3: { v: '#VALUE!', t: 4 } } } } }, sourceFormulaData: { display: { s: { 0: { 1: { f: '=A1+3' }, 2: { f: '=UNKNOWN(A1)' }, 3: { f: '=C1+1' } } } } } };
  expect(f.display.scalarResult(result)).toBe(true); expect(result.unitData.display.s[0][2].v).toBe(55); expect(result.unitData.display.s[0][3].v).toBe(56);
  current.sheets.s!.cellData![0]![1]!.v = 10; f.display.update(current, false);
  expect(f.display.status('s', 0, 1)?.result).toBe('calculated'); expect(f.display.status('s', 0, 2)?.result).toBe('stored');
  current.sheets.s!.cellData![0]![0]!.v = 8; f.display.update(current, true);
  expect(f.display.display('s', 0, 1, { v: 10 }, current.sheets.s!.cellData![0]![1]).v).toBe(10); expect(f.display.status('s', 0, 1)?.result).toBe('pending');
  f.display.pause('paused'); expect(f.display.display('s', 0, 1, { v: 10 }, current.sheets.s!.cellData![0]![1]).v).toBe(999);
  expect(f.original.sheets.s!.cellData![0]![1]!.v).toBe(999); // calculated output never becomes genuine source cache
});
it('drops stale result data and never borrows an old cache for a new unsupported formula', () => {
  const f = fixture(), current = structuredClone(f.initial); current.sheets.s!.cellData![0]![1]!.f = '=IFERROR(NEWUNKNOWN(A1),77)'; f.display.update(current, true);
  const proof = tag(current); f.display.graphResult({ workbookCalculation: proof, result: graph(current) });
  const result = { workbookCalculation: proof, unitData: { display: { s: { 0: { 1: { v: 77, t: 2 } } } } }, sourceFormulaData: { display: { s: { 0: { 1: { f: current.sheets.s!.cellData![0]![1]!.f! } } } } } };
  expect(f.display.scalarResult(result)).toBe(true); expect(f.display.display('s', 0, 1, { v: 77 }, current.sheets.s!.cellData![0]![1]).v).toBeNull();
  const stale = { ...result, workbookCalculation: { ...proof, inputSha256: '0'.repeat(64) }, unitOtherData: { unsafe: true } };
  expect(f.display.scalarResult(stale)).toBe(false); expect(stale.unitData).toEqual({}); expect(stale.unitOtherData).toEqual({});
});
it('keeps source array caches in display only, preserves actual inputs and clears stale overlays after removal', () => {
  const f = fixture(true), current = structuredClone(f.initial); expect(current.sheets.s!.cellData?.[1]?.[1]).toBeUndefined();
  expect(f.display.display('s', 1, 1, { v: 200, isInArrayFormulaRange: true }, undefined).v).toBe(2);
  (current.sheets.s!.cellData![1] ??= {})[1] = { v: 42, t: 2 }; f.display.update(current, false);
  expect(f.display.display('s', 1, 1, { v: 200, isInArrayFormulaRange: true }, current.sheets.s!.cellData![1]![1]).v).toBe(42);
  expect(f.display.display('s', 2, 1, { v: 300, isInArrayFormulaRange: true }, undefined).v).toBeNull();
  expect(f.display.status('s', 0, 1)?.result).toBe('unavailable');
  current.sheets.s!.cellData![0]![1] = { v: 99, t: 2 }; f.display.update(current, false);
  expect(f.display.display('s', 0, 1, { v: 1 }, current.sheets.s!.cellData![0]![1]).v).toBe(99);
  expect(f.display.display('s', 1, 1, { v: 200, isInArrayFormulaRange: true }, current.sheets.s!.cellData![1]![1]).v).toBe(42);
  expect(f.original.sheets.s!.cellData![1]![1]!.v).toBe(2);
});
it('binds every nested derived range to its exact parent and rejects stale or untagged writes', () => {
  const f = fixture(), current = structuredClone(f.initial); current.sheets.s!.cellData![0]![0]!.v = 7; f.display.update(current, true);
  const proof = tag(current), source = { 0: { 1: { f: '=A1+3' } } };
  f.display.graphResult({ workbookCalculation: proof, result: graph(current) });
  const outer = { workbookCalculation: proof, unitData: { display: { s: { 0: { 1: { v: 10, t: 2 } } } } }, sourceFormulaData: { display: { s: source } } };
  expect(f.display.scalarResult(outer)).toBe(true);
  const local = { unitId: 'display', subUnitId: 's', cellValue: { 0: { 1: { v: 10, t: 2 } } }, sourceFormulaData: source };
  expect(f.display.rangeResult(local)).toBe(true);
  const unknown = { ...local, sourceFormulaData: structuredClone(source) };
  expect(f.display.rangeResult(unknown)).toBe(false); expect(unknown.cellValue).toEqual({});
  const remote = { ...local, sourceFormulaData: structuredClone(source), workbookCalculation: proof };
  expect(f.display.rangeResult(remote)).toBe(true);
  current.sheets.s!.cellData![0]![0]!.v = 8; f.display.update(current, true);
  expect(f.display.rangeResult(remote)).toBe(false); expect(remote.cellValue).toEqual({});
  expect(current.sheets.s!.cellData![0]![0]!.v).toBe(8);
});
