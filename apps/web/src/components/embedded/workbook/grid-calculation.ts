import type { WorkbookCalculationResultMessage } from './formula-worker-message';
import { ICommandService, InterceptorEffectEnum, type ICellData, type IWorkbookData, type Univer } from '@univerjs/core';
import * as engine from '@univerjs/engine-formula';
import { INTERCEPTOR_POINT, SetRangeValuesMutation, SheetInterceptorService } from '@univerjs/sheets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { ownWorkbookCalculationWorker } from './calculation-worker-owner';
import { WorkbookFormulaDisplay } from './formula-display-policy';
import { assertWorkbookCalculationBudget, assertWorkbookCalculationMutation, isWorkbookCalculationStructuralMutation } from './formula-worker-budget';
import { workbookCalculationState, type WorkbookCalculationState } from './calculation-state';
import { workbookCalculationChangesInputs, WORKBOOK_INPUT_EPOCH_OPTION } from './formula-input-provenance';
import type { FUniver } from '@univerjs/core/facade';

/** Only this disposable calculation replica receives authored cells. It cannot
 * fetch assets, save files, select a different branch or acknowledge a journal. */
export function workbookLiveCalculationEligible(model: WorkbookDocument, snapshot: IWorkbookData): boolean {
  if (model.calculationMetadata === 'unsupported') return false;
  if (model.sheets.some(sheet => sheet.arrayFormulas === undefined || sheet.arrayFormulas.length > 0)) return false;
  try { assertWorkbookCalculationBudget([snapshot], true); return true; } catch { return false; }
}
export function attachWorkbookCalculation(univer: Univer, api: FUniver, model: WorkbookDocument, original: IWorkbookData, initial: IWorkbookData,
  snapshot: () => IWorkbookData, owner: ReturnType<typeof ownWorkbookCalculationWorker> | null, changed: (status: WorkbookCalculationState) => void) {
  const injector = univer.__getInjector(), commands = injector.get(ICommandService), functions = injector.get(engine.IFunctionService);
  const display = new WorkbookFormulaDisplay(model, original, initial, { sequenceNodesBuilder: value => api.getFormula().sequenceNodesBuilder(value), hasExecutor: name => functions.hasExecutor(name), deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType });
  if (!owner) display.pause('Stored results');
  let generation: number | null = null, scalarRequired = false, inputEpoch = 0;
  let completion: Extract<WorkbookCalculationResultMessage, { kind: 'complete' }> | null = null;
  const formulas = (book: IWorkbookData) => Object.values(book.sheets).some(sheet => Object.values(sheet.cellData ?? {}).some(row => Object.values(row ?? {}).some(cell => Boolean((cell as ICellData | null | undefined)?.f))));
  const publish = () => {
    changed(workbookCalculationState(display.summary()));
  };
  // SDK graph publication is asynchronous, so a genuine terminal can arrive
  // first. Retain only one candidate for this input epoch, bounded by its
  // existing deadline, and require the matching graph before accepting it.
  const finishWithoutResult = () => {
    if (scalarRequired || generation === null || !completion || !display.completeWithoutResult(completion)) return;
    owner?.deadline.complete(generation); generation = null; completion = null; publish();
  };
  const before = commands.beforeCommandExecuted((command, options) => {
    if (owner && command.id.startsWith('sheet.mutation.') && !options?.fromFormula) {
      try { assertWorkbookCalculationMutation(command, [snapshot()], SetRangeValuesMutation.id); } catch (error) { owner.deadline.fail(); throw error; }
    }
    const changesInputs = !options?.fromFormula && (isWorkbookCalculationStructuralMutation(command.id) || command.id === SetRangeValuesMutation.id && workbookCalculationChangesInputs(command.params));
    if (owner && changesInputs) {
      if (!Number.isSafeInteger(++inputEpoch)) { owner.deadline.fail(); throw Error('Workbook input epoch exceeds its limit.'); }
      // The pinned command service supplies this per-execution object; our RPC
      // queue patch snapshots it before a compound command can reuse it.
      options![WORKBOOK_INPUT_EPOCH_OPTION] = inputEpoch;
      display.expectInputEpoch(inputEpoch); completion = null;
    }
    if (owner && isWorkbookCalculationStructuralMutation(command.id) && formulas(snapshot())) {
      generation = owner.deadline.begin(); scalarRequired = true;
    }
    if (owner && command.id === engine.SetFormulaCalculationStartMutation.id) {
      options![WORKBOOK_INPUT_EPOCH_OPTION] = inputEpoch;
      // Keep requiring a verified scalar pass through coalesced/restarted
      // calculations until this structural input epoch has really completed.
      if (scalarRequired) Object.assign(command.params ?? {}, { forceCalculation: true });
    }

    if (command.id === SetRangeValuesMutation.id) {
      if (options?.fromFormula) display.rangeResult(command.params as Parameters<WorkbookFormulaDisplay['rangeResult']>[0]);
      else if (owner && workbookCalculationChangesInputs(command.params) && (formulas(snapshot()) || Object.values((command.params as { cellValue?: Record<string, Record<string, ICellData>> }).cellValue ?? {}).some(row => Object.values(row).some(cell => cell?.f)))) {
        completion = null; generation = owner.deadline.begin();
      }
    } else if (command.id === engine.SetFormulaCalculationResultMutation.id) {
      if (display.scalarResult(command.params as Parameters<WorkbookFormulaDisplay['scalarResult']>[0]) && generation !== null) { owner?.deadline.complete(generation); generation = null; completion = null; scalarRequired = false; }
      publish();
    } else if (command.id === engine.SetFormulaDependencyCalculationResultMutation.id) display.graphResult(command.params as Parameters<WorkbookFormulaDisplay['graphResult']>[0]);
    else if (command.id === engine.SetArrayFormulaDataMutation.id) display.arrayResult(command.params as Parameters<WorkbookFormulaDisplay['arrayResult']>[0]);
  });
  const after = commands.onCommandExecuted((command, options) => {
    if (command.id === SetRangeValuesMutation.id || isWorkbookCalculationStructuralMutation(command.id)) {
      const current = snapshot(), hasFormulas = formulas(current);
      if (!hasFormulas && generation !== null) { owner?.deadline.complete(generation); generation = null; completion = null; scalarRequired = false; }
      display.update(current, Boolean(owner && hasFormulas && !options?.fromFormula && (isWorkbookCalculationStructuralMutation(command.id) || workbookCalculationChangesInputs(command.params)))); publish();
    }
  });
  const unsubscribe = owner?.onResult(result => {
    if (result.kind === 'graph') { display.graphResult(result); finishWithoutResult(); }
    else if (result.kind === 'arrays') display.arrayResult(result);
    else if (generation !== null && !scalarRequired && display.isCurrentCompletion(result) && (!completion || result.workbookCalculation.generation >= completion.workbookCalculation.generation)) { completion = result; finishWithoutResult(); }
  });
  const intercept = injector.get(SheetInterceptorService).intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
    priority: 90, effect: InterceptorEffectEnum.Value,
    handler: (cell, location, next) => next(display.display(location.subUnitId, location.row, location.col, (cell ?? {}) as ICellData, location.rawData || undefined)),
  });
  publish();
  return { status: (sheet: string, row: number, column: number) => display.status(sheet, row, column), dispose() { before.dispose(); after.dispose(); unsubscribe?.(); intercept.dispose(); } };
}
