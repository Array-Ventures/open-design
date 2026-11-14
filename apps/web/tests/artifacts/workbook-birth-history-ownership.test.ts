import { expect, it } from 'vitest';
import { InsertSheetCommand, InsertSheetMutation, RemoveSheetMutation, SetRangeValuesMutation } from '@univerjs/sheets';
import { createWorkbookHistoryControllerFixture as fixture } from '../helpers/workbook-history-controller-fixture';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it('does not adopt a copied native Add item pushed by a public command listener as its live birth issuer', async () => {
  const f = fixture();
  const before = f.book.save();
  const observer = f.commands.onCommandExecuted(command => {
    if (command.id !== InsertSheetCommand.id) return;
    const native = f.history.pitchTopUndoElement()!;
    f.history.pushUndoRedo({
      unitID: f.book.getId(),
      undoMutations: structuredClone(native.undoMutations),
      redoMutations: structuredClone(native.redoMutations),
    });
  });
  try {
    await expect(f.add()).rejects.toThrow('needs recovery');
    expect(f.writer.checkpoint().sheetActionConflict).toBe(true);
    expect(f.writer.recoveredSnapshot()).toEqual(before);
  } finally {
    observer.dispose();
    await f.close();
  }
});

it('refuses history-only changes while Add protection awaits storage before native entry without quarantine', async () => {
  const started = gate();
  const release = gate();
  const f = fixture({
    save: async state => {
      if (state?.sheetBirths?.entries.length) {
        started.resolve();
        await release.promise;
      }
    },
  });
  let adding: Promise<unknown> | undefined;
  try {
    const before = f.book.save();
    adding = f.add();
    void adding.catch(() => {});
    await started.promise;
    f.history.pushUndoRedo({ unitID: f.book.getId(),
      undoMutations: [{ id: SetRangeValuesMutation.id, params: { unitId: f.book.getId(), subUnitId: '1', cellValue: { 0: { 0: { v: 12 } } } } }],
      redoMutations: [{ id: SetRangeValuesMutation.id, params: { unitId: f.book.getId(), subUnitId: '1', cellValue: { 0: { 0: { v: 99 } } } } }],
    });
    const history = f.history.getUndoRedoCheckpoint();
    release.resolve();
    await expect(adding).rejects.toThrow('history changed');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally {
    release.resolve();
    await adding?.catch(() => {});
    await f.close();
  }
});

it.each(['undo', 'redo'] as const)('quarantines a native birth %s callback that changes history beyond its exact one-entry transfer', async direction => {
  const f = fixture();
  let armed = false;
  const observer = f.commands.onCommandExecuted(command => {
    if (!armed || command.id !== (direction === 'undo' ? RemoveSheetMutation.id : InsertSheetMutation.id)) return;
    armed = false;
    f.history.pushUndoRedo({ unitID: f.book.getId(),
      undoMutations: [{ id: SetRangeValuesMutation.id, params: { unitId: f.book.getId(), subUnitId: '1', cellValue: { 0: { 0: { v: 12 } } } } }],
      redoMutations: [{ id: SetRangeValuesMutation.id, params: { unitId: f.book.getId(), subUnitId: '1', cellValue: { 0: { 0: { v: 99 } } } } }],
    });
  });
  try {
    await f.add();
    if (direction === 'redo') await f.api.undo();
    const before = f.writer.checkpoint().desired;
    armed = true;
    await expect(direction === 'undo' ? f.api.undo() : f.api.redo()).rejects.toThrow('needs recovery');
    expect(f.writer.checkpoint().sheetActionConflict).toBe(true);
    expect(f.writer.recoveredSnapshot()).toEqual(before);
  } finally {
    observer.dispose();
    await f.close();
  }
});
