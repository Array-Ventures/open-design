import { afterEach, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { Univer } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { FFormula } from '@univerjs/engine-formula/facade';
import { BooleanValue, ERROR_TYPE_SET, IDefinedNamesService, IFunctionService, SetDefinedNameMutation, UniverFormulaEnginePlugin, deserializeRangeWithSheet, sequenceNodeType, type ErrorType } from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-formula/facade';
import { createFormulaCacheAnalysis, WORKBOOK_FORMULA_ANALYSIS_LIMITS, type FormulaCacheRuntime } from '../../src/artifacts/workbook/formula-cache-policy.js';
import { readXlsxWorkbook } from '../../src/artifacts/workbook/reader.js';
import { calculateWorkbookCellEdits } from '../../src/artifacts/workbook/calculated-patch.js';
import { child } from '../../src/artifacts/workbook/parts.js';
import { parseWorkbookXml, writeWorkbookXml } from '../../src/artifacts/workbook/xml.js';

type Name = { name: string; formula: string; localSheet?: number };
const closers: (() => void)[] = [];
afterEach(() => { closers.splice(0).reverse().forEach(close => close()); });
async function namedWorkbook(definitions: Name[], rows = 1, secondSheetFormula = false) {
  const book = new ExcelJS.Workbook(), one = book.addWorksheet('One'), two = book.addWorksheet('Two');
  for (let row = 1; row <= rows; row++) one.getCell(row, 1).value = { formula: definitions[0]!.name, result: 55 };
  one.getCell('B1').value = { formula: 'A1+1', result: 56 }; two.getCell('B1').value = 2;
  if (secondSheetFormula) { two.getCell('A1').value = { formula: definitions[0]!.name, result: 0 }; two.getCell('A2').value = { formula: 'A1+1', result: 1 }; }
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  const document = parseWorkbookXml(Buffer.from(await zip.file('xl/workbook.xml')!.async('uint8array'))), root = document.documentElement!;
  const names = document.createElementNS(root.namespaceURI, 'definedNames'); root.insertBefore(names, child(root, 'calcPr') ?? null);
  for (const definition of definitions) {
    const name = document.createElementNS(root.namespaceURI, 'definedName'); name.setAttribute('name', definition.name);
    if (definition.localSheet !== undefined) name.setAttribute('localSheetId', String(definition.localSheet));
    name.appendChild(document.createTextNode(definition.formula)); names.appendChild(name);
  }
  zip.file('xl/workbook.xml', writeWorkbookXml(document));
  return readXlsxWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
}
function runtimeFor(source: Awaited<ReturnType<typeof namedWorkbook>>) {
  // Use the real pinned lexer/name/function services while disabling execution:
  // this fixture measures policy work, not the engine's separate name evaluator.
  const univer = new Univer(); closers.push(() => univer.dispose());
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true }); univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin, { initialFormulaComputing: CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer), unitId = 'name-analysis';
  api.createWorkbook({ id: unitId, sheetOrder: source.model.sheets.map(sheet => sheet.id), sheets: Object.fromEntries(source.model.sheets.map(sheet => [sheet.id, { id: sheet.id, name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, cellData: {} }])) });
  for (const [index, name] of source.model.definedNames!.entries()) api.syncExecuteCommand(SetDefinedNameMutation.id, { unitId, id: `name-${index}`, name: name.name, formulaOrRefString: name.formula, ...(name.sheetId ? { localSheetId: name.sheetId } : {}) }, { local: true });
  const names = univer.__getInjector().get(IDefinedNamesService), functions = univer.__getInjector().get(IFunctionService);
  const nodes = vi.fn((expression: string) => api.getFormula().sequenceNodesBuilder(expression));
  const runtime: FormulaCacheRuntime = { nodes, hasExecutor: name => functions.hasExecutor(name), isLiteral: token => ERROR_TYPE_SET.has(token as ErrorType) || token.toUpperCase() === BooleanValue.TRUE || token.toUpperCase() === BooleanValue.FALSE,
    externalReference: token => Boolean(deserializeRangeWithSheet(token).unitId), table: () => false, types: sequenceNodeType,
    name: (token, sheetId) => { const value = names.getValueByName(unitId, token, sheetId); return value ? { id: value.id, formula: value.formulaOrRefString, ...(value.localSheetId ? { sheetId: value.localSheetId } : {}) } : undefined; },
  };
  return { runtime, nodes };
}
const dag = (depth: number, leaf = '=1'): Name[] => Array.from({ length: depth }, (_, index) => ({ name: `Node_${index}`, formula: index + 1 === depth ? leaf : `=Node_${index + 1}+Node_${index + 1}` }));

it('bounds a real 40-level doubling name DAG across a thousand cells by distinct definitions, not expanded occurrences', async () => {
  const source = await namedWorkbook(dag(40), 1000), { runtime, nodes } = runtimeFor(source);
  const analysis = createFormulaCacheAnalysis(runtime);
  for (const cell of source.model.sheets[0]!.cells) if (cell.formula) expect(analysis.limited(cell.formula, '1')).toBe(false);
  expect(nodes.mock.calls.length).toBeLessThanOrEqual(42);
  expect(analysis.work().names).toBe(40); expect(analysis.work().visits).toBeLessThan(5000);
});
it('memoizes global names per effective sheet and treats real cycles and missing names as limited', async () => {
  const source = await namedWorkbook([
    { name: 'Bridge', formula: '=Leaf' }, { name: 'Leaf', formula: '=MISSING(1)', localSheet: 0 }, { name: 'Leaf', formula: '=1', localSheet: 1 },
    { name: 'CycleA', formula: '=CycleB' }, { name: 'CycleB', formula: '=CycleA' },
  ]), { runtime } = runtimeFor(source), analysis = createFormulaCacheAnalysis(runtime);
  expect(analysis.limited('=Bridge', '1')).toBe(true); expect(analysis.limited('=Bridge', '2')).toBe(false);
  expect(analysis.limited('=Bridge', '1')).toBe(true); expect(analysis.limited('=CycleA', '1')).toBe(true);
  expect(analysis.limited('=CycleB', '1')).toBe(true); expect(analysis.limited('=MissingMetadata', '2')).toBe(true);
});
it('applies aggregate work budgets across cells and refuses rather than guessing support when exhausted', async () => {
  const source = await namedWorkbook(dag(4)), { runtime } = runtimeFor(source);
  const analysis = createFormulaCacheAnalysis(runtime, { ...WORKBOOK_FORMULA_ANALYSIS_LIMITS, visits: 30 });
  expect(analysis.limited('=Node_0', '1')).toBe(false);
  expect(() => { for (let index = 0; index < 100; index++) analysis.limited('=Node_0', '1'); }).toThrow('work limit');
  const tokenLimited = createFormulaCacheAnalysis(runtime, { ...WORKBOOK_FORMULA_ANALYSIS_LIMITS, tokens: 1 });
  expect(() => tokenLimited.limited('=1+2', '1')).toThrow('work limit');
});
it('genuinely calculates an admitted small DAG and preserves an unsupported-leaf DAG with dependent caches', async () => {
  const supported = await namedWorkbook(dag(8));
  const prepared = await calculateWorkbookCellEdits(supported, [{ sheetId: '2', cell: { row: 0, column: 1, kind: 'number', value: 3 } }]);
  const calculated = new ExcelJS.Workbook(); await calculated.xlsx.load(Uint8Array.from(prepared.bytes).buffer);
  expect(calculated.getWorksheet('One')!.getCell('A1').result).toBe(128); expect(calculated.getWorksheet('One')!.getCell('B1').result).toBe(129);
  const limited = await namedWorkbook(dag(8, '=MISSING(1)'));
  const stored = await calculateWorkbookCellEdits(limited, [{ sheetId: '2', cell: { row: 0, column: 1, kind: 'number', value: 3 } }]);
  const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from(stored.bytes).buffer);
  expect(reopened.getWorksheet('One')!.getCell('A1').result).toBe(55); expect(reopened.getWorksheet('One')!.getCell('B1').result).toBe(56);
});

it('preserves an unsupported local branch without borrowing its global-name memo in another sheet during a real save', async () => {
  const source = await namedWorkbook([
    { name: 'Bridge', formula: '=Leaf' }, { name: 'Seed', formula: 'Two!$B$1' },
    { name: 'Leaf', formula: '=MISSING(1)', localSheet: 0 }, { name: 'Leaf', formula: '=Seed*2', localSheet: 1 },
  ], 1, true);
  const saved = await calculateWorkbookCellEdits(source, [{ sheetId: '2', cell: { row: 0, column: 1, kind: 'number', value: 3 } }]);
  const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from(saved.bytes).buffer);
  expect(reopened.getWorksheet('One')!.getCell('A1').result).toBe(55); expect(reopened.getWorksheet('One')!.getCell('B1').result).toBe(56);
  expect(reopened.getWorksheet('Two')!.getCell('A1').result).toBe(6); expect(reopened.getWorksheet('Two')!.getCell('A2').result).toBe(7);
});

it.each([
  { label: 'doubling DAG', definitions: dag(40) },
  { label: 'large DAG after an unsupported prefix', definitions: [{ name: 'MixedRoot', formula: '=MISSING(1)+Node_0' }, ...dag(40)] },
  { label: 'large expanded string payload', definitions: dag(12, `="${'x'.repeat(8000)}"`) },
])('refuses $label before the pinned execution call without changing source bytes', async ({ definitions }) => {
  const source = await namedWorkbook(definitions), before = new Map(source.parts);
  const execute = vi.spyOn(FFormula.prototype, 'executeCalculation');
  try {
    await expect(calculateWorkbookCellEdits(source, [{ sheetId: '2', cell: { row: 0, column: 1, kind: 'number', value: 3 } }])).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT', message: expect.stringContaining('work limit') });
    expect(execute).not.toHaveBeenCalled(); expect(source.parts).toEqual(before);
  } finally { execute.mockRestore(); }
});
it('refuses real cyclic metadata before execution rather than claiming it supported or fabricating caches', async () => {
  const source = await namedWorkbook([{ name: 'CycleA', formula: '=CycleB' }, { name: 'CycleB', formula: '=CycleA' }]), before = new Map(source.parts);
  const execute = vi.spyOn(FFormula.prototype, 'executeCalculation');
  try {
    await expect(calculateWorkbookCellEdits(source, [{ sheetId: '2', cell: { row: 0, column: 1, kind: 'number', value: 3 } }])).rejects.toMatchObject({ code: 'WORKBOOK_UNSUPPORTED', message: expect.stringContaining('Cyclic defined names') });
    expect(execute).not.toHaveBeenCalled(); expect(source.parts).toEqual(before);
  } finally { execute.mockRestore(); }
});

it('charges repeated shared names across all cells before executing the workbook', async () => {
  const source = await namedWorkbook(dag(14), 64), execute = vi.spyOn(FFormula.prototype, 'executeCalculation');
  try {
    await expect(calculateWorkbookCellEdits(source, [{ sheetId: '2', cell: { row: 0, column: 1, kind: 'number', value: 3 } }])).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT', message: expect.stringContaining('work limit') });
    expect(execute).not.toHaveBeenCalled();
  } finally { execute.mockRestore(); }
});
it('enforces the name depth bound before execution even for a non-doubling chain', async () => {
  const definitions = dag(66).map((name, index, all) => ({ ...name, formula: index + 1 === all.length ? '=1' : `=Node_${index + 1}` }));
  const source = await namedWorkbook(definitions), execute = vi.spyOn(FFormula.prototype, 'executeCalculation');
  try {
    await expect(calculateWorkbookCellEdits(source, [{ sheetId: '2', cell: { row: 0, column: 1, kind: 'number', value: 3 } }])).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT', message: expect.stringContaining('depth limit') });
    expect(execute).not.toHaveBeenCalled();
  } finally { execute.mockRestore(); }
});
