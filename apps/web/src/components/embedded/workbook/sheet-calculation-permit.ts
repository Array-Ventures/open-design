import type { IMutationInfo, IWorkbookData } from '@univerjs/core';
import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';

export type WorkbookProtectedSheetSequence = (sequence: readonly IMutationInfo<object>[], prospective: IWorkbookData, execute: () => boolean) => boolean;
export const WORKBOOK_MEMBERSHIP_OPTION = 'studioWorkbookMembership';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const workbookMembershipConfigurationSchema = z.object({ version: z.literal(1), unitId: z.string().min(1).max(1024), kernelGeneration: z.string().uuid(), sourceCapability: digest }).strict();
export type WorkbookMembershipConfiguration = z.infer<typeof workbookMembershipConfigurationSchema>;
export const workbookMembershipPermitSchema = workbookMembershipConfigurationSchema.extend({ inputEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), index: z.number().int().nonnegative().max(4095), count: z.number().int().positive().max(4096), commandSha256: digest, beforeInputSha256: digest }).strict().refine(value => value.index < value.count, 'Worksheet calculation sequence index exceeds its count.');
export type WorkbookMembershipPermit = z.infer<typeof workbookMembershipPermitSchema>;
export const membershipMutationIds = new Set(['sheet.mutation.insert-sheet', 'sheet.mutation.remove-sheet', 'sheet.mutation.set-worksheet-name']);
/** The sole pinned routing field is not authored mutation data. Everything else
 * participates in the same bounded private sequence comparison and RPC proof. */
export function workbookSheetCommandSha256(command: { id: string; params?: unknown }): string {
  if (!command.params || typeof command.params !== 'object' || Array.isArray(command.params)) throw Error('Worksheet mutation parameters are unavailable.');
  const { trigger, ...params } = command.params as Record<string, unknown>;
  if (trigger !== undefined && (typeof trigger !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(trigger))) throw Error('Worksheet mutation routing is invalid.');
  return bytesToHex(sha256(new TextEncoder().encode(canonicalWorkbookJsonValue({ id: command.id, params }))));
}
/** Worker-replica capability, not account permission, native issuance or source
 * history authority. It is configured outside source JSON by the owned worker. */
export function workbookMembershipReplica(configuration: WorkbookMembershipConfiguration) {
  let sequence = 0, index = -1, count = 0;
  return { admit(raw: unknown, command: { id: string; params?: unknown }, inputEpoch: number, beforeInputSha256: string) {
    const permit = workbookMembershipPermitSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
    for (const key of ['version', 'unitId', 'kernelGeneration', 'sourceCapability'] as const) if (permit[key] !== configuration[key]) throw Error('Worksheet calculation capability changed.');
    if (permit.inputEpoch !== inputEpoch || permit.beforeInputSha256 !== beforeInputSha256 || permit.commandSha256 !== workbookSheetCommandSha256(command)) throw Error('Worksheet calculation input proof changed.');
    if (permit.sequence > sequence) {
      if (permit.index !== 0 || index + 1 !== count) throw Error('Worksheet calculation sequence is incomplete.');
    } else if (permit.sequence !== sequence || permit.index !== index + 1 || permit.count !== count) throw Error('Worksheet calculation permit was replayed.');
    sequence = permit.sequence; index = permit.index; count = permit.count;
    return permit;
  } };
}

/** Pinned local FormulaDataModel may synchronously normalize the exact authored
 * formula patch and clear its stale cache. This accepts no computed values and
 * is usable only during the owning outer permitted mutation, not by option name. */
export function protectedFormulaInputNormalization(raw: unknown, outer: unknown): boolean {
  const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (!record(raw) || !record(outer) || raw.unitId !== outer.unitId || raw.subUnitId !== outer.subUnitId
    || Object.keys(raw).some(key => !['unitId', 'subUnitId', 'cellValue', 'trigger'].includes(key)) || !record(raw.cellValue) || !record(outer.cellValue)) return false;
  let cells = 0;
  for (const [row, columns] of Object.entries(raw.cellValue)) {
    const originals = outer.cellValue[row];
    if (!record(columns) || !record(originals)) return false;
    for (const [column, cell] of Object.entries(columns)) {
      const original = originals[column];
      if (!record(cell) || !record(original) || !Object.hasOwn(original, 'f') || !Object.hasOwn(cell, 'f') || cell.f !== original.f
        || Object.keys(cell).some(key => !['f', 'si', 'v', 't'].includes(key))
        || Object.hasOwn(cell, 'si') && cell.si !== (original.si ?? null)
        || Object.hasOwn(cell, 'v') && cell.v !== null || Object.hasOwn(cell, 't') && cell.t !== null) return false;
      cells++;
    }
  }
  return cells > 0;
}
