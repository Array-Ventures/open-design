import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, expect, it, vi } from 'vitest';
import { ownWorkbookCalculationWorker } from '../../src/components/embedded/workbook/calculation-worker-owner';
import { attachWorkbookCalculation } from '../../src/components/embedded/workbook/grid-calculation';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { workbookCalculationInputSha256, workbookCalculationTagSchema } from '../../src/components/embedded/workbook/formula-input-provenance';
import { workbookCalculationDeadline } from '../../src/components/embedded/workbook/formula-worker-deadline';
import { assertWorkbookCalculationBudget, assertWorkbookCalculationMutation } from '../../src/components/embedded/workbook/formula-worker-budget';
const packageRoot = realpathSync(fileURLToPath(new URL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url)));
const pinned = createRequire(packageRoot);
import * as core from '@univerjs/core';
import * as engine from '@univerjs/engine-formula';
import * as sheets from '@univerjs/sheets';
import * as formula from '@univerjs/sheets-formula';
import * as rpc from '@univerjs/rpc';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-formula/facade';
const closers: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); vi.unstubAllGlobals(); });
class WorkerAdapter {
  readonly thread: NodeWorker;
  private listeners = new Map<EventListener, (data: unknown) => void>();
  constructor(budget = false, execution = false, stall = false, production = false) {
    this.thread = new NodeWorker(new URL('../fixtures/workbook-formula-rpc-worker.ts', import.meta.url), { workerData: { packageRoot, stall, productionEntry: production ? fileURLToPath(new URL('../../src/components/embedded/workbook/workbook-formula.worker.ts', import.meta.url)) : undefined, executionModule: execution ? fileURLToPath(new URL('../../src/components/embedded/workbook/formula-execution-policy.ts', import.meta.url)) : undefined, budgetModule: budget ? fileURLToPath(new URL('../../src/components/embedded/workbook/formula-worker-budget.ts', import.meta.url)) : undefined }, execArgv: ['--experimental-transform-types', '--no-warnings'], resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } });
    closers.push(async () => { await this.thread.terminate(); }); }
  terminate() { void this.thread.terminate(); }
  postMessage(data: unknown) { this.thread.postMessage(data); }
  addEventListener(type: string, listener: EventListener) { if (type !== 'message') return; const handler = (data: unknown) => { listener({ data } as MessageEvent); }; this.listeners.set(listener, handler); this.thread.on('message', handler); }
  removeEventListener(_type: string, listener: EventListener) { const handler = this.listeners.get(listener); if (handler) this.thread.off('message', handler); this.listeners.delete(listener); }
  async ready() { await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error('Owned RPC worker did not start.')), 5000); this.thread.once('error', reject); const listen = (data: { fixtureReady?: boolean; type?: string; kind?: string }) => { if (data.fixtureReady || data.type === 'studio:workbook-calculation-worker' && data.kind === 'ready') { clearTimeout(timer); this.thread.off('message', listen); resolve(); } }; this.thread.on('message', listen); }); }
}
it.each([false, true, 'production'] as const)('runs genuine scalar RPC calculation and bounds execution (qualified policy=%s)', async execution => {
  vi.stubGlobal('Worker', WorkerAdapter);
  const worker = new WorkerAdapter(true, execution === true, false, execution === 'production');
  const owner = execution === 'production' ? ownWorkbookCalculationWorker(() => { throw Error('Production worker refused calculation.'); }, () => worker as unknown as Worker) : null;
  if (owner) { closers.push(() => owner.dispose()); expect(await owner.loaded).toBe(true); } else await worker.ready();
  const English = pinned('@univerjs/preset-sheets-core/locales/en-US');
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } }); closers.push(() => univer.dispose());
  const units = univer.__getInjector().get(core.IUniverInstanceService), commands = univer.__getInjector().get(core.ICommandService);
  const books = () => units.getAllUnitsForType<core.Workbook>(core.UniverInstanceType.UNIVER_SHEET).map(book => book.getSnapshot());
  const admission = commands.beforeCommandExecuted((command: { id: string; params?: unknown }) => assertWorkbookCalculationMutation(command, books(), sheets.SetRangeValuesMutation.id));
  closers.push(() => admission.dispose());
  univer.registerPlugin(rpc.UniverRPCMainThreadPlugin, { workerURL: worker as unknown as Worker });
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(sheets.UniverSheetsPlugin, { notExecuteFormula: true });
  univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { notExecuteFormula: true, initialFormulaComputing: formula.CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer);
  const book = api.createWorkbook({ id: 'bounded-rpc', name: 'Bounded RPC', sheetOrder: ['s'], styles: {}, sheets: { s: { id: 's', name: 'Inputs', rowCount: 100, columnCount: 20, cellData: { 0: { 0: { v: 2, t: 2 }, 1: { f: '=A1+3', v: 999, t: 2 }, 5: { f: '=UNKNOWN(A1)', v: 55, t: 2 }, 6: { f: '=F1+1', v: 56, t: 2 }, 7: { f: '=1/(A1-A1)', v: 777, t: 2 }, 8: { f: '=SUM(A1:B1)', v: 888, t: 2 }, 9: { f: '=IF(A1>6,SUM(A1:B1),0)', v: 889, t: 2 } } } } } });
  let calculation: ReturnType<typeof attachWorkbookCalculation> | undefined;
  if (execution === 'production') {
    const original = book.save();
    const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Inputs', rowCount: 100, columnCount: 20, visibility: 'visible', frozenRows: 0, frozenColumns: 0, merges: [], rowDimensions: [], columnDimensions: [], arrayFormulas: [], cells: Object.entries(original.sheets.s!.cellData![0]!).map(([column, cell]) => ({ row: 0, column: Number(column), kind: 'number' as const, value: (cell as { v: number }).v, ...((cell as { f?: string }).f ? { formula: (cell as { f: string }).f } : {}) })) }] };
    calculation = attachWorkbookCalculation(univer, api, model, original, original, () => book.save(), owner, () => {});
    closers.push(() => calculation!.dispose());
  }
  const tagged: { valid: boolean; matches: boolean }[] = [];
  const observe = commands.beforeCommandExecuted((command: { id: string; params?: { workbookCalculation?: unknown } }) => {
    if (execution !== 'production' || command.id !== engine.SetFormulaCalculationResultMutation.id) return;
    const tag = workbookCalculationTagSchema.parse(command.params?.workbookCalculation);
    tagged.push({ valid: tag.valid, matches: tag.inputSha256 === workbookCalculationInputSha256(book.save()) });
  }); closers.push(() => observe.dispose());
  const calculate = async (change: () => void) => {
    const done = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { end.dispose(); reject(Error('Owned RPC calculation timed out.')); }, 5000); const end = api.getFormula().calculationEnd((state: number) => { if (state === 3) { clearTimeout(timer); end.dispose(); resolve(); } }); });
    change(); await done;
  };
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(book.save().sheets.s!.cellData![0]![1]!.v).toBe(999); // imported cache is genuine authority until an actual edit
  await calculate(() => book.getActiveSheet().getRange('A1').setValue(7));
  expect(book.save().sheets.s!.cellData![0]![1]!.v).toBe(10);
  if (execution === 'production') {
    expect(tagged).toEqual([{ valid: true, matches: true }]);
    expect(book.getActiveSheet().getSheet().getCell(0, 1)!.v).toBe(10);
    expect(book.save().sheets.s!.cellData![0]![5]!.v).toBe(55); expect(book.save().sheets.s!.cellData![0]![6]!.v).toBe(56);
    expect(calculation!.status('s', 0, 5)?.result).toBe('stored'); expect(calculation!.status('s', 0, 6)?.result).toBe('stored');
    expect(book.getActiveSheet().getSheet().getCell(0, 7)!.v).toBe('#DIV/0!');
    expect(book.getActiveSheet().getSheet().getCell(0, 8)!.v).toBe(17);
    expect(book.getActiveSheet().getSheet().getCell(0, 9)!.v).toBe(17);
  }
  await calculate(() => book.getActiveSheet().getRange('C1').setValue({ f: '=SEQUENCE(10000000)' }));
  expect(book.save().sheets.s!.cellData![0]![2]!).toMatchObject({ f: '=SEQUENCE(10000000)', v: execution ? '#N/A' : '#REF!' });
  if (execution) {
    await calculate(() => book.getActiveSheet().getRange('D1').setValue({ f: '=RANDARRAY(10000000)' }));
    expect(book.save().sheets.s!.cellData![0]![3]!).toMatchObject({ f: '=RANDARRAY(10000000)', v: '#N/A' });
    await calculate(() => book.getActiveSheet().getRange('E1').setValue({ f: '=EXPAND(A1,10000000,10000000)' }));
    expect(book.save().sheets.s!.cellData![0]![4]!).toMatchObject({ f: '=EXPAND(A1,10000000,10000000)', v: '#N/A' });
    if (execution === 'production') expect(book.getActiveSheet().getSheet().getCell(0, 4)!.v).toBeNull();
  }
  expect(book.getActiveSheet().getSheet().getRowCount()).toBe(100);
  expect(() => api.syncExecuteCommand(sheets.SetWorksheetRowCountMutation.id, { unitId: 'bounded-rpc', subUnitId: 's', rowCount: 1000000 })).toThrow('Structural');
  expect(() => api.syncExecuteCommand(sheets.InsertRowMutation.id, { unitId: 'bounded-rpc', subUnitId: 's', range: { startRow: 100, endRow: 999999, startColumn: 0, endColumn: 19 } })).toThrow('Structural');
  expect(() => api.syncExecuteCommand(sheets.SetRangeValuesMutation.id, { unitId: 'bounded-rpc', subUnitId: 's', cellValue: { 100: { 0: { v: 99 } } } })).toThrow('bounds');
  expect(book.getActiveSheet().getSheet().getRowCount()).toBe(100);
  expect(book.save().sheets.s!.cellData![100]!).toBeUndefined();
  expect(() => assertWorkbookCalculationBudget(books(), true)).not.toThrow();
  if (execution === 'production') {
    api.syncExecuteCommand(sheets.SetWorksheetColWidthMutation.id, { unitId: 'bounded-rpc', subUnitId: 's', ranges: [{ startRow: 0, endRow: 99, startColumn: 0, endColumn: 0 }], colWidth: 120 });
    book.getActiveSheet().getRange('A1').setValue(8); book.getActiveSheet().getRange('A1').setValue(9);
    await vi.waitFor(() => expect(book.save().sheets.s!.cellData![0]![1]!.v).toBe(12));
    expect(tagged.at(-1)).toEqual({ valid: true, matches: true });
  }
});

it('terminates an actual pinned-worker executor that stops yielding while the main workbook remains responsive', async () => {
  vi.stubGlobal('Worker', WorkerAdapter);
  const worker = new WorkerAdapter(true, false, true); await worker.ready();
  const English = pinned('@univerjs/preset-sheets-core/locales/en-US');
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } }); closers.push(() => univer.dispose());
  univer.registerPlugin(rpc.UniverRPCMainThreadPlugin, { workerURL: worker as unknown as Worker });
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: true }); univer.registerPlugin(sheets.UniverSheetsPlugin, { notExecuteFormula: true });
  univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { notExecuteFormula: true, initialFormulaComputing: formula.CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer), book = api.createWorkbook({ id: 'blocked-rpc', name: 'Blocked RPC', sheetOrder: ['s'], styles: {}, sheets: { s: { id: 's', name: 'Inputs', rowCount: 100, columnCount: 20, cellData: {} } } });
  let stopped!: () => void; const failed = new Promise<void>(resolve => { stopped = resolve; });
  const deadline = workbookCalculationDeadline({ terminate: () => { void worker.thread.terminate(); } }, stopped, 25); closers.push(() => deadline.dispose());
  const entered = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Pinned fixture executor did not start.')), 3000);
    const receive = (data: { fixtureEnteredStall?: boolean }) => { if (data.fixtureEnteredStall) { clearTimeout(timer); worker.thread.off('message', receive); deadline.begin(); resolve(); } }; worker.thread.on('message', receive);
  });
  book.getActiveSheet().getRange('C2').setValue({ f: '=EVEBOT_TEST_BLOCK()' }); await entered;
  // The worker is now inside its deliberately non-yielding fixture kernel.
  book.getActiveSheet().getRange('A1').setValue(19);
  expect(book.save().sheets.s!.cellData![0]![0]!.v).toBe(19);
  await failed; expect(deadline.begin()).toBeNull();
});
