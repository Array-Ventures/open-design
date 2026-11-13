// Actual pinned RPC/engine fixture in an owned, memory-limited Node worker.
import 'tsx/cjs';
import { parentPort as workerPort, workerData as untypedData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import type { Workbook } from '@univerjs/core';
if (!workerPort) throw Error('This fixture must run inside its owned worker.');
const parentPort = workerPort;
const workerData = untypedData as { packageRoot: string; productionEntry?: string; executionModule?: string; budgetModule?: string; stall?: boolean };
const require = createRequire(import.meta.url);
type MessageListener = (event: { data: unknown }) => void;
const scope = globalThis as unknown as { addEventListener(type: string, listener: MessageListener): void; removeEventListener(type: string, listener: MessageListener): void; postMessage(data: unknown): void; self: unknown; fetch: typeof fetch };
const pinned = createRequire(workerData.packageRoot);
const listeners = new Map<MessageListener, (data: unknown) => void>();
scope.addEventListener = (type, listener) => { if (type !== 'message') return; const handler = (data: unknown) => listener({ data }); listeners.set(listener, handler); parentPort.on('message', handler); };
scope.removeEventListener = (type, listener) => { const handler = listeners.get(listener); if (handler) parentPort.off('message', handler); listeners.delete(listener); };
scope.postMessage = data => parentPort.postMessage(data);
scope.fetch = () => { throw Error('Fixture formulas must not fetch network data.'); };
function run() {
if (workerData.productionEntry) { scope.self = globalThis; require(workerData.productionEntry); return; }
const core = pinned('@univerjs/core') as typeof import('@univerjs/core'), engine = pinned('@univerjs/engine-formula') as typeof import('@univerjs/engine-formula'), sheets = pinned('@univerjs/sheets') as typeof import('@univerjs/sheets');
const execution = workerData.executionModule ? require(workerData.executionModule) as typeof import('../../src/components/embedded/workbook/formula-execution-policy') : null;
class Stall extends engine.BaseFunction {
  override minParams = 0; override maxParams = 0;
  override calculate(): never { parentPort.postMessage({ fixtureEnteredStall: true }); for (;;) {} }
}
type FormulaConfig = NonNullable<NonNullable<Parameters<typeof import('@univerjs/preset-sheets-core/worker').UniverSheetsCoreWorkerPreset>[0]>['formula']>;
const stall: NonNullable<FormulaConfig['function']> = workerData.stall ? [[Stall, 'EVEBOT_TEST_BLOCK']] : [];
const functions: NonNullable<FormulaConfig['function']> = [...(execution ? execution.qualifiedWorkbookFunctionOverrides(engine) : []), ...stall];
const preset = (pinned('@univerjs/preset-sheets-core/worker') as typeof import('@univerjs/preset-sheets-core/worker')).UniverSheetsCoreWorkerPreset(functions.length ? { formula: { function: functions } } : {});
const English = pinned('@univerjs/preset-sheets-core/locales/en-US');
const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } });
if (workerData.budgetModule) {
  const { assertWorkbookCalculationBudget, assertWorkbookCalculationMutation } = require(workerData.budgetModule) as typeof import('../../src/components/embedded/workbook/formula-worker-budget');
  const units = univer.__getInjector().get(core.IUniverInstanceService), commands = univer.__getInjector().get(core.ICommandService);
  const books = () => units.getAllUnitsForType<Workbook>(core.UniverInstanceType.UNIVER_SHEET).map(book => book.getSnapshot());
  units.unitAdded$.subscribe(() => assertWorkbookCalculationBudget(books(), true));
  commands.beforeCommandExecuted(command => assertWorkbookCalculationMutation(command, books(), sheets.SetRangeValuesMutation.id));
  commands.onCommandExecuted(() => assertWorkbookCalculationBudget(books()));
}
for (const entry of preset.plugins) { const [plugin, options] = Array.isArray(entry) ? entry : [entry]; univer.registerPlugin(plugin, options); }
univer.__getInjector().get(core.IConfigService).setConfig(engine.ENGINE_FORMULA_RETURN_DEPENDENCY_TREE, true);
if (execution) {
  const { assertWorkbookFormulaExecution } = execution;
  const { FUniver } = pinned('@univerjs/core/facade') as typeof import('@univerjs/core/facade'); pinned('@univerjs/engine-formula/facade');
  const api = FUniver.newAPI(univer), units = univer.__getInjector().get(core.IUniverInstanceService), commands = univer.__getInjector().get(core.ICommandService);
  const books = () => units.getAllUnitsForType<Workbook>(core.UniverInstanceType.UNIVER_SHEET).map(book => book.getSnapshot());
  const runtime = { sequenceNodesBuilder: (value: string) => api.getFormula().sequenceNodesBuilder(value), deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType, rangeType: core.RANGE_TYPE };
  commands.beforeCommandExecuted(command => { if (command.id === engine.SetFormulaCalculationStartMutation.id) assertWorkbookFormulaExecution(books(), runtime); });
}
parentPort.postMessage({ fixtureReady: true });

}
run();
