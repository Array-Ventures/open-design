import { CommandType, type IMutationInfo, type IWorkbookData } from '@univerjs/core';
import { InsertSheetMutation, RemoveSheetMutation, SetRangeValuesMutation } from '@univerjs/sheets';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { workbookSheetMutationSnapshot } from './sheet-removal-selection';
import type { WorkbookSheetActionDescriptor } from './sheet-action-descriptor';

export type NativeSheetMutation = IMutationInfo<object>;
export interface NativeDeletePayload { undoMutations: NativeSheetMutation[]; redoMutations: NativeSheetMutation[] }
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/** Only the SDK's outer routing trigger is mutable across native Undo/Redo. */
export function nativeDeletePayloadIdentity(payload: { undoMutations: readonly unknown[]; redoMutations: readonly unknown[] }): string {
  return canonicalWorkbookJsonValue(Object.fromEntries((['undoMutations', 'redoMutations'] as const).map(key => [key, payload[key].map(mutation => {
    if (!record(mutation) || typeof mutation.id !== 'string' || Object.keys(mutation).some(name => !['id', 'type', 'params'].includes(name))
      || mutation.type !== undefined && mutation.type !== CommandType.MUTATION || !record(mutation.params)) throw Error('The native Delete payload changed.');
    const { trigger, ...params } = mutation.params;
    if (trigger !== undefined && (typeof trigger !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(trigger))) throw Error('The native Delete routing changed.');
    return { id: mutation.id, ...(mutation.type === undefined ? {} : { type: mutation.type }), params };
  })])));
}

/** Pure pre-entry projection of the supported SDK membership + dependent scalar
 * formula sequence. No mutation, command issuance or historical grant occurs. */
export function projectNativeSheetDelete(before: IWorkbookData, descriptor: WorkbookSheetActionDescriptor,
  mutations: readonly NativeSheetMutation[]) {
  let snapshot = structuredClone(before);
  let transition: { kind: 'insert' | 'remove'; before: IWorkbookData; after: IWorkbookData } | undefined;
  let membership = 0;
  for (const mutation of mutations) {
    if (mutation.type !== undefined && mutation.type !== CommandType.MUTATION || !record(mutation.params)) throw Error('The native Delete mutation is unsupported.');
    const { trigger: _trigger, ...params } = mutation.params;
    if (params.unitId !== before.id) throw Error('The native Delete belongs to another workbook.');
    if (mutation.id === InsertSheetMutation.id) {
      if (++membership !== 1 || Object.keys(params).some(key => !['unitId', 'index', 'sheet'].includes(key))
        || !record(params.sheet) || params.sheet.id !== descriptor.sheetId || snapshot.sheets[descriptor.sheetId]
        || !Number.isSafeInteger(params.index) || Number(params.index) < 0 || Number(params.index) > snapshot.sheetOrder.length) throw Error('The native Delete insertion changed.');
      const immediateBefore = snapshot;
      const next = structuredClone(snapshot);
      next.sheets[descriptor.sheetId] = structuredClone(params.sheet) as IWorkbookData['sheets'][string];
      next.sheetOrder.splice(Number(params.index), 0, descriptor.sheetId);
      snapshot = workbookSheetMutationSnapshot(snapshot, next, 'insert', descriptor);
      transition = { kind: 'insert', before: immediateBefore, after: structuredClone(snapshot) };
    } else if (mutation.id === RemoveSheetMutation.id) {
      if (++membership !== 1 || Object.keys(params).some(key => !['unitId', 'subUnitId', 'subUnitName'].includes(key))
        || params.subUnitId !== descriptor.sheetId || !snapshot.sheets[descriptor.sheetId]
        || params.subUnitName !== snapshot.sheets[descriptor.sheetId]!.name) throw Error('The native Delete removal changed.');
      const immediateBefore = snapshot;
      const next = structuredClone(snapshot);
      delete next.sheets[descriptor.sheetId];
      next.sheetOrder = next.sheetOrder.filter(id => id !== descriptor.sheetId);
      snapshot = workbookSheetMutationSnapshot(snapshot, next, 'remove', descriptor);
      transition = { kind: 'remove', before: immediateBefore, after: structuredClone(snapshot) };
    } else if (mutation.id === SetRangeValuesMutation.id) {
      if (Object.keys(params).some(key => !['unitId', 'subUnitId', 'cellValue'].includes(key))
        || typeof params.subUnitId !== 'string' || !record(params.cellValue)) throw Error('The native Delete formula payload changed.');
      const sheet = snapshot.sheets[params.subUnitId];
      if (!sheet) throw Error('The native Delete formula target is absent.');
      for (const [rowKey, columns] of Object.entries(params.cellValue)) {
        const row = Number(rowKey);
        if (!/^(0|[1-9]\d*)$/.test(rowKey) || !Number.isSafeInteger(row) || row >= sheet.rowCount! || !record(columns)) throw Error('The native Delete formula row changed.');
        for (const [columnKey, patch] of Object.entries(columns)) {
          const column = Number(columnKey);
          if (!/^(0|[1-9]\d*)$/.test(columnKey) || !Number.isSafeInteger(column) || column >= sheet.columnCount!
            || !record(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !['f', 'si'].includes(key))
            || Object.values(patch).some(value => value !== null && typeof value !== 'string')) throw Error('The native Delete formula patch changed.');
          const cell = sheet.cellData?.[row]?.[column];
          if (!cell?.f) throw Error('The native Delete formula target has no scalar formula.');
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) delete cell[key as 'f' | 'si'];
            else cell[key as 'f' | 'si'] = value as string;
          }
          // Pinned FormulaDataModel's formulaDataToCellData clears stale
          // scalar caches for changed formula inputs; never promote the old
          // calculated value into the prospective restored configuration.
          if (cell.f || cell.si) { delete cell.v; delete cell.t; }
        }
      }
    } else throw Error('The native Delete dependency family is unsupported.');
  }
  if (membership !== 1 || !transition) throw Error('The native Delete membership mutation is absent.');
  return { snapshot, transition };
}
