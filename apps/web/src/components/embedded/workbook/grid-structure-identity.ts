import type { IWorkbookData } from '@univerjs/core';
import { WORKBOOK_MODEL_LIMITS } from '@open-design/contracts/runtime/workbook';
import { WORKBOOK_STRUCTURE_AXIS_BUDGET } from '@open-design/contracts/runtime/workbook-structure';

const marker = 'evebotSourceAxis';
/** Bound editor metadata independently of the XLSX coordinate limit. */
export const STRUCTURE_IDENTITY_LIMIT = WORKBOOK_STRUCTURE_AXIS_BUDGET;
export interface WorkbookAxisMap { rows: (number | null)[]; columns: (number | null)[] }
/** Source ownership is editor-only metadata. Real SDK insertion leaves new axes
 * unowned; deletion undo restores the retained row/column data with its identity.
 * This never serializes the grid into the source workbook. */
export function seedWorkbookStructureIdentity(input: IWorkbookData, sourceSha256: string): IWorkbookData {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error('Invalid structural source identity.');
  const axes = Object.values(input.sheets).reduce((sum, sheet) => sum + (sheet.rowCount ?? NaN) + (sheet.columnCount ?? NaN), 0);
  if (!Number.isSafeInteger(axes) || axes > STRUCTURE_IDENTITY_LIMIT) throw new Error('Structural source dimensions exceed their metadata limit.');
  const book = structuredClone(input);
  for (const sheet of Object.values(book.sheets)) for (const [axis, field, count, limit] of [
    ['row', 'rowData', sheet.rowCount ?? NaN, WORKBOOK_MODEL_LIMITS.rows],
    ['column', 'columnData', sheet.columnCount ?? NaN, WORKBOOK_MODEL_LIMITS.columns],
  ] as const) {
    if (!Number.isSafeInteger(count) || count < 1 || count > limit) throw new Error('Structural source dimensions exceed their limit.');
    const data = sheet[field] ??= {};
    for (let index = 0; index < count; index++) {
      const dimension = data[index] ??= {};
      if (dimension.custom?.[marker] !== undefined) throw new Error('Structural source identity is already installed.');
      dimension.custom = { ...dimension.custom, [marker]: { sourceSha256, sheetId: sheet.id, axis, index } };
    }
  }
  return book;
}
/** A monotone partial injection describes insertion/deletion only. Reordering,
 * duplicate ownership, foreign-source metadata and missing baseline identities
 * must never be interpreted as a structural edit. */
export function gridStructureIdentity(initial: IWorkbookData, current: IWorkbookData, sourceSha256: string): Record<string, WorkbookAxisMap> {
  if (Object.keys(initial.sheets).sort().join('\0') !== Object.keys(current.sheets).sort().join('\0')) throw new Error('Worksheet identity changed.');
  if (initial.id !== current.id || initial.sheetOrder.join('\0') !== current.sheetOrder.join('\0')) throw new Error('Workbook identity changed.');
  const baselineAxes = Object.values(initial.sheets).reduce((sum, sheet) => sum + (sheet.rowCount ?? NaN) + (sheet.columnCount ?? NaN), 0);
  if (!Number.isSafeInteger(baselineAxes) || baselineAxes > STRUCTURE_IDENTITY_LIMIT) throw new Error('Structural baseline exceeds its metadata limit.');
  const axes = Object.values(current.sheets).reduce((sum, sheet) => sum + (sheet.rowCount ?? NaN) + (sheet.columnCount ?? NaN), 0);
  if (!Number.isSafeInteger(axes) || axes > STRUCTURE_IDENTITY_LIMIT) throw new Error('Structural dimensions exceed their metadata limit.');
  const result: Record<string, WorkbookAxisMap> = {};
  for (const id of initial.sheetOrder) {
    const before = initial.sheets[id], after = current.sheets[id];
    if (!before || !after) throw new Error('Worksheet identity changed.');
    const mapping: WorkbookAxisMap = { rows: [], columns: [] };
    let changed = false;
    for (const [axis, field, countField, target, limit] of [
      ['row', 'rowData', 'rowCount', 'rows', WORKBOOK_MODEL_LIMITS.rows],
      ['column', 'columnData', 'columnCount', 'columns', WORKBOOK_MODEL_LIMITS.columns],
    ] as const) {
      const count = after[countField] ?? NaN, originalCount = before[countField] ?? NaN;
      if (!Number.isSafeInteger(originalCount) || originalCount < 1 || originalCount > limit) throw new Error('Structural baseline dimensions exceed their limit.');
      if (!Number.isSafeInteger(count) || count < 1 || count > limit) throw new Error('Structural dimensions exceed their limit.');
      function sourceIndex(value: unknown): number | null {
        if (value === undefined) return null;
        const identity = value as { sourceSha256?: unknown; sheetId?: unknown; axis?: unknown; index?: unknown };
        if (!identity || identity.sourceSha256 !== sourceSha256 || identity.sheetId !== id || identity.axis !== axis || !Number.isSafeInteger(identity.index) || (identity.index as number) < 0 || (identity.index as number) >= originalCount) throw new Error('Structural source identity changed.');
        return identity.index as number;
      }
      for (let index = 0; index < originalCount; index++) if (sourceIndex(before[field]?.[index]?.custom?.[marker]) !== index) throw new Error('Structural baseline identity is unavailable.');
      let previous = -1;
      for (let index = 0; index < count; index++) {
        const origin = sourceIndex(after[field]?.[index]?.custom?.[marker]);
        if (origin !== null && origin <= previous) throw new Error('Axis reordering or duplicate identity is unsupported.');
        if (origin !== null) previous = origin;
        mapping[target].push(origin);
        changed ||= origin !== index;
      }
      changed ||= count !== originalCount;
    }
    if (changed) result[id] = mapping;
  }
  return result;
}
