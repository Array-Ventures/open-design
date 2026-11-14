import { afterEach, expect, it, vi } from 'vitest';
import { ICommandService, IUndoRedoService, LocaleType, Univer } from '@univerjs/core';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { CalculationMode, UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { FormulaExecutedStateType, FormulaExecuteStageType, SetFormulaCalculationNotificationMutation, UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import English from '@univerjs/sheets/locale/en-US';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import { disposeWorkbookCalculationKernel } from '../../src/components/embedded/workbook/calculation-kernel-disposal';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('cancels the real pinned host progress timer after worker release and before SDK disposal without altering data/history', () => {
  vi.useFakeTimers();
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin, { initialFormulaComputing: CalculationMode.NO_CALCULATION });
  const api = FUniver.newAPI(univer), book = api.createWorkbook({ id: 'progress-cleanup', sheetOrder: ['1'], sheets: { 1: { id: '1', name: 'One', rowCount: 100, columnCount: 26, cellData: { 0: { 0: { v: 12, t: 2 } } } } } });
  const commands = univer.__getInjector().get(ICommandService), history = univer.__getInjector().get(IUndoRedoService), order: string[] = [], sourceWrites = vi.fn();
  const before = book.save(), checkpoint = history.getUndoRedoCheckpoint();
  const originalDispose = univer.dispose.bind(univer);
  vi.spyOn(univer, 'dispose').mockImplementation(() => { order.push('disposed'); originalDispose(); });
  const observe = commands.onCommandExecuted(command => {
    if (command.id.startsWith('sheet.mutation.')) sourceWrites();
    if (command.id === SetFormulaCalculationNotificationMutation.id && (command.params as { functionsExecutedState?: number }).functionsExecutedState === FormulaExecutedStateType.STOP_EXECUTION) {
      order.push('progress-stopped'); expect(book.save()).toEqual(before); expect(history.getUndoRedoCheckpoint()).toEqual(checkpoint);
    }
  });
  commands.syncExecuteCommand(SetFormulaCalculationNotificationMutation.id, { stageInfo: { stage: FormulaExecuteStageType.START } }, { onlyLocal: true });
  disposeWorkbookCalculationKernel(univer, () => { order.push('worker-released'); });
  expect(() => vi.advanceTimersByTime(1100)).not.toThrow();
  expect(order).toEqual(['worker-released', 'progress-stopped', 'disposed']);
  expect(sourceWrites).not.toHaveBeenCalled(); observe.dispose();
});
