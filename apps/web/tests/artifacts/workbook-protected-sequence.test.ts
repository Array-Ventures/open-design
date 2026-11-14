import { expect, it } from 'vitest';
import type { IMutationInfo } from '@univerjs/core';
import { InsertSheetMutation, RemoveSheetMutation, SetRangeValuesMutation, SetWorksheetNameMutation, type ISetRangeValuesMutationParams } from '@univerjs/sheets';
import { createSourceDeleteHistoryFixture as fixture } from '../helpers/workbook-source-delete-fixture';
import { nativeSheetPayloadIdentity } from '../../src/components/embedded/workbook/native-delete-history';

it.each(['birth', 'source-delete', 'rename'] as const)('offers the exact real native %s/Undo/Redo sequence only inside its admitted callback', async kind => {
  const calls: Array<{ expected: readonly IMutationInfo<object>[]; actual: IMutationInfo<object>[]; derived: IMutationInfo<object>[] }> = [];
  let active: typeof calls[number] | undefined;
  const f = fixture(true, { runProtectedSequence: (sequence, prospective, execute) => {
    expect(active).toBeUndefined();
    const call = { expected: structuredClone(sequence), actual: [] as IMutationInfo<object>[], derived: [] as IMutationInfo<object>[] };
    calls.push(call);
    active = call;
    try {
      const result = execute();
      expect(f.book.save()).toEqual(prospective);
      return result;
    } finally { active = undefined; }
  } });
  const observed = new Set([InsertSheetMutation.id, RemoveSheetMutation.id, SetRangeValuesMutation.id, SetWorksheetNameMutation.id]);
  const observer = f.commands.onCommandExecuted((command, options) => {
    if (!active || !observed.has(command.id)) return;
    if (command.params === undefined) throw Error('The actual native fixture mutation has no params.');
    const target = options?.fromFormula ? active.derived : active.actual;
    target.push({ id: command.id, params: structuredClone(command.params) });
  });
  try {
    if (kind === 'birth') await f.controller!.add('Permitted new sheet', 3);
    else if (kind === 'source-delete') await f.controller!.remove('2');
    else await f.controller!.rename('2', 'Permitted rename');
    await f.api.undo();
    await f.api.redo();
    expect(active).toBeUndefined();
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.actual.length).toBeGreaterThan(0);
      expect(nativeSheetPayloadIdentity({ undoMutations: [], redoMutations: call.actual }))
        .toBe(nativeSheetPayloadIdentity({ undoMutations: [], redoMutations: call.expected }));
      expect(call.derived).toHaveLength(kind === 'birth' ? 0 : 1);
      for (const derived of call.derived) {
        expect(derived.id).toBe(SetRangeValuesMutation.id);
        const params = derived.params as ISetRangeValuesMutationParams;
        expect(params.unitId).toBe(f.book.getId());
        if (!params.cellValue) throw Error('The actual derived formula fixture has no cell matrix.');
        for (const columns of Object.values(params.cellValue)) for (const cell of Object.values(columns!)) {
          expect(cell).toMatchObject({ f: expect.any(String), t: null, v: null });
        }
      }
    }
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { observer.dispose(); await f.close(); }
});

it('never offers a calculation permit before denied protection storage', async () => {
  let calls = 0;
  const f = fixture(true, {
    save: async () => { throw Error('Owned permit protection denied'); },
    runProtectedSequence: (_sequence, _prospective, execute) => { calls++; return execute(); },
  });
  try {
    await expect(f.controller!.remove('2')).rejects.toThrow('Owned permit protection denied');
    expect(calls).toBe(0);
    expect(f.book.save().sheets['2']).toBeDefined();
  } finally { await f.close(); }
});
