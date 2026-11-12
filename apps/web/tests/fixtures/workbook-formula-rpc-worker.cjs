// Actual pinned RPC/engine fixture in an owned, memory-limited Node worker.
require('tsx/cjs');
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const pinned = createRequire(workerData.packageRoot);
const listeners = new Map();
globalThis.addEventListener = (type, listener) => { if (type !== 'message') return; const handler = data => listener({ data }); listeners.set(listener, handler); parentPort.on('message', handler); };
globalThis.removeEventListener = (type, listener) => { const handler = listeners.get(listener); if (handler) parentPort.off('message', handler); listeners.delete(listener); };
globalThis.postMessage = data => parentPort.postMessage(data);
globalThis.fetch = () => { throw Error('Fixture formulas must not fetch network data.'); };
const core = pinned('@univerjs/core'), engine = pinned('@univerjs/engine-formula'), sheets = pinned('@univerjs/sheets');
const execution = workerData.executionModule ? require(workerData.executionModule) : null;
class Stall extends engine.BaseFunction {
  minParams = 0; maxParams = 0;
  calculate() { parentPort.postMessage({ fixtureEnteredStall: true }); for (;;) {} }
}
const functions = [...(execution ? execution.qualifiedWorkbookFunctionOverrides(engine) : []), ...(workerData.stall ? [[Stall, 'EVEBOT_TEST_BLOCK']] : [])];
const preset = pinned('@univerjs/preset-sheets-core/worker').UniverSheetsCoreWorkerPreset(functions.length ? { formula: { function: functions } } : {});
const English = pinned('@univerjs/preset-sheets-core/locales/en-US');
const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: English.default ?? English } });
if (workerData.budgetModule) {
  const { assertWorkbookCalculationBudget, assertWorkbookCalculationMutation } = require(workerData.budgetModule);
  const units = univer.__getInjector().get(core.IUniverInstanceService), commands = univer.__getInjector().get(core.ICommandService);
  const books = () => units.getAllUnitsForType(core.UniverInstanceType.UNIVER_SHEET).map(book => book.getSnapshot());
  units.unitAdded$.subscribe(() => assertWorkbookCalculationBudget(books(), true));
  commands.beforeCommandExecuted(command => assertWorkbookCalculationMutation(command, books(), sheets.SetRangeValuesMutation.id));
  commands.onCommandExecuted(() => assertWorkbookCalculationBudget(books()));
}
for (const entry of preset.plugins) { const [plugin, options] = Array.isArray(entry) ? entry : [entry]; univer.registerPlugin(plugin, options); }
univer.__getInjector().get(core.IConfigService).setConfig(engine.ENGINE_FORMULA_RETURN_DEPENDENCY_TREE, true);
if (workerData.executionModule) {
  const { assertWorkbookFormulaExecution } = execution;
  const { FUniver } = pinned('@univerjs/core/facade'); pinned('@univerjs/engine-formula/facade');
  const api = FUniver.newAPI(univer), units = univer.__getInjector().get(core.IUniverInstanceService), commands = univer.__getInjector().get(core.ICommandService);
  const books = () => units.getAllUnitsForType(core.UniverInstanceType.UNIVER_SHEET).map(book => book.getSnapshot());
  const runtime = { sequenceNodesBuilder: value => api.getFormula().sequenceNodesBuilder(value), deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType, rangeType: core.RANGE_TYPE };
  commands.beforeCommandExecuted(command => { if (command.id === engine.SetFormulaCalculationStartMutation.id) assertWorkbookFormulaExecution(books(), runtime); });
}
parentPort.postMessage({ fixtureReady: true });
