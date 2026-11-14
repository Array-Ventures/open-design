import { WORKBOOK_MEMBERSHIP_OPTION, protectedFormulaInputNormalization, membershipMutationIds, workbookMembershipConfigurationSchema, type WorkbookMembershipPermit, workbookMembershipReplica } from './sheet-calculation-permit';
import { workbookCalculationInputSha256 } from './formula-input-provenance';
import { assertWorkbookStructureIdentity } from './grid-structure-identity';
// Worker-safe pinned APIs only: no browser UI preset, application fetches,
// project paths, credentials, workspace writes or XLSX serialization.
import { IConfigService, ICommandService, IUniverInstanceService, LocaleType, RANGE_TYPE, Univer, UniverInstanceType, type Workbook } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import * as engine from '@univerjs/engine-formula';
import '@univerjs/engine-formula/facade';
import { UniverSheetsCoreWorkerPreset } from '@univerjs/preset-sheets-core/worker';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import { assertWorkbookCalculationBudget, assertWorkbookCalculationMutation, isWorkbookCalculationStructuralMutation } from './formula-worker-budget';
import { workbookWorkerInputProvenance, workbookCalculationChangesInputs, WORKBOOK_INPUT_EPOCH_OPTION } from './formula-input-provenance';
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
  const permitted = new WeakMap<object, WorkbookMembershipPermit>();
  let membershipConfiguration: ReturnType<typeof workbookMembershipConfigurationSchema.parse> | null = null;
  let authoredRange: unknown = null;
  let membership: ReturnType<typeof workbookMembershipReplica> | null = null;
  self.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type !== 'studio:workbook-membership-configure') return;
    try {
      if (membership) fail();
      const configuration = workbookMembershipConfigurationSchema.parse(event.data.configuration);
      membership = workbookMembershipReplica(configuration); membershipConfiguration = configuration;
      self.postMessage({ type: 'studio:workbook-calculation-worker', kind: 'membership-ready', configuration });
    } catch { fail(); }
  });
  const derivedSources = new WeakMap<object, ReturnType<typeof provenance.tag>>();
  const runtime = { sequenceNodesBuilder: (value: string) => api.getFormula().sequenceNodesBuilder(value), deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType, rangeType: RANGE_TYPE };
  // Register guards before any remote unit or formula controller can run.
  units.unitAdded$.subscribe(() => { try { assertWorkbookCalculationBudget(books(), true); } catch { fail(); } });
  commands.beforeCommandExecuted((command, options) => {
    if (unavailable) fail();
    try {
      if (options?.fromFormula && (isWorkbookCalculationStructuralMutation(command.id) || membershipMutationIds.has(command.id))) fail();
      const current = books();
      const proof = options?.[WORKBOOK_MEMBERSHIP_OPTION];
      const permit = proof === undefined ? undefined : membership?.admit(proof, command, Number(options?.[WORKBOOK_INPUT_EPOCH_OPTION]), workbookCalculationInputSha256(current[0]!));
      if (proof !== undefined && !permit || membershipMutationIds.has(command.id) && !permit) fail();
      assertWorkbookCalculationMutation(command, current, SetRangeValuesMutation.id, permit);
      if (permit && command.params && typeof command.params === 'object') permitted.set(command.params, permit);
      if (permit && command.id === SetRangeValuesMutation.id) authoredRange = command.params;
      if (!options?.fromFormula && (membershipMutationIds.has(command.id) || isWorkbookCalculationStructuralMutation(command.id) || command.id === SetRangeValuesMutation.id && workbookCalculationChangesInputs(command.params))) provenance.changed(Number(options?.[WORKBOOK_INPUT_EPOCH_OPTION]));
      if ([engine.SetFormulaCalculationResultMutation.id, engine.SetFormulaDependencyCalculationResultMutation.id, engine.SetArrayFormulaDataMutation.id].includes(command.id)) {
        const book = books()[0];
        if (book && command.params && typeof command.params === 'object') {
          const tag = provenance.tag(book);
          Object.assign(command.params, { workbookCalculation: tag });
          if (command.id === engine.SetFormulaDependencyCalculationResultMutation.id) self.postMessage({ type: 'studio:workbook-calculation-worker', kind: 'graph', ...command.params });
          if (command.id === engine.SetArrayFormulaDataMutation.id) self.postMessage({ type: 'studio:workbook-calculation-worker', kind: 'arrays', workbookCalculation: tag, arrayFormulaRange: (command.params as { arrayFormulaRange?: unknown }).arrayFormulaRange });
          if (command.id === engine.SetFormulaCalculationResultMutation.id) {
            const result = command.params as { unitData: Record<string, Record<string, object>>; unitOtherData?: unknown; sourceFormulaData?: Record<string, Record<string, object>> };
            if (!tag.valid) { result.unitData = {}; result.unitOtherData = {}; }
            for (const sheet of Object.values(result.sourceFormulaData?.[book.id] ?? {})) derivedSources.set(sheet, tag);
          }
        }
      }
      if (command.id === SetRangeValuesMutation.id && options?.fromFormula) {
        const params = command.params as { sourceFormulaData?: object; cellValue: object; workbookCalculation?: unknown };
        const tag = params.sourceFormulaData && derivedSources.get(params.sourceFormulaData);
        if (tag) params.workbookCalculation = tag;
        else if (!protectedFormulaInputNormalization(params, authoredRange)) params.cellValue = {};
      }
      if (command.id === engine.SetFormulaCalculationStartMutation.id) {
        if (options?.[WORKBOOK_INPUT_EPOCH_OPTION] !== provenance.epoch()) fail();
        assertWorkbookFormulaExecution(books(), runtime);
        // The worker preset omits the UI-side controller that copies this flag
        // from configuration into each calculation request.
        Object.assign(command.params ?? {}, { isCalculateTreeModel: true });
      }
    } catch { fail(); }
  });
  commands.onCommandExecuted((command, options) => {
    if (command.id === SetRangeValuesMutation.id && !options?.fromFormula) authoredRange = null;
    try {
      const current = books(); assertWorkbookCalculationBudget(current);
      if (membershipMutationIds.has(command.id) || isWorkbookCalculationStructuralMutation(command.id)) for (const book of current) assertWorkbookStructureIdentity(book);
      const permit = command.params && typeof command.params === 'object' ? permitted.get(command.params) : undefined;
      if (permit) {
        permitted.delete(command.params as object);
        if (permit.index + 1 === permit.count) self.postMessage({ type: 'studio:workbook-calculation-worker', kind: 'membership-applied', configuration: membershipConfiguration,
          sequence: permit.sequence, inputEpoch: permit.inputEpoch, inputSha256: workbookCalculationInputSha256(current[0]!) });
      }
    } catch { fail(); }
  });
  const preset = UniverSheetsCoreWorkerPreset({ formula: { function: qualifiedWorkbookFunctionOverrides(engine) } });
  for (const entry of preset.plugins) {
    const [plugin, options] = Array.isArray(entry) ? entry : [entry];
    univer.registerPlugin(plugin, options);
  }
  injector.get(engine.ICalculateFormulaService).executionInProgressListener$.subscribe(progress => {
    if (progress.stage === 1) provenance.started(books());
  });
  // The pinned engine legitimately emits only a dependency graph when no
  // formula is dirty. A tagged terminal signal ends liveness accounting, not
  // result authority: no cached value is claimed to have been calculated.
  injector.get(engine.ICalculateFormulaService).executionCompleteListener$.subscribe(result => {
    if (unavailable || result.functionsExecutedState !== engine.FormulaExecutedStateType.NOT_EXECUTED) return;
    const book = books()[0];
    if (book) self.postMessage({ type: 'studio:workbook-calculation-worker', kind: 'complete', outcome: 'not-executed', workbookCalculation: provenance.tag(book) });
  });
  injector.get(IConfigService).setConfig(engine.ENGINE_FORMULA_RETURN_DEPENDENCY_TREE, true);
  self.postMessage({ type: 'studio:workbook-calculation-worker', kind: 'ready' });
} catch { if (!unavailable) { unavailable = true; self.postMessage({ type: 'studio:workbook-calculation-worker', kind: 'unavailable' }); } }
