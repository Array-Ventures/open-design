import { ICommandService, type IWorkbookData, type Univer } from '@univerjs/core';
import { WORKBOOK_MODEL_LIMITS } from '@open-design/contracts/runtime/workbook';
import { WORKBOOK_STRUCTURE_AXIS_BUDGET } from '@open-design/contracts/runtime/workbook-structure';

const marker = 'evebotSourceAxis', ownerMarker = 'evebotStructureOwner';
export const STRUCTURE_IDENTITY_LIMIT = WORKBOOK_STRUCTURE_AXIS_BUDGET;
export interface WorkbookAxisMap { rows: (number | null)[]; columns: (number | null)[] }
function axisCount(book: IWorkbookData): number {
  const count = Object.values(book.sheets).reduce((sum, sheet) => sum + (sheet.rowCount ?? NaN) + (sheet.columnCount ?? NaN), 0);
  if (!Number.isSafeInteger(count) || count > STRUCTURE_IDENTITY_LIMIT) throw new Error('Structural dimensions exceed their metadata limit.');
  return count;
}
function owner(book: IWorkbookData): string {
  const value = book.custom?.[ownerMarker] as { generation?: unknown; sourceSha256?: unknown } | undefined;
  if (!value || typeof value.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(value.generation) || typeof value.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceSha256)) throw new Error('Structural baseline identity is unavailable.');
  return value.generation;
}
function identity(value: unknown, generation: string, sheetId: string, axis: string): string {
  const item = value as { owner?: unknown; sheetId?: unknown; axis?: unknown; id?: unknown } | undefined;
  if (!item || item.owner !== generation || item.sheetId !== sheetId || item.axis !== axis || typeof item.id !== 'string' || !/^(?:source:[0-9]{1,7}|new:[a-f0-9-]{36})$/.test(item.id)) throw new Error('Structural source identity changed.');
  return item.id;
}
/** Editor-generation identities survive multiple acknowledged saves. The save
 * plan's actual source checksum owns CAS; the seed checksum identifies this
 * editor generation and never substitutes for that current-source checksum. */
export function seedWorkbookStructureIdentity(input: IWorkbookData, sourceSha256: string): IWorkbookData {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error('Invalid structural source identity.');
  axisCount(input);
  const book = structuredClone(input), generation = crypto.randomUUID();
  if (book.custom?.[ownerMarker] !== undefined) throw new Error('Structural source identity is already installed.');
  book.custom = { ...book.custom, [ownerMarker]: { generation, sourceSha256 } };
  for (const sheet of Object.values(book.sheets)) for (const [axis, field, count, limit] of [
    ['row', 'rowData', sheet.rowCount ?? NaN, WORKBOOK_MODEL_LIMITS.rows],
    ['column', 'columnData', sheet.columnCount ?? NaN, WORKBOOK_MODEL_LIMITS.columns],
  ] as const) {
    if (!Number.isSafeInteger(count) || count < 1 || count > limit) throw new Error('Structural source dimensions exceed their limit.');
    const data = sheet[field] ??= {};
    for (let index = 0; index < count; index++) {
      const dimension = data[index] ??= {};
      if (dimension.custom?.[marker] !== undefined) throw new Error('Structural source identity is already installed.');
      dimension.custom = { ...dimension.custom, [marker]: { owner: generation, sheetId: sheet.id, axis, id: `source:${index}` } };
    }
  }
  return book;
}
/** Assign inserted axes before the SDK records redo parameters. Deletion undo
 * restores existing metadata; redo insertion reuses exactly the same birth IDs.
 * Post-mutation stamping would lose this identity after undo/redo or save. */
export function ownWorkbookAxisIdentity(univer: Univer, snapshot: () => IWorkbookData | undefined, ready: () => boolean) {
  const inserts = new Map([['sheet.mutation.insert-row', 'row'], ['sheet.mutation.insert-col', 'column']]);
  const removes = new Map([['sheet.mutation.remove-rows', 'row'], ['sheet.mutation.remove-col', 'column']]);
  return univer.__getInjector().get(ICommandService).beforeCommandExecuted((command, options) => {
    if (/^sheet\.command\.(?:insert-(?:multi-)?(?:row|col)|remove-(?:row|col))/.test(command.id) && !ready()) throw new Error('The worksheet is not ready for structural changes.');
    const axis = inserts.get(command.id) ?? removes.get(command.id); if (!axis) return;
    const book = snapshot(); if (!book || !ready() || options?.fromFormula) throw new Error('The worksheet is not ready for structural changes.');
    const generation = owner(book), params = command.params as { unitId?: string; subUnitId?: string; range?: { startRow?: number; endRow?: number; startColumn?: number; endColumn?: number }; rowInfo?: Record<number, Record<string, unknown>>; colInfo?: Record<number, Record<string, unknown>> } | undefined;
    const sheet = params?.subUnitId ? book.sheets[params.subUnitId] : undefined;
    if (!params || params.unitId !== book.id || !sheet || !params.range) throw new Error('Structural worksheet identity changed.');
    const start = axis === 'row' ? params.range.startRow : params.range.startColumn, end = axis === 'row' ? params.range.endRow : params.range.endColumn;
    const count = axis === 'row' ? sheet.rowCount ?? NaN : sheet.columnCount ?? NaN;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start! < 0 || end! < start!) throw new Error('Invalid structural range.');
    const amount = end! - start! + 1, inserting = inserts.has(command.id), next = count + (inserting ? amount : -amount);
    if (start! > count || !inserting && end! >= count || next < 1 || axisCount(book) + (inserting ? amount : -amount) > STRUCTURE_IDENTITY_LIMIT || next > (axis === 'row' ? WORKBOOK_MODEL_LIMITS.rows : WORKBOOK_MODEL_LIMITS.columns)) throw new Error('Structural changes exceed their worksheet bounds.');
    if (!inserting) return;
    const field = axis === 'row' ? 'rowInfo' : 'colInfo', info = params[field] ??= {};
    for (let offset = 0; offset < amount; offset++) {
      const value = info[offset] ??= {}, custom = value.custom as Record<string, unknown> | undefined;
      if (custom?.[marker] !== undefined) identity(custom[marker], generation, params.subUnitId!, axis);
      else value.custom = { ...custom, [marker]: { owner: generation, sheetId: sheet.id, axis, id: `new:${crypto.randomUUID()}` } };
    }
  });
}
/** Source ownership is a monotone partial injection relative to the latest
 * acknowledged snapshot, including axes inserted and saved earlier. */
export function gridStructureIdentity(initial: IWorkbookData, current: IWorkbookData, sourceSha256: string): Record<string, WorkbookAxisMap> {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error('Invalid structural source checksum.');
  axisCount(initial); axisCount(current);
  const generation = owner(initial); if (owner(current) !== generation) throw new Error('Structural editor generation changed.');
  if (Object.keys(initial.sheets).sort().join('\0') !== Object.keys(current.sheets).sort().join('\0') || initial.id !== current.id || initial.sheetOrder.join('\0') !== current.sheetOrder.join('\0')) throw new Error('Workbook identity changed.');
  const result: Record<string, WorkbookAxisMap> = {};
  for (const id of initial.sheetOrder) {
    const before = initial.sheets[id], after = current.sheets[id]; if (!before || !after) throw new Error('Worksheet identity changed.');
    const mapping: WorkbookAxisMap = { rows: [], columns: [] }; let changed = false;
    for (const [axis, field, countField, target, limit] of [
      ['row', 'rowData', 'rowCount', 'rows', WORKBOOK_MODEL_LIMITS.rows], ['column', 'columnData', 'columnCount', 'columns', WORKBOOK_MODEL_LIMITS.columns],
    ] as const) {
      const count = after[countField] ?? NaN, originalCount = before[countField] ?? NaN;
      if (![count, originalCount].every(value => Number.isSafeInteger(value) && value >= 1 && value <= limit)) throw new Error('Structural dimensions exceed their limit.');
      const original = new Map<string, number>();
      for (let index = 0; index < originalCount; index++) {
        const key = identity(before[field]?.[index]?.custom?.[marker], generation, id, axis);
        if (original.has(key)) throw new Error('Duplicate structural baseline identity.'); original.set(key, index);
      }
      let previous = -1; const seen = new Set<string>();
      for (let index = 0; index < count; index++) {
        const key = identity(after[field]?.[index]?.custom?.[marker], generation, id, axis), origin = original.get(key) ?? null;
        if (seen.has(key) || origin !== null && origin <= previous) throw new Error('Axis reordering or duplicate identity is unsupported.');
        seen.add(key); if (origin !== null) previous = origin;
        mapping[target].push(origin); changed ||= origin !== index;
      }
      changed ||= count !== originalCount;
    }
    if (changed) result[id] = mapping;
  }
  return result;
}

export function hasWorkbookStructureIdentity(book: IWorkbookData): boolean { try { owner(book); return true; } catch { return false; } }
/** Internal editor ownership is not an authored row/column style change. */
export function stripWorkbookStructureIdentity(input: IWorkbookData): IWorkbookData {
  const book = structuredClone(input);
  if (book.custom) { delete book.custom[ownerMarker]; if (!Object.keys(book.custom).length) delete book.custom; }
  for (const sheet of Object.values(book.sheets)) for (const field of ['rowData', 'columnData'] as const) for (const entry of Object.values(sheet[field] ?? {})) {
    if (entry?.custom) { delete entry.custom[marker]; if (!Object.keys(entry.custom).length) delete entry.custom; }
  }
  return book;
}
