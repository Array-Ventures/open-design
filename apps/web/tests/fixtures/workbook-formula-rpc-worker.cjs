// Actual pinned RPC/engine fixture in an owned, memory-limited Node worker.
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const pinned = createRequire(workerData.packageRoot);
const listeners = new Map();
globalThis.addEventListener = (type, listener) => { if (type !== 'message') return; const handler = data => listener({ data }); listeners.set(listener, handler); parentPort.on('message', handler); };
globalThis.removeEventListener = (type, listener) => { const handler = listeners.get(listener); if (handler) parentPort.off('message', handler); listeners.delete(listener); };
globalThis.postMessage = data => parentPort.postMessage(data);
globalThis.fetch = () => { throw Error('Fixture formulas must not fetch network data.'); };
const core = pinned('@univerjs/core'), engine = pinned('@univerjs/engine-formula'), sheets = pinned('@univerjs/sheets');
const preset = pinned('@univerjs/preset-sheets-core/worker').UniverSheetsCoreWorkerPreset();
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
parentPort.postMessage({ fixtureReady: true });
