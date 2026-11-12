// Worker-safe pinned APIs only: no browser UI preset, application fetches,
// project paths, credentials, workspace writes or XLSX serialization.
import { IConfigService, ICommandService, IUniverInstanceService, LocaleType, RANGE_TYPE, Univer, UniverInstanceType, type Workbook } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import * as engine from '@univerjs/engine-formula';
import '@univerjs/engine-formula/facade';
import { UniverSheetsCoreWorkerPreset } from '@univerjs/preset-sheets-core/worker';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import { assertWorkbookCalculationBudget, assertWorkbookCalculationMutation } from './formula-worker-budget';
import { workbookWorkerInputProvenance, workbookCalculationChangesInputs } from './formula-input-provenance';
import { assertWorkbookFormulaExecution, qualifiedWorkbookFunctionOverrides } from './formula-execution-policy';

let unavailable = false;
const fail = () => {
  if (!unavailable) { unavailable = true; self.postMessage({ type: 'studio:workbook-calculation-worker', kind: 'unavailable' }); }
  throw Error('The workbook exceeded its qualified calculation boundary.');
};
try {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: SheetsEnUS } });
  const injector = univer.__getInjector(), units = injector.get(IUniverInstanceService), commands = injector.get(ICommandService);
  const books = () => units.getAllUnitsForType<Workbook>(UniverInstanceType.UNIVER_SHEET).map(book => book.getSnapshot());
  const api = FUniver.newAPI(univer), provenance = workbookWorkerInputProvenance();
  const runtime = { sequenceNodesBuilder: (value: string) => api.getFormula().sequenceNodesBuilder(value), deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType, rangeType: RANGE_TYPE };
  // Register guards before any remote unit or formula controller can run.
  units.unitAdded$.subscribe(() => { try { assertWorkbookCalculationBudget(books(), true); } catch { fail(); } });
  commands.beforeCommandExecuted((command, options) => {
    if (unavailable) fail();
    try {
      assertWorkbookCalculationMutation(command, books(), SetRangeValuesMutation.id);
      if (command.id === SetRangeValuesMutation.id && !options?.fromFormula && workbookCalculationChangesInputs(command.params)) provenance.changed();
      if ([engine.SetFormulaCalculationResultMutation.id, engine.SetFormulaDependencyCalculationResultMutation.id, engine.SetArrayFormulaDataMutation.id].includes(command.id)) {
        const book = books()[0];
        if (book && command.params && typeof command.params === 'object') Object.assign(command.params, { workbookCalculation: provenance.tag(book) });
      }
      if (command.id === engine.SetFormulaCalculationStartMutation.id) assertWorkbookFormulaExecution(books(), runtime);
    } catch { fail(); }
  });
  commands.onCommandExecuted(() => { try { assertWorkbookCalculationBudget(books()); } catch { fail(); } });
  const preset = UniverSheetsCoreWorkerPreset({ formula: { function: qualifiedWorkbookFunctionOverrides(engine) } });
  for (const entry of preset.plugins) {
    const [plugin, options] = Array.isArray(entry) ? entry : [entry];
    univer.registerPlugin(plugin, options);
  }
  injector.get(engine.ICalculateFormulaService).executionInProgressListener$.subscribe(progress => {
    if (progress.stage === 1) provenance.started(books());
  });
  injector.get(IConfigService).setConfig(engine.ENGINE_FORMULA_RETURN_DEPENDENCY_TREE, true);
  self.postMessage({ type: 'studio:workbook-calculation-worker', kind: 'ready' });
} catch { if (!unavailable) { unavailable = true; self.postMessage({ type: 'studio:workbook-calculation-worker', kind: 'unavailable' }); } }
