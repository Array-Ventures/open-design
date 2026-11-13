import type { ICellData, IWorkbookData } from '@univerjs/presets';
import type { BaseFunction, IFunctionNames, ErrorType } from '@univerjs/preset-sheets-core';
import { WorkbookCalculationBudgetError } from './formula-worker-budget';
/** Reviewed scalar/reduction kernels only. This is an execution capability
 * allowlist, not a claim that all functions recognized by Univer are safe. */
export { QUALIFIED_WORKBOOK_FUNCTIONS } from '@open-design/contracts/runtime/workbook-formula-policy';
import { QUALIFIED_WORKBOOK_FUNCTIONS } from '@open-design/contracts/runtime/workbook-formula-policy';
export interface WorkbookExecutionLexer {
  sequenceNodesBuilder(formula: string): readonly (string | { nodeType: number; token: string })[] | undefined;
  deserializeRangeWithSheet(token: string): { unitId: string; sheetName: string; range: { startRow: number; endRow: number; startColumn: number; endColumn: number; rangeType?: number } };
  sequenceNodeType: { REFERENCE: number; ARRAY: number };
  rangeType: { ROW: number; COLUMN: number };
}
/** Use pinned tokens and reference geometry, never a parallel formula parser.
 * The conservative cost bounds intermediate broadcasts/repeated reductions.
 * Array literals and concatenation await their own allocation qualification. */
export function assertWorkbookFormulaExecution(books: readonly IWorkbookData[], runtime: WorkbookExecutionLexer): void {
  let count = 0, work = 0;
  for (const book of books) {
    const names = new Map(Object.entries(book.sheets).map(([id, sheet]) => [sheet.name?.toLowerCase(), id]));
    for (const [sheetId, sheet] of Object.entries(book.sheets)) for (const entries of Object.values(sheet.cellData ?? {})) for (const cell of Object.values(entries ?? {}) as (ICellData | null | undefined)[]) {
      if (!cell?.f) continue;
      if (++count > 10_000 || cell.f.length > 16_384) throw new WorkbookCalculationBudgetError('This formula needs a larger isolated calculation budget. Stored results are preserved.');
      const tokens = runtime.sequenceNodesBuilder(cell.f);
      if (!tokens || tokens.length > 512) throw new WorkbookCalculationBudgetError('This formula needs a separate calculation adapter.');
      let rows = 1, columns = 1;
      for (const token of tokens) {
        if (typeof token === 'string') {
          if (token === '#') throw new WorkbookCalculationBudgetError('Live spill references need a separate calculation adapter. Stored results are preserved.');
          if (token === '&') throw new WorkbookCalculationBudgetError('Live text concatenation needs a bounded text adapter.');
          continue;
        }
        if (token.nodeType === runtime.sequenceNodeType.ARRAY) throw new WorkbookCalculationBudgetError('Live array literals need a separate allocation adapter.');
        if (token.nodeType !== runtime.sequenceNodeType.REFERENCE) continue;
        const ref = runtime.deserializeRangeWithSheet(token.token);
        if (ref.unitId && ref.unitId !== book.id) continue; // default loader is a qualified no-op; policy keeps this result stored/unavailable
        const target = book.sheets[ref.sheetName ? names.get(ref.sheetName.toLowerCase()) ?? '' : sheetId];
        if (!target) continue; // a missing worksheet produces a genuine reference error, never an allocation
        const range = ref.range, height = target.rowCount ?? 0, width = target.columnCount ?? 0;
        const startRow = range.rangeType === runtime.rangeType.COLUMN ? 0 : range.startRow;
        const endRow = range.rangeType === runtime.rangeType.COLUMN ? height - 1 : range.endRow;
        const startColumn = range.rangeType === runtime.rangeType.ROW ? 0 : range.startColumn;
        const endColumn = range.rangeType === runtime.rangeType.ROW ? width - 1 : range.endColumn;
        if (![startRow, endRow, startColumn, endColumn].every(Number.isSafeInteger) || startRow < 0 || startColumn < 0 || endRow < startRow || endColumn < startColumn || endRow >= height || endColumn >= width) throw new WorkbookCalculationBudgetError('A formula reference exceeds the registered calculation bounds.');
        rows = Math.max(rows, endRow - startRow + 1); columns = Math.max(columns, endColumn - startColumn + 1);
      }
      work += rows * columns * Math.max(1, tokens.length);
      if (!Number.isSafeInteger(work) || work > 1_000_000) throw new WorkbookCalculationBudgetError('This formula range needs a larger isolated calculation budget.');
    }
  }
}
/** Unqualified functions remain recognizable for editing, but never execute
 * their allocation/network-capable kernels. No source f/ref/value is rewritten.
 * The display policy must classify these names as unavailable/stored, not live. */
export function qualifiedWorkbookFunctionOverrides(runtime: { ALL_IMPLEMENTED_FUNCTIONS: readonly [new (name: IFunctionNames) => BaseFunction, IFunctionNames][]; BaseFunction: typeof BaseFunction; ErrorType: { NA: ErrorType }; ErrorValueObject: { create(value: ErrorType): ReturnType<BaseFunction['calculate']> } }): [new (name: IFunctionNames) => BaseFunction, IFunctionNames][] {
  class Unavailable extends runtime.BaseFunction {
    minParams = 0;
    maxParams = 255;
    calculate() { return runtime.ErrorValueObject.create(runtime.ErrorType.NA); }
  }
  return runtime.ALL_IMPLEMENTED_FUNCTIONS.filter(([, name]) => !QUALIFIED_WORKBOOK_FUNCTIONS.has(String(name).toUpperCase())).map(([, name]) => [Unavailable, name]);
}
