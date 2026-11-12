import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { IWorkbookData } from '@univerjs/presets';
import { assertWorkbookFormulaExecution, qualifiedWorkbookFunctionOverrides, QUALIFIED_WORKBOOK_FUNCTIONS } from '../../src/components/embedded/workbook/formula-execution-policy';
const pinned = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url))));
const core = pinned('@univerjs/core'), engine = pinned('@univerjs/engine-formula'), sheets = pinned('@univerjs/sheets'), formula = pinned('@univerjs/sheets-formula');
const { FUniver } = pinned('@univerjs/core/facade'); pinned('@univerjs/engine-formula/facade');
const closers: (() => void)[] = []; afterEach(() => closers.splice(0).reverse().forEach(close => close()));
function fixture() {
  const English = pinned('@univerjs/preset-sheets-core/locales/en-US');
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } }); closers.push(() => univer.dispose());
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: true }); univer.registerPlugin(sheets.UniverSheetsPlugin, { notExecuteFormula: true }); univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { notExecuteFormula: true });
  const api = FUniver.newAPI(univer);
  const runtime = { sequenceNodesBuilder: (value: string) => api.getFormula().sequenceNodesBuilder(value), deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType, rangeType: core.RANGE_TYPE };
  const book = { id: 'budget', appVersion: '1.4.0', locale: core.LocaleType.EN_US, name: 'Budget', styles: {}, sheetOrder: ['s'], sheets: { s: { id: 's', name: 'Inputs', rowCount: 100, columnCount: 20, cellData: {} } } } as IWorkbookData;
  const withFormula = (f: string): IWorkbookData => ({ ...book, sheets: { s: { ...book.sheets.s!, cellData: { 0: { 0: { f } } } } } });
  return { runtime, withFormula };
}
it('uses genuine pinned tokens to admit bounded ordinary ranges and reject unqualified allocation syntax', () => {
  const f = fixture();
  for (const formula of ['=sum(A1:A100)', '=SUM(A:A)', '=MAX(1:1)', '=IF(A1>3,"up","down")', '="#"', '=#NAME?', '="&"', "='[external.xlsx]Sheet1'!A1"]) expect(() => assertWorkbookFormulaExecution([f.withFormula(formula)], f.runtime), formula).not.toThrow();
  for (const formula of ['=SUM(A1:A1000000)', '=SUM(A1#)', '={1,2;3,4}', '="a"&"b"', `=SUM(${Array(600).fill('A1').join(',')})`]) expect(() => assertWorkbookFormulaExecution([f.withFormula(formula)], f.runtime), formula).toThrow();
});
it('bounds aggregate broadcast work before a calculation starts', () => {
  const f = fixture(), book = f.withFormula('=SUM(A:A)');
  book.sheets.s!.rowCount = 150;
  book.sheets.s!.cellData = Object.fromEntries(Array.from({ length: 150 }, (_, row) => [row, Object.fromEntries(Array.from({ length: 20 }, (_, column) => [column, { f: '=SUM(A:A)' }]))]));
  expect(() => assertWorkbookFormulaExecution([book], f.runtime)).toThrow('range');
});
it('uses the real preset function override API, keeping scalar/operator kernels and replacing allocators', () => {
  const overrides = qualifiedWorkbookFunctionOverrides(engine), names = new Set(overrides.map(([, name]) => String(name)));
  for (const name of QUALIFIED_WORKBOOK_FUNCTIONS) expect(names.has(name)).toBe(false);
  expect(names.has('WEBSERVICE')).toBe(false); // unimplemented in this pin, so no executor can run
  for (const name of ['EXPAND', 'SEQUENCE', 'RANDARRAY', 'REPT', 'HYPERLINK']) {
    const [Unavailable, token] = overrides.find(([, current]) => String(current) === name)!;
    expect((new Unavailable(token).calculate() as { getValue(): unknown }).getValue()).toBe('#N/A');
  }
});

it('refuses the pinned raw spill suffix before execution without confusing quoted # or genuine errors', () => {
  const f = fixture();
  expect(f.runtime.sequenceNodesBuilder('=SUM(A1#)')).toContain('#');
  for (const value of ['="#"', '=#NAME?']) {
    expect(f.runtime.sequenceNodesBuilder(value)).not.toContain('#');
    expect(() => assertWorkbookFormulaExecution([f.withFormula(value)], f.runtime)).not.toThrow();
  }
  let executed = 0;
  const execute = () => { assertWorkbookFormulaExecution([f.withFormula('=SUM(A1#)')], f.runtime); executed++; };
  expect(execute).toThrow('spill references'); expect(executed).toBe(0);
});
