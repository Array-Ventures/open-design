import { expect, it } from 'vitest';
import { IUniverInstanceService } from '@univerjs/core';
import { SetWorksheetNameCommand, SetWorksheetNameMutation, SetRangeValuesMutation } from '@univerjs/sheets';
import { createSourceDeleteHistoryFixture as fixture } from '../helpers/workbook-source-delete-fixture';
import { nativeSheetPayloadIdentity } from '../../src/components/embedded/workbook/native-delete-history';
import { membershipResult } from '../helpers/workbook-membership-result';

it('protects Rename and native Undo/Redo while retaining cross-sheet formula rewrites and unrelated cell data', async () => {
  const f = fixture(true);
  try {
    const survivor = f.book.save().sheets['1'];
    await f.controller!.rename('2', 'Renamed owner');
    expect(f.book.save().sheets['2']!.name).toBe('Renamed owner');
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.f).toContain("'Renamed owner'!A1");
    expect(f.book.save().sheets['1']).toEqual(survivor);
    await f.api.undo();
    expect(f.book.save().sheets['2']!.name).toBe('Sheet 2');
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.f).toBe("='Sheet 2'!A1+'Sheet 1'!A1");
    await f.api.redo();
    expect(f.book.save().sheets['2']!.name).toBe('Renamed owner');
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await f.close(); }
});

it('preserves the original pending scalar save through Rename Undo/Redo and only saves the renamed target after its ACK', async () => {
  const started = gate(), release = gate();
  let f!: ReturnType<typeof fixture>, writes = 0;
  f = fixture(true, { write: async (intent, checkpoint) => {
    writes++;
    intent.renderId ??= crypto.randomUUID();
    await checkpoint();
    if (writes === 1) { started.resolve(); await release.promise; }
    expect(writes).toBeLessThanOrEqual(2);
    return membershipResult(f.writer.checkpoint().source, intent, (writes === 1 ? 'b' : 'c').repeat(64));
  } });
  let saving: Promise<void> | undefined;
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    saving = f.writer.flush();
    await started.promise;
    const pending = structuredClone(f.writer.checkpoint().pending);
    await f.controller!.rename('2', 'Pending renamed');
    await f.api.undo();
    await f.api.redo();
    expect(f.writer.checkpoint().pending).toEqual(pending);
    release.resolve();
    await saving;
    expect(f.writer.state().error).toBeNull();
    expect(writes).toBe(2);
    expect(f.writer.checkpoint().source.model.sheets.find(sheet => sheet.id === '2')!.name).toBe('Pending renamed');
    expect(f.writer.checkpoint().source.model.sheets.find(sheet => sheet.id === '2')!.cells[0]!.value).toBe(19);
    expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(21);
    await f.api.undo();
    expect(f.book.save().sheets['2']!.name).toBe('Sheet 2');
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(19);
  } finally { release.resolve(); await saving; await f.close(); }
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it('matches the unchanged SDK Rename factory sequence and complete native result including quoted-name formula rewrites', async () => {
  const original = fixture(false), owned = fixture(true, { initial: structuredClone(original.initial) });
  try {
    const name = "Owner's worksheet";
    expect(original.commands.syncExecuteCommand(SetWorksheetNameCommand.id, { unitId: original.book.getId(), subUnitId: '2', name })).toBe(true);
    await owned.controller!.rename('2', name);
    const oldCheckpoint = original.history.getUndoRedoCheckpoint(), newCheckpoint = owned.history.getUndoRedoCheckpoint();
    const oldData = original.history.getUndoRedoMutationData(original.book.getId(), 'undo', oldCheckpoint.undoEntryId!);
    const newData = owned.history.getUndoRedoMutationData(owned.book.getId(), 'undo', newCheckpoint.undoEntryId!);
    expect(nativeSheetPayloadIdentity(newData)).toBe(nativeSheetPayloadIdentity(oldData));
    expect(owned.book.save()).toEqual(original.book.save());
    expect(owned.book.save().sheets['3']!.cellData![1]![0]!.f).toContain("'Owner''s worksheet'!A1");
  } finally { await owned.close(); await original.close(); }
});

it.each(['rename', 'undo', 'redo'] as const)('keeps data/history untouched when %s storage fails and retries the same native action', async stage => {
  let denied = false;
  const f = fixture(true, { save: async () => { if (denied) throw Error('Rename storage denied'); } });
  try {
    if (stage !== 'rename') await f.controller!.rename('2', 'Stored rename');
    if (stage === 'redo') await f.api.undo();
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    denied = true;
    const execute = () => stage === 'rename' ? f.controller!.rename('2', 'Stored rename') : stage === 'undo' ? f.api.undo() : f.api.redo();
    await expect(execute()).rejects.toThrow('Rename storage denied');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
    denied = false;
    await execute();
    expect(f.book.save().sheets['2']!.name).toBe(stage === 'undo' ? 'Sheet 2' : 'Stored rename');
  } finally { await f.close(); }
});

it.each(['focus', 'lease'] as const)('refuses %s withdrawal while Rename waits for storage without native entry', async withdrawal => {
  const started = gate(), release = gate();
  let current = true;
  const f = fixture(true, { current: () => current, save: async () => { started.resolve(); await release.promise; } });
  let renaming: Promise<void> | undefined;
  try {
    const before = f.book.save();
    renaming = f.controller!.rename('2', 'Withdrawn rename');
    void renaming.catch(() => {});
    await started.promise;
    if (withdrawal === 'lease') current = false;
    else {
      const other = f.api.createWorkbook({ id: 'rename-other-focus', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Other', rowCount: 10, columnCount: 10 } } });
      f.univer.__getInjector().get(IUniverInstanceService).focusUnit(other.getId());
    }
    release.resolve();
    await expect(renaming).rejects.toThrow(/changed|lease/);
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual({ undos: 0, redos: 0 });
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { release.resolve(); await renaming?.catch(() => {}); await f.close(); }
});

it.each(['before', 'during'] as const)('rejects same-item Rename payload alias changes %s Undo storage and copied native item IDs', async phase => {
  const started = gate(), release = gate();
  let blocking = false;
  const f = fixture(true, { save: async () => { if (blocking) { started.resolve(); await release.promise; } } });
  let undo: Promise<unknown> | undefined;
  try {
    await f.controller!.rename('2', 'Private rename');
    const native = f.history.pitchTopUndoElement()!;
    const alias = native.undoMutations.find(value => value.id === SetWorksheetNameMutation.id)!.params as { name: string };
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    if (phase === 'during') { blocking = true; undo = f.api.undo(); void undo.catch(() => {}); await started.promise; }
    alias.name = 'Forged name';
    if (phase === 'before') { undo = f.api.undo(); void undo.catch(() => {}); }
    release.resolve();
    await expect(undo).rejects.toThrow('Rename payload changed');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
    alias.name = 'Sheet 2';
    f.history.pushUndoRedo({ unitID: f.book.getId(), undoMutations: structuredClone(native.undoMutations), redoMutations: structuredClone(native.redoMutations) });
    const copiedCheckpoint = f.history.getUndoRedoCheckpoint();
    await expect(f.api.undo()).rejects.toThrow('Rename history has no live issuer');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(copiedCheckpoint);
  } finally { release.resolve(); await undo?.catch(() => {}); await f.close(); }
});

it('does not create a native item for a no-op and refuses malformed/colliding names or synchronous owned Rename', async () => {
  let stores = 0;
  const f = fixture(true, { save: async () => { stores++; } });
  try {
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    await f.controller!.rename('2', 'Sheet 2');
    for (const name of ['', 'a'.repeat(32), 'Bad/name', "'bad", 'sHeEt 1']) await expect(f.controller!.rename('2', name)).rejects.toThrow();
    expect(() => f.commands.syncExecuteCommand(SetWorksheetNameCommand.id, { unitId: f.book.getId(), subUnitId: '2', name: 'Sync refused' })).toThrow('asynchronous dispatch');
    await Promise.resolve();
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(stores).toBe(0);
  } finally { await f.close(); }
});

it.each(['async', 'sync'] as const)('preserves ordinary unrelated-workbook %s Rename and native Undo/Redo', async mode => {
  const f = fixture(true);
  try {
    const before = f.book.save();
    const other = f.api.createWorkbook({ id: 'rename-unrelated', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Other original', rowCount: 10, columnCount: 10 } } });
    f.univer.__getInjector().get(IUniverInstanceService).focusUnit(other.getId());
    const params = { unitId: other.getId(), subUnitId: 'x', name: 'Other renamed' };
    expect(mode === 'async' ? await f.commands.executeCommand(SetWorksheetNameCommand.id, params)
      : f.commands.syncExecuteCommand(SetWorksheetNameCommand.id, params)).toBe(true);
    expect(other.save().sheets.x!.name).toBe('Other renamed');
    await f.api.undo();
    expect(other.save().sheets.x!.name).toBe('Other original');
    await f.api.redo();
    expect(other.save().sheets.x!.name).toBe('Other renamed');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual({ undos: 0, redos: 0 });
  } finally { await f.close(); }
});

it('quarantines Rename when its later formula listener attempts foreign worksheet Rename without altering that foreign sheet', async () => {
  const f = fixture(true);
  const other = f.api.createWorkbook({ id: 'rename-foreign', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Foreign retained', rowCount: 10, columnCount: 10 } } });
  f.univer.__getInjector().get(IUniverInstanceService).focusUnit(f.book.getId());
  let armed = true;
  const observer = f.commands.onCommandExecuted(command => {
    if (!armed || command.id !== SetRangeValuesMutation.id) return;
    armed = false;
    f.commands.syncExecuteCommand(SetWorksheetNameMutation.id, { unitId: other.getId(), subUnitId: 'x', name: 'Foreign forged', oldName: 'Foreign retained' });
  });
  try {
    const before = f.writer.checkpoint().desired;
    await expect(f.controller!.rename('2', 'Quarantined rename')).rejects.toThrow('needs recovery');
    expect(other.save().sheets.x!.name).toBe('Foreign retained');
    expect(f.writer.checkpoint().sheetActionConflict).toBe(true);
    expect(f.writer.recoveredSnapshot()).toEqual(before);
  } finally { observer.dispose(); await f.close(); }
});
