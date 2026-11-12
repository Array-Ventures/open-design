import { ICommandService, type ICellData, type IExecutionOptions, type ICommandInfo, type Univer } from '@univerjs/core';
import { SetRangeValuesMutation, type ISetRangeValuesMutationParams } from '@univerjs/sheets';
import { WorkbookCalculationBudgetError } from './formula-worker-budget';

type Matrix = Record<string, Record<string, ICellData | null>>;
type Intent = { frame: object; command: Readonly<ICommandInfo>; unitId: string; subUnitId: string; cells: Map<string, string | null> };
/** Install before SDK plugins: UpdateFormulaController itself writes from its
 * before-command callback. A late guard cannot validate the outer input first.
 * Only its single synchronous, null-cache formula normalization is authorized;
 * this does not grant the calculation engine permission to write results. */
export function ownArrayInputNormalization(univer: Univer, available: () => boolean = () => true) {
  const commands = univer.__getInjector().get(ICommandService);
  let active = true, validate: ((command: Readonly<ICommandInfo>) => void) | undefined, pending: Intent | undefined;
  const normalized = new WeakSet<object>(), frames: object[] = [];
  const scope = <T>(invoke: () => T): T => {
    const frame = {}; frames.push(frame);
    try { return invoke(); }
    finally { frames.pop(); if (pending?.frame === frame) pending = undefined; }
  };
  // Public dispatch methods provide the exact synchronous before-listener
  // lifetime, including throws. An async command's input normalization also
  // runs synchronously before executeCommand returns its promise.
  const originalSync = commands.syncExecuteCommand, originalAsync = commands.executeCommand;
  const runSync = originalSync.bind(commands), runAsync = originalAsync.bind(commands);
  const sync = <P extends object = object, R = boolean>(id: string, params?: P, options?: IExecutionOptions): R => id === SetRangeValuesMutation.id ? scope(() => runSync<P, R>(id, params, options)) : runSync<P, R>(id, params, options);
  const async = <P extends object = object, R = boolean>(id: string, params?: P, options?: IExecutionOptions): Promise<R> => id === SetRangeValuesMutation.id ? scope(() => runAsync<P, R>(id, params, options)) : runAsync<P, R>(id, params, options);
  commands.syncExecuteCommand = sync; commands.executeCommand = async;
  const refuse = () => { throw new WorkbookCalculationBudgetError('The read-only projection cannot mutate authored cells.'); };
  const before = commands.beforeCommandExecuted((command, options) => {
    if (options?.fromFormula) {
      const intent = pending; pending = undefined;
      if (!active || !available() || !intent || frames.at(-2) !== intent.frame || options.onlyLocal !== true || command.id !== SetRangeValuesMutation.id) return refuse();
      const params = command.params as ISetRangeValuesMutationParams | undefined;
      if (!params || params.unitId !== intent.unitId || params.subUnitId !== intent.subUnitId || !params.cellValue || typeof params.cellValue !== 'object' || Array.isArray(params.cellValue)) return refuse();
      let count = 0;
      for (const [row, columns] of Object.entries(params.cellValue as Matrix)) {
        if (!columns || typeof columns !== 'object' || Array.isArray(columns)) return refuse();
        for (const [column, cell] of Object.entries(columns)) {
          const key = `${row}:${column}`;
          if (!intent.cells.has(key) || !cell || typeof cell !== 'object' || Array.isArray(cell) || cell.f !== intent.cells.get(key) || cell.si !== null || Object.keys(cell).some(key => !['f', 'si', 'v', 't'].includes(key)) || Object.hasOwn(cell, 'v') && cell.v !== null || Object.hasOwn(cell, 't') && cell.t !== null) return refuse();
          count++;
        }
      }
      if (!count) return refuse();
      normalized.add(command); return;
    }
    // Pinned formula metadata/dirty-range commands may be emitted inside the
    // SDK callback before normalization; they are not authored sheet writes.
    if (!command.id.startsWith('sheet.mutation.')) return;
    pending = undefined;
    if (!active || !validate || command.id === SetRangeValuesMutation.id && !available()) return refuse();
    validate(command);
    if (command.id !== SetRangeValuesMutation.id) return;
    const params = command.params as ISetRangeValuesMutationParams;
    if (!params.cellValue) return;
    const cells = new Map<string, string | null>();
    for (const [row, columns] of Object.entries(params.cellValue as Matrix)) for (const [column, cell] of Object.entries(columns ?? {})) cells.set(`${row}:${column}`, typeof cell?.f === 'string' && cell.f ? cell.f : null);
    const frame = frames.at(-1);
    if (!frame) return refuse();
    const intent = { frame, command, unitId: params.unitId, subUnitId: params.subUnitId, cells }; pending = intent;
  });
  return {
    bind(check: (command: Readonly<ICommandInfo>) => void) { validate = check; },
    finish(command: Readonly<ICommandInfo>, fromFormula: boolean) {
      if (fromFormula) { if (!normalized.has(command)) refuse(); }
      else if (pending?.command === command) pending = undefined;
    },
    takeNormalization(command: Readonly<ICommandInfo>) { return normalized.delete(command); },
    dispose() {
      if (!active) return;
      active = false; pending = undefined; validate = undefined; before.dispose();
      if (commands.syncExecuteCommand === sync) commands.syncExecuteCommand = originalSync;
      if (commands.executeCommand === async) commands.executeCommand = originalAsync;
    },
  };
}
