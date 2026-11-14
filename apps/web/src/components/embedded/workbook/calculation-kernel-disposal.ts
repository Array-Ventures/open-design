import { ICommandService, type Univer } from '@univerjs/core';
import { FormulaExecutedStateType, SetFormulaCalculationNotificationMutation } from '@univerjs/engine-formula';
/** Release exact calculation resources, then stop the pinned host-only progress
 * timer before destroying its locale/service owners. STOP is not a result and
 * cannot complete a worker deadline, calculate cells or acknowledge a journal. */
export function disposeWorkbookCalculationKernel(univer: Univer, release: () => void): void {
  try { release(); }
  finally {
    try {
      const commands = univer.__getInjector().get(ICommandService);
      if (commands.hasCommand(SetFormulaCalculationNotificationMutation.id)) commands.syncExecuteCommand(SetFormulaCalculationNotificationMutation.id,
        { functionsExecutedState: FormulaExecutedStateType.STOP_EXECUTION }, { onlyLocal: true });
    } finally { univer.dispose(); }
  }
}
