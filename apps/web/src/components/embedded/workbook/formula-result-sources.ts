import type { IWorkbookData } from '@univerjs/core';
import { WORKBOOK_MODEL_LIMITS } from '@open-design/contracts/runtime/workbook';
import type { ISetFormulaCalculationResultMutation } from '@univerjs/engine-formula';

/** Formula identity only; callers still own receipt, graph, epoch and value
 * admission. This cannot turn a source cache or arbitrary packet into a result. */
export function workbookFormulaSourceGuard(book: IWorkbookData, sheetId: string, row: number, column: number): { f: string; si?: string } | null {
  const cell = book.sheets[sheetId]?.cellData?.[row]?.[column];
  if (!cell?.f) return null;
  if (typeof cell.f !== 'string' || cell.f.length > WORKBOOK_MODEL_LIMITS.text
    || cell.si != null && (typeof cell.si !== 'string' || cell.si.length > WORKBOOK_MODEL_LIMITS.text)) throw Error('Calculation formula identity is malformed.');
  return { f: cell.f, ...(cell.si ? { si: cell.si } : {}) };
}

/** Complete guards omitted by the pinned engine, only on returned coordinates
 * with an actual current formula. Invoke only for an independently valid scalar
 * receipt before the SDK captures per-sheet source objects for application. */
export function completeWorkbookScalarSourceGuards(result: ISetFormulaCalculationResultMutation, book: IWorkbookData): void {
  for (const [sheetId, rows] of Object.entries(result.unitData[book.id] ?? {})) {
    for (const [row, columns] of Object.entries(rows)) for (const column of Object.keys(columns)) {
      const expected = workbookFormulaSourceGuard(book, sheetId, Number(row), Number(column));
      if (!expected) continue;
      const source = result.sourceFormulaData ??= {}, unit = source[book.id] ??= {}, sheet = unit[sheetId] ??= {}, guards = sheet[Number(row)] ??= {};
      if (Object.hasOwn(guards, column)) {
        const supplied = guards[Number(column)];
        // Present-but-empty/undefined is not an omitted identity. Never repair
        // a supplied mismatch into a matching identity.
        if (!supplied || supplied.f !== expected.f || supplied.si !== expected.si) throw Error('Calculation source formula identity changed.');
      } else guards[Number(column)] = expected;
    }
  }
}
