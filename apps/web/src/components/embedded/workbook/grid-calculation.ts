import { WORKBOOK_MEMBERSHIP_OPTION, protectedFormulaInputNormalization, membershipMutationIds, workbookSheetCommandSha256, type WorkbookProtectedSheetSequence, type WorkbookMembershipPermit } from './sheet-calculation-permit';
import type { WorkbookCalculationResultMessage } from './formula-worker-message';
import { ICommandService, InterceptorEffectEnum, type ICellData, type IWorkbookData, type Univer } from '@univerjs/core';
import * as engine from '@univerjs/engine-formula';
import { INTERCEPTOR_POINT, SetRangeValuesMutation, SheetInterceptorService } from '@univerjs/sheets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { ownWorkbookCalculationWorker } from './calculation-worker-owner';
import { WorkbookFormulaDisplay } from './formula-display-policy';
import { assertWorkbookCalculationBudget, projectWorkbookCalculationInputs, assertWorkbookCalculationMutation, isWorkbookCalculationStructuralMutation } from './formula-worker-budget';
import { workbookCalculationState, type WorkbookCalculationState } from './calculation-state';
import { workbookCalculationInputSha256, workbookCalculationChangesInputs, WORKBOOK_INPUT_EPOCH_OPTION } from './formula-input-provenance';
import type { FUniver } from '@univerjs/core/facade';

/** Only this disposable calculation replica receives authored cells. It cannot
 * fetch assets, save files, select a different branch or acknowledge a journal. */
export function workbookLiveCalculationEligible(model: WorkbookDocument, snapshot: IWorkbookData): boolean {
  if (model.calculationMetadata === 'unsupported') return false;
  if (model.sheets.some(sheet => sheet.arrayFormulas === undefined || sheet.arrayFormulas.length > 0)) return false;
  try { assertWorkbookCalculationBudget([snapshot], true); return true; } catch { return false; }
}
export function attachWorkbookCalculation(univer: Univer, api: FUniver, model: WorkbookDocument, original: IWorkbookData, initial: IWorkbookData,
  snapshot: () => IWorkbookData, owner: ReturnType<typeof ownWorkbookCalculationWorker> | null, changed: (status: WorkbookCalculationState) => void, membershipCurrent: () => boolean = () => false) {
  const injector = univer.__getInjector(), commands = injector.get(ICommandService), functions = injector.get(engine.IFunctionService);
  const display = new WorkbookFormulaDisplay(model, original, initial, { sequenceNodesBuilder: value => api.getFormula().sequenceNodesBuilder(value), hasExecutor: name => functions.hasExecutor(name), deserializeRangeWithSheet: engine.deserializeRangeWithSheet, sequenceNodeType: engine.sequenceNodeType });
  if (!owner) display.pause('Stored results');
  let generation: number | null = null, scalarRequired = false, inputEpoch = 0;
  let pendingMembership: { sequence: number; inputEpoch: number; inputSha256: string; applied: boolean; scalar: boolean } | null = null;
  let settledInputEpoch = 0;
  let authoredFreeze: object | null = null;
  const pendingApplications = new Set<string>();
  const completedApplications = new Set<string>();
  const applicationSources = new WeakMap<object, unknown>();
  const applyingResults = new WeakMap<object, string>();
  type RangeResult = Parameters<WorkbookFormulaDisplay['rangeResult']>[0];
  const applicationKey = (unitId: string, sheetId: string, rows: RangeResult['cellValue'], source: RangeResult['sourceFormulaData'], provenance: unknown) => {
    if (!provenance) return undefined;
    const values = Object.fromEntries(Object.entries(rows).map(([row, columns]) => [row,
      Object.fromEntries(Object.entries(columns).map(([column, cell]) => {
        const { s: _numberFormat, ...result } = (cell ?? {}) as ICellData; return [column, result];
      }))]));
    return workbookSheetCommandSha256({ id: 'studio.formula.application', params: { unitId, sheetId, values, source, provenance } });
  };
  const waiters = new Set<{ quiescent: boolean; resolve(): void; reject(error: Error): void }>();
  const rejectWaiters = () => { for (const waiter of waiters) waiter.reject(Error('Worksheet calculation is unavailable.')); waiters.clear(); };
  const awaitCalculation = (quiescent: boolean, signal?: AbortSignal): Promise<void> => {
    if (!owner?.ready || signal?.aborted) return Promise.reject(Error('Worksheet calculation is unavailable.'));
    if (!pendingMembership && (!quiescent || generation === null && pendingApplications.size === 0 && settledInputEpoch === inputEpoch && !display.summary().pending)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const abort = () => { waiters.delete(waiter); reject(Error('Worksheet calculation wait was cancelled.')); };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const waiter = { quiescent, resolve() { cleanup(); resolve(); }, reject(error: Error) { cleanup(); reject(error); } };
      waiters.add(waiter); signal?.addEventListener('abort', abort, { once: true });
    });
  };
  const finishMembership = () => {
    if (!pendingMembership?.applied || pendingApplications.size || formulas(snapshot()) && !pendingMembership.scalar) return false;
    pendingMembership = null; settledInputEpoch = inputEpoch;
    if (generation !== null) { owner?.deadline.complete(generation); generation = null; }
    scalarRequired = false; completion = null;
    for (const waiter of waiters) { if (!waiter.quiescent) { waiters.delete(waiter); waiter.resolve(); } }
    return true;
  };
  let authoredRange: unknown = null;
  let sequence = 0;
  let protectedSequence: { hashes: string[]; beforeDigests: string[]; params: unknown[]; index: number; sequence: number } | null = null;
  const runProtectedSequence: WorkbookProtectedSheetSequence = (mutations, prospective, execute) => {
    if (protectedSequence || !owner?.ready || !owner.membership || !membershipCurrent() || !mutations.length || mutations.length > 4096
      || !mutations.some(mutation => membershipMutationIds.has(mutation.id))
      || mutations.some(mutation => !membershipMutationIds.has(mutation.id) && mutation.id !== SetRangeValuesMutation.id)) throw Error('Protected worksheet calculation is not ready.');
    assertWorkbookCalculationBudget([prospective], true);
    if (prospective.id !== snapshot().id) throw Error('Protected worksheet calculation target changed.');
    if (!Number.isSafeInteger(inputEpoch + mutations.length)) throw Error('Worksheet calculation input epoch exceeded its limit.');
    if (!Number.isSafeInteger(++sequence)) throw Error('Worksheet calculation sequence exceeded its limit.');
    let projected = snapshot();
    const beforeDigests = mutations.map((mutation, index) => {
      const before = workbookCalculationInputSha256(projected);
      projected = projectWorkbookCalculationInputs(mutation, projected, { ...owner.membership!, inputEpoch: inputEpoch + index + 1, sequence, index, count: mutations.length, commandSha256: workbookSheetCommandSha256(mutation), beforeInputSha256: before });
      return before;
    });
    if (workbookCalculationInputSha256(projected) !== workbookCalculationInputSha256(prospective)) throw Error('Protected worksheet calculation projection changed.');
    const active = { hashes: mutations.map(workbookSheetCommandSha256), beforeDigests, params: mutations.map(mutation => structuredClone(mutation.params)), index: 0, sequence };
    pendingMembership = { sequence, inputEpoch: inputEpoch + mutations.length, inputSha256: workbookCalculationInputSha256(prospective), applied: false, scalar: false };
    generation = owner.deadline.begin();
    protectedSequence = active;
    try {
      const result = execute();
      if (workbookCalculationInputSha256(snapshot()) !== workbookCalculationInputSha256(prospective) || result !== true || active.index !== active.hashes.length || !membershipCurrent() || !owner.ready) throw Error('Protected worksheet calculation did not complete.');
      return true;
    } catch (error) { owner.deadline.fail(); throw error; }
    finally { protectedSequence = null; authoredRange = null; }
  };
  let completion: Extract<WorkbookCalculationResultMessage, { kind: 'complete' }> | null = null;
  const formulas = (book: IWorkbookData) => Object.values(book.sheets).some(sheet => Object.values(sheet.cellData ?? {}).some(row => Object.values(row ?? {}).some(cell => Boolean((cell as ICellData | null | undefined)?.f))));
  const publish = () => {
    const summary = display.summary();
    if (!pendingMembership && generation === null && pendingApplications.size === 0 && settledInputEpoch === inputEpoch && !summary.pending) {
      for (const waiter of waiters) { waiters.delete(waiter); waiter.resolve(); }
    }
    changed(workbookCalculationState({ ...summary, pending: Boolean(owner?.ready && (summary.pending || pendingMembership || generation !== null || pendingApplications.size)) }));
  };
  // SDK graph publication is asynchronous, so a genuine terminal can arrive
  // first. Retain only one candidate for this input epoch, bounded by its
  // existing deadline, and require the matching graph before accepting it.
  const finishWithoutResult = () => {
    if (pendingApplications.size || pendingMembership && !pendingMembership.applied || scalarRequired || generation === null || !completion || !display.completeWithoutResult(completion)) return;
    owner?.deadline.complete(generation); generation = null; completion = null; settledInputEpoch = inputEpoch; publish();
  };
  const before = commands.beforeCommandExecuted((command, options) => {
    // Derived data reaches the SAME non-promoting preservation/key admission
    // below. The option flag alone never authorizes an SDK mutation.
    const pausedCache = Boolean(authoredFreeze && command.id === SetRangeValuesMutation.id && options?.fromFormula);
    if (authoredFreeze && command.id.startsWith('sheet.mutation.') && !pausedCache) throw Error('The workbook is paused while History is checked.');
    const membershipMutation = membershipMutationIds.has(command.id);
    let permit: WorkbookMembershipPermit | undefined;
    if (owner && command.id.startsWith('sheet.mutation.') && !options?.fromFormula) {
      try {
        if (options?.[WORKBOOK_MEMBERSHIP_OPTION] !== undefined) throw Error('Worksheet calculation permit was not privately issued.');
        if (protectedSequence) {
          const configuration = owner.membership;
          if (!configuration || !membershipCurrent() || protectedSequence.hashes[protectedSequence.index] !== workbookSheetCommandSha256(command)) throw Error('Protected worksheet calculation sequence changed.');
          permit = { ...configuration, inputEpoch: inputEpoch + 1, sequence: protectedSequence.sequence, index: protectedSequence.index, count: protectedSequence.hashes.length,
            commandSha256: workbookSheetCommandSha256(command), beforeInputSha256: protectedSequence.beforeDigests[protectedSequence.index]! };
        } else if (membershipMutation) throw Error('Worksheet calculation has no private execution scope.');
        assertWorkbookCalculationMutation(command, [snapshot()], SetRangeValuesMutation.id, permit);
      } catch (error) { owner.deadline.fail(); throw error; }
    }
    const changesInputs = !options?.fromFormula && (Boolean(permit) || membershipMutation || isWorkbookCalculationStructuralMutation(command.id) || command.id === SetRangeValuesMutation.id && workbookCalculationChangesInputs(command.params));
    if (owner && changesInputs) {
      if (!Number.isSafeInteger(++inputEpoch)) { owner.deadline.fail(); throw Error('Workbook input epoch exceeds its limit.'); }
      // The pinned command service supplies this per-execution object; our RPC
      // queue patch snapshots it before a compound command can reuse it.
      options![WORKBOOK_INPUT_EPOCH_OPTION] = inputEpoch;
      if (permit) { options![WORKBOOK_MEMBERSHIP_OPTION] = JSON.stringify(permit); protectedSequence!.index++;
        if (command.id === SetRangeValuesMutation.id) authoredRange = command.params; }
      if (pendingMembership) pendingMembership.scalar = false;
      display.expectInputEpoch(inputEpoch); completion = null; pendingApplications.clear(); completedApplications.clear();
    }
    if (owner && (membershipMutation || isWorkbookCalculationStructuralMutation(command.id)) && formulas(snapshot())) {
      generation = owner.deadline.begin(); scalarRequired = true;
    }
    if (owner && command.id === engine.SetFormulaCalculationStartMutation.id) {
      if (generation === null && (formulas(snapshot()) || pendingMembership || pendingApplications.size)) generation = owner.deadline.begin();
      options![WORKBOOK_INPUT_EPOCH_OPTION] = inputEpoch;
      // Keep requiring a verified scalar pass through coalesced/restarted
      // calculations until this structural input epoch has really completed.
      if (scalarRequired) Object.assign(command.params ?? {}, { forceCalculation: true });
      publish();
    }

    if (command.id === SetRangeValuesMutation.id) {
      if (options?.fromFormula) {
        if (!protectedSequence || !protectedFormulaInputNormalization(command.params, authoredRange ?? protectedSequence?.params[protectedSequence.index])) {
          const params = command.params as Parameters<WorkbookFormulaDisplay['rangeResult']>[0];
          let knownApplication = false;
          display.rangeResult(params, (normalized, tag) => {
            const key = applicationKey(normalized.unitId, normalized.subUnitId, normalized.cellValue, normalized.sourceFormulaData, tag);
            if (key && completedApplications.has(key)) { knownApplication = true; return false; }
            if (!key || !pendingApplications.has(key)) {
              display.pause('Calculation application changed.'); owner?.deadline.fail(); publish(); return false;
            }
            knownApplication = true; applyingResults.set(params, key); return true;
          });
          if (pausedCache && !knownApplication) throw Error('The workbook is paused while History is checked.');
        }
      }
      else if (owner && workbookCalculationChangesInputs(command.params) && (formulas(snapshot()) || Object.values((command.params as { cellValue?: Record<string, Record<string, ICellData>> }).cellValue ?? {}).some(row => Object.values(row).some(cell => cell?.f)))) {
        completion = null; generation = owner.deadline.begin();
      }
    } else if (command.id === engine.SetFormulaCalculationResultMutation.id) {
      if (display.scalarResult(command.params as Parameters<WorkbookFormulaDisplay['scalarResult']>[0]) && generation !== null) {
        settledInputEpoch = inputEpoch;
        const params = command.params as Parameters<WorkbookFormulaDisplay['scalarResult']>[0];
        pendingApplications.clear(); completedApplications.clear();
        for (const [sheet, rows] of Object.entries(params.unitData[initial.id] ?? {})) {
          const source = params.sourceFormulaData?.[initial.id]?.[sheet];
          if (source && Object.values(rows).some(columns => Object.keys(columns).length > 0)) {
            const key = applicationKey(initial.id, sheet, rows, source, params.workbookCalculation);
            if (key) { pendingApplications.add(key); applicationSources.set(source, params.workbookCalculation); }
          }
        }
        if (pendingMembership) { pendingMembership.scalar = true; finishMembership(); }
        else {
          scalarRequired = false; completion = null;
          if (!pendingApplications.size) { owner?.deadline.complete(generation); generation = null; }
        }
      }
      publish();
    } else if (command.id === engine.SetFormulaDependencyCalculationResultMutation.id) display.graphResult(command.params as Parameters<WorkbookFormulaDisplay['graphResult']>[0]);
    else if (command.id === engine.SetArrayFormulaDataMutation.id) display.arrayResult(command.params as Parameters<WorkbookFormulaDisplay['arrayResult']>[0]);
  });
  const after = commands.onCommandExecuted((command, options) => {
    if (command.id === SetRangeValuesMutation.id && command.params && applyingResults.has(command.params)) {
      const params = command.params as RangeResult;
      const key = applyingResults.get(params)!; applyingResults.delete(params);
      const actual = snapshot().sheets[params.subUnitId]?.cellData;
      const unchanged = key === applicationKey(params.unitId, params.subUnitId, params.cellValue, params.sourceFormulaData, params.workbookCalculation
        ?? (params.sourceFormulaData && applicationSources.get(params.sourceFormulaData)));
      const provenance = params.workbookCalculation ?? (params.sourceFormulaData && applicationSources.get(params.sourceFormulaData));
      const expectedInput = (provenance as { inputSha256?: unknown } | undefined)?.inputSha256;
      const applied = unchanged && expectedInput === workbookCalculationInputSha256(snapshot()) && Object.entries(params.cellValue).every(([row, columns]) => Object.entries(columns).every(([column, cell]) => {
        const value = actual?.[Number(row)]?.[Number(column)];
        return value?.v === cell?.v && value?.t === cell?.t;
      }));
      if (!applied) {
        display.pause('Calculation application changed.'); owner?.deadline.fail(); publish(); return;
      }
      pendingApplications.delete(key); completedApplications.add(key);
      if (pendingMembership) finishMembership();
      else if (!pendingApplications.size && generation !== null && settledInputEpoch === inputEpoch) {
        owner?.deadline.complete(generation); generation = null;
      }
    }
    if (command.id === SetRangeValuesMutation.id && !options?.fromFormula) authoredRange = null;
    if (command.id === SetRangeValuesMutation.id || membershipMutationIds.has(command.id) || isWorkbookCalculationStructuralMutation(command.id)) {
      const current = snapshot(), hasFormulas = formulas(current);
      if (!hasFormulas && !pendingMembership) settledInputEpoch = inputEpoch;
      if (!hasFormulas && generation !== null) {
        if (pendingMembership) finishMembership();
        else { owner?.deadline.complete(generation); generation = null; completion = null; scalarRequired = false; }
      }
      display.update(current, Boolean(owner && hasFormulas && !options?.fromFormula && (membershipMutationIds.has(command.id) || isWorkbookCalculationStructuralMutation(command.id) || workbookCalculationChangesInputs(command.params)))); publish();
    }
  });
  const unsubscribe = owner?.onResult(result => {
    if (result.kind === 'membership-applied') {
      const pending = pendingMembership, configuration = owner?.membership;
      if (!pending || result.sequence < pending.sequence) return;
      if (!configuration || JSON.stringify(result.configuration) !== JSON.stringify(configuration) || result.sequence !== pending.sequence
        || result.inputEpoch !== pending.inputEpoch || result.inputSha256 !== pending.inputSha256) { owner?.deadline.fail(); return; }
      pending.applied = true; finishMembership(); publish();
    } else if (result.kind === 'graph') { display.graphResult(result); finishWithoutResult(); }
    else if (result.kind === 'arrays') display.arrayResult(result);
    else if (generation !== null && !scalarRequired && display.isCurrentCompletion(result) && (!completion || result.workbookCalculation.generation >= completion.workbookCalculation.generation)) { completion = result; finishWithoutResult(); }
  });
  const unavailable = owner?.onUnavailable(() => { rejectWaiters(); display.pause('Worksheet calculation unavailable.'); publish(); });
  const intercept = injector.get(SheetInterceptorService).intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
    priority: 90, effect: InterceptorEffectEnum.Value,
    handler: (cell, location, next) => next(display.display(location.subUnitId, location.row, location.col, (cell ?? {}) as ICellData, location.rawData || undefined)),
  });
  publish();
  return { freezeAuthoring() {
    if (!owner?.ready || authoredFreeze) throw Error('The workbook calculation cannot be paused.');
    const ticket = {}; authoredFreeze = ticket;
    return () => { if (authoredFreeze === ticket && owner.ready) authoredFreeze = null; };
  }, get inputEpoch() { return inputEpoch; }, get quiescent() { return Boolean(owner?.ready && generation === null && pendingApplications.size === 0 && !pendingMembership && settledInputEpoch === inputEpoch && !display.summary().pending); }, awaitMembership: (signal?: AbortSignal) => awaitCalculation(false, signal), awaitQuiescent: (signal?: AbortSignal) => awaitCalculation(true, signal), runProtectedSequence, rebaseSource(nextModel: WorkbookDocument, nextOriginal: IWorkbookData, acknowledged: IWorkbookData) { display.rebaseSource(nextModel, nextOriginal, acknowledged); }, publish, status: (sheet: string, row: number, column: number) => display.status(sheet, row, column), dispose() { rejectWaiters(); unavailable?.(); before.dispose(); after.dispose(); unsubscribe?.(); intercept.dispose(); } };
}
