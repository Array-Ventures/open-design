import { seedWorkbookStructureIdentity, ownWorkbookAxisIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, expect, it, vi } from 'vitest';
import { ownWorkbookCalculationWorker } from '../../src/components/embedded/workbook/calculation-worker-owner';
import { workbookGridEdits } from '../../src/components/embedded/workbook/grid-edits';
import { attachWorkbookCalculation } from '../../src/components/embedded/workbook/grid-calculation';
import { workbookDocumentSchema, type WorkbookDocument } from '@open-design/contracts/runtime/workbook';
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
  let source: { model: WorkbookDocument; original: core.IWorkbookData } | undefined;
  if (execution === 'production') {
    const original = book.save();
    const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Inputs', rowCount: 100, columnCount: 20, visibility: 'visible', frozenRows: 0, frozenColumns: 0, merges: [], rowDimensions: [], columnDimensions: [], arrayFormulas: [], cells: Object.entries(original.sheets.s!.cellData![0]!).map(([column, cell]) => ({ row: 0, column: Number(column), kind: 'number' as const, value: (cell as { v: number }).v, ...((cell as { f?: string }).f ? { formula: (cell as { f: string }).f } : {}) })) }] };
    source = { model, original };
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
    expect(workbookGridEdits(source!.model, 'a'.repeat(64), source!.original, book.save())).toEqual({ sourceSha256: 'a'.repeat(64), edits: [{ sheetId: 's', cell: { row: 0, column: 0, kind: 'number', value: 7 } }] });
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
  // This fixture deliberately kills the executor before it can send its terminal
  // notification. Close that progress lifecycle locally: the pinned UI plugin's
  // dispose does not cancel its START timer. This supplies no calculated values.
  univer.__getInjector().get(core.ICommandService).syncExecuteCommand(engine.SetFormulaCalculationNotificationMutation.id, { functionsExecutedState: engine.FormulaExecutedStateType.STOP_EXECUTION }, { onlyLocal: true });
});

it('creates an inert stored kernel after RPC was loaded without requiring an RPC channel', async () => {
  // The same imported pinned RPC module has already served the live tests.
  // The sheet plugin's flag means remote function routing, not engine execution.
  const English = pinned('@univerjs/preset-sheets-core/locales/en-US');
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } }); closers.push(() => univer.dispose());
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(sheets.UniverSheetsPlugin, { notExecuteFormula: true });
  univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { notExecuteFormula: false, initialFormulaComputing: formula.CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer);
  const book = api.createWorkbook({ id: 'stored-no-rpc', name: 'Stored', sheetOrder: ['s'], styles: {}, sheets: { s: { id: 's', name: 'Inputs', rowCount: 100, columnCount: 20, cellData: { 0: { 0: { v: 2, t: 2 }, 1: { f: '=A1+3', v: 999, t: 2 } } } } } });
  let derived = 0;
  const listen = univer.__getInjector().get(core.ICommandService).onCommandExecuted(command => { if (command.id === engine.SetFormulaCalculationResultMutation.id) derived++; }); closers.push(() => listen.dispose());
  book.getActiveSheet().getRange('A1').setValue(7);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(book.save().sheets.s!.cellData![0]![0]!.v).toBe(7);
  expect(book.save().sheets.s!.cellData![0]![1]!.v).toBe(999);
  expect(derived).toBe(0);
});

it.each([false, true])('calculates source-qualified row and column structural edits through production RPC and undo/redo (correct caches: %s)', async correctCaches => {
  vi.stubGlobal('Worker', WorkerAdapter);
  const worker = new WorkerAdapter(true, false, false, true);
  const owner = ownWorkbookCalculationWorker(() => { throw Error('Qualified structural worker became unavailable.'); }, () => worker as unknown as Worker);
  closers.push(() => owner.dispose()); expect(await owner.loaded).toBe(true);
  const English = pinned('@univerjs/preset-sheets-core/locales/en-US');
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } }); closers.push(() => univer.dispose());
  let book: ReturnType<FUniver['createWorkbook']> | undefined;
  const identities = ownWorkbookAxisIdentity(univer, () => book?.save(), () => true); closers.push(() => identities.dispose());
  univer.registerPlugin(rpc.UniverRPCMainThreadPlugin, { workerURL: worker as unknown as Worker });
  univer.registerPlugin(engine.UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(sheets.UniverSheetsPlugin, { notExecuteFormula: true });
  univer.registerPlugin(formula.UniverSheetsFormulaPlugin, { notExecuteFormula: true, initialFormulaComputing: formula.CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer);
  const seed = seedWorkbookStructureIdentity({ id: 'structure-rpc', name: 'Structure', appVersion: '1.4.0', locale: core.LocaleType.EN_US, sheetOrder: ['s', 't'], styles: {}, sheets: {
    s: { id: 's', name: 'Inputs', rowCount: 8, columnCount: 6, cellData: { 1: { 1: { v: 7, t: 2 }, 2: { f: '=SUM(B2:B3)+3', v: correctCaches ? 10 : 999, t: 2 } } } },
    t: { id: 't', name: 'Summary', rowCount: 8, columnCount: 6, cellData: { 0: { 0: { f: '=Inputs!B2+1', v: correctCaches ? 8 : 999, t: 2 } } } },
  } } as core.IWorkbookData, 'a'.repeat(64));
  book = api.createWorkbook(seed); book.setEditable(true);
  univer.__getInjector().get(core.IUniverInstanceService).focusUnit(book.getId());
  const model: WorkbookDocument = {
    version: 1, date1904: false, activeSheetId: 's', calculationMetadata: 'verified', worksheetStructureEditable: true,
    styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: Object.entries(seed.sheets).map(([id, sheet]) => ({
      id, name: sheet.name!, rowCount: sheet.rowCount!, columnCount: sheet.columnCount!, visibility: 'visible',
      frozenRows: 0, frozenColumns: 0, merges: [], rowDimensions: [], columnDimensions: [], arrayFormulas: [],
      cells: Object.entries(sheet.cellData ?? {}).flatMap(([row, entries]) => Object.entries(entries ?? {}).map(([column, raw]) => {
        const cell = raw as core.ICellData;
        return { row: Number(row), column: Number(column), kind: 'number' as const, value: Number(cell.v), ...(cell.f ? { formula: cell.f } : {}) };
      })),
    })),
  };
  expect(workbookDocumentSchema.parse(model)).toEqual(model);
  const calculation = attachWorkbookCalculation(univer, api, model, seed, book.save(), () => book!.save(), owner, () => {}); closers.push(() => calculation.dispose());
  const notifications: unknown[] = [];
  const commands = univer.__getInjector().get(core.ICommandService), tags: { valid: boolean; digest: string }[] = [];
  const observe = commands.beforeCommandExecuted(command => { if (command.id === engine.SetFormulaCalculationNotificationMutation.id && notifications.length < 128) notifications.push(command.params); if (command.id === engine.SetFormulaCalculationResultMutation.id) { const tag = workbookCalculationTagSchema.parse((command.params as { workbookCalculation: unknown }).workbookCalculation); tags.push({ valid: tag.valid && tag.inputSha256 === workbookCalculationInputSha256(book!.save()), digest: tag.inputSha256 }); } }); closers.push(() => observe.dispose());
  const sheet = book.getActiveSheet();
  const settled = async (change: () => void | Promise<unknown>) => {
    const end = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { listener.dispose(); reject(Error('Structural RPC did not settle.')); }, 5000); const listener = api.getFormula().calculationEnd((state: number) => { if (state === 3) { clearTimeout(timer); listener.dispose(); resolve(); } }); });
    await change(); const digest = workbookCalculationInputSha256(book!.save());
    await vi.waitFor(() => expect(tags.some(tag => tag.valid && tag.digest === digest), JSON.stringify(notifications)).toBe(true)); await end;
  };
  // A real RPC barrier lets the preceding createInstance reach the replica
  // without warming its formula graph through a literal edit.
  await univer.__getInjector().get(rpc.IRemoteInstanceService).whenReady();
  // The first operation in the real UI may be a context action, before any
  // literal edit has warmed the worker's formula dependency graph.
  await settled(() => { commands.syncExecuteCommand(sheets.InsertRowByRangeCommand.id, { unitId: book!.getId(), subUnitId: 's', range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 5 }, direction: core.Direction.UP }); });
  await vi.waitFor(() => { expect(book!.save().sheets.s!.cellData?.[2]?.[2]?.v).toBe(10); expect(book!.save().sheets.t!.cellData?.[0]?.[0]?.v).toBe(8); });
  await settled(() => api.undo());
  await settled(() => {
    commands.syncExecuteCommand(sheets.InsertRowByRangeCommand.id, { unitId: book!.getId(), subUnitId: 's', range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 5 }, direction: core.Direction.UP });
    commands.syncExecuteCommand(sheets.InsertColByRangeCommand.id, { unitId: book!.getId(), subUnitId: 's', range: { startRow: 0, endRow: 8, startColumn: 1, endColumn: 1 }, direction: core.Direction.LEFT });
  });
  await vi.waitFor(() => { expect(book!.save().sheets.s!.cellData?.[2]?.[3]?.v).toBe(10); expect(book!.save().sheets.t!.cellData?.[0]?.[0]?.v).toBe(8); });
  await settled(() => api.undo()); await settled(() => api.undo());
  await settled(() => { sheet.getRange('B2').setValue(8); });
  await vi.waitFor(() => expect(book!.save().sheets.t!.cellData?.[0]?.[0]?.v).toBe(9));
  await settled(() => { sheet.insertRowsBefore(1, 1); });
  await vi.waitFor(() => { expect(book!.save().sheets.s!.cellData?.[2]?.[2]?.f).toBe('=SUM(B3:B4)+3'); expect(book!.save().sheets.t!.cellData?.[0]?.[0]?.f).toBe('=Inputs!B3+1'); expect(book!.save().sheets.t!.cellData?.[0]?.[0]?.v).toBe(9); expect(calculation.status('s', 2, 2)?.result).toBe('calculated'); });
  await settled(() => { sheet.insertColumnsBefore(1, 1); });
  await vi.waitFor(() => { expect(book!.save().sheets.s!.cellData?.[2]?.[3]?.f).toBe('=SUM(C3:C4)+3'); expect(book!.save().sheets.t!.cellData?.[0]?.[0]?.f).toBe('=Inputs!C3+1'); expect(calculation.status('s', 2, 3)?.result).toBe('calculated'); });
  await settled(() => { sheet.deleteRows(1, 1); }); await settled(() => { sheet.deleteColumns(1, 1); });
  await vi.waitFor(() => { expect(book!.save().sheets.s!.cellData?.[1]?.[2]?.f).toBe('=SUM(B2:B3)+3'); expect(book!.save().sheets.t!.cellData?.[0]?.[0]?.f).toBe('=Inputs!B2+1'); expect(calculation.status('s', 1, 2)?.result).toBe('calculated'); });
  await settled(() => api.undo()); await settled(() => api.undo());
  await vi.waitFor(() => expect(calculation.status('s', 2, 3)?.result).toBe('calculated'));
  await settled(() => api.redo()); await settled(() => api.redo());
  await vi.waitFor(() => expect(calculation.status('s', 1, 2)?.result).toBe('calculated'));
  await settled(() => { sheet.getRange('B2').setValue(20); });
  await vi.waitFor(() => { expect(book!.save().sheets.s!.cellData?.[1]?.[2]?.v).toBe(23); expect(book!.save().sheets.t!.cellData?.[0]?.[0]?.v).toBe(21); });
  expect(tags.length).toBeGreaterThanOrEqual(10); expect(tags.every(tag => tag.valid)).toBe(true);
  expect(book.save().sheets.s!.rowCount).toBe(8); expect(book.save().sheets.s!.columnCount).toBe(6);
});

it('refuses structural allocation beyond prospective area, axis, identity and range budgets', () => {
  const seed = seedWorkbookStructureIdentity({ id: 'budget', name: 'Budget', appVersion: '1.4.0', locale: core.LocaleType.EN_US, styles: {}, sheetOrder: ['s'], sheets: { s: { id: 's', name: 'Sheet', rowCount: 1000, columnCount: 100, cellData: {} } } } as core.IWorkbookData, 'a'.repeat(64));
  const command = { id: 'sheet.mutation.insert-row', params: { unitId: 'budget', subUnitId: 's', range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 99 } } };
  expect(() => assertWorkbookCalculationMutation(command, [seed], sheets.SetRangeValuesMutation.id)).toThrow('budget');
  const axisBound = seedWorkbookStructureIdentity({ id: 'budget', name: 'Budget', appVersion: '1.4.0', locale: core.LocaleType.EN_US, styles: {}, sheetOrder: ['s'], sheets: { s: { id: 's', name: 'Sheet', rowCount: 99998, columnCount: 1, cellData: {} } } } as core.IWorkbookData, 'a'.repeat(64));
  expect(() => assertWorkbookCalculationMutation({ ...command, params: { ...command.params, range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 } } }, [axisBound], sheets.SetRangeValuesMutation.id)).toThrow('budget');
  expect(() => assertWorkbookCalculationMutation({ id: 'sheet.mutation.insert-col', params: { ...command.params, range: { startRow: 0, endRow: 999, startColumn: 1, endColumn: 1 } } }, [seed], sheets.SetRangeValuesMutation.id)).toThrow('budget');
  const small = seedWorkbookStructureIdentity({ id: 'budget', name: 'Budget', appVersion: '1.4.0', locale: core.LocaleType.EN_US, styles: {}, sheetOrder: ['s'], sheets: { s: { id: 's', name: 'Sheet', rowCount: 8, columnCount: 6, cellData: {} } } } as core.IWorkbookData, 'a'.repeat(64));
  const valid = { ...command, params: { ...command.params, range: { ...command.params.range, endColumn: 5 } } };
  expect(() => assertWorkbookCalculationMutation(valid, [small], sheets.SetRangeValuesMutation.id)).not.toThrow();
  const broken = structuredClone(small); delete broken.sheets.s!.rowData![0]!.custom;
  expect(() => assertWorkbookCalculationMutation(valid, [broken], sheets.SetRangeValuesMutation.id)).toThrow('ownership');
  expect(() => assertWorkbookCalculationMutation({ ...valid, params: { ...valid.params, unitId: 'foreign' } }, [small], sheets.SetRangeValuesMutation.id)).toThrow('identity');
  expect(() => assertWorkbookCalculationMutation({ ...valid, params: { ...valid.params, range: { ...valid.params.range, endColumn: 2 } } }, [small], sheets.SetRangeValuesMutation.id)).toThrow('bounds');
  expect(() => assertWorkbookCalculationMutation({ id: 'sheet.mutation.remove-rows', params: { ...valid.params, range: { ...valid.params.range, startRow: 0, endRow: 7 } } }, [small], sheets.SetRangeValuesMutation.id)).toThrow('budget');
});
