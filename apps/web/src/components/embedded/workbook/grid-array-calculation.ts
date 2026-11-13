import { ICommandService, InterceptorEffectEnum, type ICellData, type IWorkbookData, type Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { INTERCEPTOR_POINT, SetRangeValuesMutation, SheetInterceptorService, type ISetRangeValuesMutationParams } from '@univerjs/sheets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { ownArrayInputNormalization } from './array-input-normalization';
import { ArrayProjectionDisplay } from './array-projection-display';
import { ownArrayProjectionWorker } from './array-projection-owner';
import { assertWorkbookCalculationBudget, assertWorkbookCalculationMutation, WorkbookCalculationBudgetError } from './formula-worker-budget';
import { workbookCalculationChangesInputs } from './formula-input-provenance';
import { workbookCalculationState, type WorkbookCalculationState } from './calculation-state';

/** Validate the actual authored mutation, including simultaneous owner removal.
 * Derived followers are display-only and therefore never appear in this batch. */
export function assertArrayFollowerMutation(display: ArrayProjectionDisplay, params: ISetRangeValuesMutationParams, book: IWorkbookData) {
  const values = params.cellValue;
  const changed = (row: number, column: number, formula: string) => {
    if (values == null) return true;
    const after = values[row]?.[column];
    return after === null || after !== undefined && Object.hasOwn(after, 'f') && after.f !== formula;
  };
  const check = (row: number, column: number, cell: ICellData | null) => {
    if (cell != null && !['v', 't', 'f', 'p'].some(property => Object.hasOwn(cell, property))) return;
    for (const owner of display.followerOwners(params.subUnitId, row, column)) if (!changed(owner.row, owner.column, owner.formula)) throw new WorkbookCalculationBudgetError('Change the array owner before editing its calculated followers.');
  };
  if (values == null) { for (const [row, columns] of Object.entries(book.sheets[params.subUnitId]?.cellData ?? {})) for (const column of Object.keys(columns ?? {})) check(Number(row), Number(column), null); }
  else for (const [row, columns] of Object.entries(values)) for (const [column, cell] of Object.entries(columns ?? {})) check(Number(row), Number(column), cell as ICellData | null);
}

export function attachWorkbookArrayCalculation(univer: Univer, api: FUniver, model: WorkbookDocument, original: IWorkbookData, initial: IWorkbookData, sourceSha256: string,
  snapshot: () => IWorkbookData, owner: ReturnType<typeof ownArrayProjectionWorker> | null, changed: (state: WorkbookCalculationState) => void, render: { ready: Promise<void>; available(): boolean }, input: ReturnType<typeof ownArrayInputNormalization>) {
  const injector = univer.__getInjector(), commands = injector.get(ICommandService), display = new ArrayProjectionDisplay(model, original, initial, sourceSha256);
  let active = true, calculating = false, rendered = false, paintPending = false;
  const publish = () => changed(workbookCalculationState(display.summary()));
  const repaint = () => {
    if (!active) return;
    paintPending = true;
    if (!rendered || !render.available()) return;
    paintPending = false;
    for (const sheet of api.getActiveWorkbook()?.getSheets() ?? []) sheet.refreshCanvas();
  };
  // The pinned facade requires a RenderUnit, which does not exist during
  // workbook creation. Coalesce all early projections into one latest paint.
  void render.ready.then(() => { if (!active) return; rendered = true; if (paintPending) repaint(); }, () => { paintPending = false; });
  const update = (calculate: boolean) => {
    if (!active) return;
    const current = snapshot();
    if (owner && calculate) calculating = true;
    display.update(current, Boolean(owner && calculating));
    if (owner && calculate && owner.calculate(current) === null) { calculating = false; display.pause(); }
    publish(); repaint();
  };
  input.bind(command => {
    if (!active) throw new WorkbookCalculationBudgetError('This workbook is no longer active.');
    const book = snapshot();
    try {
      assertWorkbookCalculationMutation(command, [book], SetRangeValuesMutation.id);
      if (command.id === SetRangeValuesMutation.id) {
        const params = command.params as ISetRangeValuesMutationParams;
        const candidate = structuredClone(book), sheet = candidate.sheets[params.subUnitId]!;
        if (params.cellValue != null) for (const [row, columns] of Object.entries(params.cellValue)) for (const [column, cell] of Object.entries(columns ?? {})) {
          const entries = (sheet.cellData ??= {})[Number(row)] ??= {};
          if (cell === null) delete entries[Number(column)];
          else entries[Number(column)] = { ...entries[Number(column)], ...(cell as ICellData) };
        }
        assertWorkbookCalculationBudget([candidate], true);
      }
    } catch (error) { owner?.fail(); throw error; }
    if (command.id === SetRangeValuesMutation.id && workbookCalculationChangesInputs(command.params)) assertArrayFollowerMutation(display, command.params as ISetRangeValuesMutationParams, book);
  });
  const before = commands.beforeCommandExecuted((command, options) => { input.finish(command, Boolean(options?.fromFormula)); });
  const after = commands.onCommandExecuted((command) => {
    if (input.takeNormalization(command)) return; // The outer authored command publishes the complete input once.
    if (command.id === SetRangeValuesMutation.id) update(workbookCalculationChangesInputs(command.params));
  });
  const result = owner?.onResult(projection => { if (!active) return; calculating = false; display.update(snapshot(), false); if (!display.accept(projection)) { owner.fail(); return; } publish(); repaint(); });
  const intercept = injector.get(SheetInterceptorService).intercept(INTERCEPTOR_POINT.CELL_CONTENT, { priority: 90, effect: InterceptorEffectEnum.Value,
    handler: (cell, location, next) => next(display.display(location.subUnitId, location.row, location.col, (cell ?? {}) as ICellData)),
  });
  update(Boolean(owner));
  return {
    status(sheetId: string, row: number, column: number) { const formula = snapshot().sheets[sheetId]?.cellData?.[row]?.[column]?.f; const result = display.status(sheetId, row, column); return formula && result ? { sheetId, row, column, formula, result, reason: result === 'calculated' ? 'qualified-array-projection' : result === 'stored' ? 'source-cache' : result } : undefined; },
    dispose() { active = false; paintPending = false; input.dispose(); before.dispose(); after.dispose(); result?.(); intercept.dispose(); display.dispose(); },
  };
}
