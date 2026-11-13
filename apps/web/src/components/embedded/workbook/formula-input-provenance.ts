import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { ICellData, IWorkbookData } from '@univerjs/presets';
import { z } from 'zod';
export const WORKBOOK_INPUT_EPOCH_OPTION = 'studioWorkbookInputEpoch';
export const workbookCalculationTagSchema = z.object({ version: z.literal(1), unitId: z.string(), inputSha256: z.string().regex(/^[a-f0-9]{64}$/), generation: z.number().int().nonnegative(), inputEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), valid: z.boolean() }).strict();
export type WorkbookCalculationTag = z.infer<typeof workbookCalculationTagSchema>;
/** Only authored calculation inputs participate. Formula result caches and
 * display-only styles cannot promote a calculated snapshot into source cache
 * authority or invalidate an otherwise matching deterministic calculation. */
export function workbookCalculationInputSha256(book: IWorkbookData): string {
  const sheets = Object.entries(book.sheets).sort(([a], [b]) => a.localeCompare(b)).map(([id, sheet]) => {
    const cells: unknown[] = [];
    for (const [row, entries] of Object.entries(sheet.cellData ?? {}).sort(([a], [b]) => Number(a) - Number(b))) for (const [column, raw] of Object.entries(entries ?? {}).sort(([a], [b]) => Number(a) - Number(b))) {
      const cell = raw as ICellData | null | undefined;
      if (!cell) continue;
      if (cell.f) cells.push([Number(row), Number(column), 'formula', cell.f]);
      else if (cell.v !== null && cell.v !== undefined || cell.p) cells.push([Number(row), Number(column), 'literal', typeof cell.v === 'number' ? ['number', String(cell.v), Object.is(cell.v, -0)] : cell.v ?? null, cell.t ?? null, cell.p ?? null]);
    }
    return [id, sheet.name, sheet.rowCount, sheet.columnCount, cells];
  });
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([book.id, book.dateSystem ?? 0, book.sheetOrder, sheets]))));
}
export function workbookCalculationChangesInputs(params: unknown): boolean {
  const matrix = (params as { cellValue?: Record<string, Record<string, ICellData | null>> } | undefined)?.cellValue;
  if (!matrix) return true; // a whole-range clear is a genuine input mutation
  return Object.values(matrix).some(row => Object.values(row ?? {}).some(cell => cell == null || typeof cell !== 'object' || ['v', 't', 'f', 'p'].some(key => Object.hasOwn(cell, key))));
}
/** Pinned execution stage1 occurs inside its execution lock immediately before
 * inputs load. Mark any intervening authored mutation as invalid, even if an
 * input changes away and back to the same value before the result arrives. */
export function workbookWorkerInputProvenance() {
  let revision = 0, generation = 0, inputEpoch = 0;
  let active: { revision: number; inputEpoch: number; inputs: Map<string, string>; generation: number } | null = null;
  return {
    changed(epoch: number) {
      if (!Number.isSafeInteger(epoch) || epoch <= inputEpoch) throw Error('Workbook input epoch is stale or invalid.');
      revision++; inputEpoch = epoch;
    },
    epoch() { return inputEpoch; },
    started(books: readonly IWorkbookData[]) { active = { revision, inputEpoch, generation: ++generation, inputs: new Map(books.map(book => [book.id, workbookCalculationInputSha256(book)])) }; },
    tag(book: IWorkbookData): WorkbookCalculationTag {
      const inputSha256 = active?.inputs.get(book.id) ?? workbookCalculationInputSha256(book);
      return { version: 1, unitId: book.id, inputSha256, generation: active?.generation ?? 0, inputEpoch: active?.inputEpoch ?? inputEpoch, valid: Boolean(active && active.revision === revision && inputSha256 === workbookCalculationInputSha256(book)) };
    },
  };
}
