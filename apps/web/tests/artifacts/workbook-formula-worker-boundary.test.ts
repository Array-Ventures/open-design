import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, expect, it, vi } from 'vitest';
import { assertWorkbookCalculationBudget, assertWorkbookCalculationMutation } from '../../src/components/embedded/workbook/formula-worker-budget';
const packageRoot = realpathSync(fileURLToPath(new URL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url)));
const pinned = createRequire(packageRoot), core = pinned('@univerjs/core'), engine = pinned('@univerjs/engine-formula'), sheets = pinned('@univerjs/sheets'), formula = pinned('@univerjs/sheets-formula'), rpc = pinned('@univerjs/rpc');
const { FUniver } = pinned('@univerjs/core/facade');
for (const name of ['@univerjs/sheets/facade', '@univerjs/engine-formula/facade', '@univerjs/sheets-formula/facade']) pinned(name);
const closers: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); vi.unstubAllGlobals(); });
class WorkerAdapter {
  readonly thread: NodeWorker;
  private listeners = new Map<EventListener, (data: unknown) => void>();
  constructor(budget = false) {
    this.thread = new NodeWorker(new URL('../fixtures/workbook-formula-rpc-worker.cjs', import.meta.url), { workerData: { packageRoot, budgetModule: budget ? fileURLToPath(new URL('../../src/components/embedded/workbook/formula-worker-budget.ts', import.meta.url)) : undefined }, execArgv: ['--experimental-transform-types', '--no-warnings'], resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } });
    closers.push(async () => { await this.thread.terminate(); }); }
  postMessage(data: unknown) { this.thread.postMessage(data); }
  addEventListener(type: string, listener: EventListener) { if (type !== 'message') return; const handler = (data: unknown) => listener({ data } as MessageEvent); this.listeners.set(listener, handler); this.thread.on('message', handler); }
  removeEventListener(_type: string, listener: EventListener) { const handler = this.listeners.get(listener); if (handler) this.thread.off('message', handler); this.listeners.delete(listener); }
  async ready() { await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error('Owned RPC worker did not start.')), 5000); this.thread.once('error', reject); const listen = (data: { fixtureReady?: boolean }) => { if (data.fixtureReady) { clearTimeout(timer); this.thread.off('message', listen); resolve(); } }; this.thread.on('message', listen); }); }
}
it('runs genuine scalar RPC calculation off the main thread and refuses a 10-million-row SEQUENCE at actual registered bounds', async () => {
  vi.stubGlobal('Worker', WorkerAdapter);
  const worker = new WorkerAdapter(true); await worker.ready();
  const English = pinned('@univerjs/preset-sheets-core/locales/en-US');
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } }); closers.push(() => univer.dispose());
  const units = univer.__getInjector().get(core.IUniverInstanceService), commands = univer.__getInjector().get(core.ICommandService);
  const books = () => units.getAllUnitsForType(core.UniverInstanceType.UNIVER_SHEET).map((book: { getSnapshot(): import('@univerjs/presets').IWorkbookData }) => book.getSnapshot());
  const admission = commands.beforeCommandExecuted((command: { id: string; params?: unknown }) => assertWorkbookCalculationMutation(command, books(), sheets.SetRangeValuesMutation.id));
  closers.push(() => admission.dispose());
  univer.registerPlugin(rpc.UniverRPCMainThreadPlugin, { workerURL: worker });
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(sheets.UniverSheetsPlugin, { notExecuteFormula: true });
  univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { notExecuteFormula: true, initialFormulaComputing: formula.CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer);
  const book = api.createWorkbook({ id: 'bounded-rpc', name: 'Bounded RPC', sheetOrder: ['s'], styles: {}, sheets: { s: { id: 's', name: 'Inputs', rowCount: 100, columnCount: 20, cellData: { 0: { 0: { v: 2, t: 2 }, 1: { f: '=A1+3', v: 5, t: 2 } } } } } });
  const calculate = async (change: () => void) => {
    const done = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { end.dispose(); reject(Error('Owned RPC calculation timed out.')); }, 5000); const end = api.getFormula().calculationEnd((state: number) => { if (state === 3) { clearTimeout(timer); end.dispose(); resolve(); } }); });
    change(); await done;
  };
  await calculate(() => book.getActiveSheet().getRange('A1').setValue(7));
  expect(book.save().sheets.s.cellData[0][1].v).toBe(10);
  await calculate(() => book.getActiveSheet().getRange('C1').setValue({ f: '=SEQUENCE(10000000)' }));
  expect(book.save().sheets.s.cellData[0][2]).toMatchObject({ f: '=SEQUENCE(10000000)', v: '#REF!' });
  expect(book.getActiveSheet().getSheet().getRowCount()).toBe(100);
  expect(() => api.syncExecuteCommand(sheets.SetWorksheetRowCountMutation.id, { unitId: 'bounded-rpc', subUnitId: 's', rowCount: 1000000 })).toThrow('Structural');
  expect(() => api.syncExecuteCommand(sheets.InsertRowMutation.id, { unitId: 'bounded-rpc', subUnitId: 's', range: { startRow: 100, endRow: 999999, startColumn: 0, endColumn: 19 } })).toThrow('Structural');
  expect(() => api.syncExecuteCommand(sheets.SetRangeValuesMutation.id, { unitId: 'bounded-rpc', subUnitId: 's', cellValue: { 100: { 0: { v: 99 } } } })).toThrow('bounds');
  expect(book.getActiveSheet().getSheet().getRowCount()).toBe(100);
  expect(book.save().sheets.s.cellData[100]).toBeUndefined();
  expect(() => assertWorkbookCalculationBudget(books(), true)).not.toThrow();
});
