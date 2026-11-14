import { expect, it } from 'vitest';
import { createWorkbookHistoryControllerFixture } from '../helpers/workbook-history-controller-fixture';
import type { WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(save: (value: WorkbookCheckpoint | null) => Promise<void>) {
  return createWorkbookHistoryControllerFixture({ save });
}
it('protects real native birth Undo before pop, refuses denied storage unchanged, then retries and redoes the original blank', async () => {
  const blocked = gate(), release = gate();
  let block = false, denied = true;
  const h = fixture(async value => {
    if (block && value?.sheetBirths?.removals?.length && value.desired.sheets['2']) {
      blocked.resolve(); await release.promise;
      if (denied) throw Error('Protection storage refused');
    }
  });
  let execution: Promise<unknown> | undefined;
  try {
    await h.add();
    const before = h.book.save(), history = h.history.getUndoRedoStatus(h.book.getId());
    block = true;
    execution = h.api.undo(); void execution.catch(() => {});
    await Promise.race([blocked.promise, execution]);
    expect(h.book.save()).toEqual(before);
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual(history);
    release.resolve();
    await expect(execution).rejects.toThrow('Protection storage refused');
    expect(h.book.save()).toEqual(before);
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual(history);
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    denied = false;
    await h.api.undo();
    expect(h.book.save().sheets['2']).toBeUndefined();
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual({ undos: 0, redos: 1 });
    expect(h.writer.checkpoint().sheetBirths?.removals).toHaveLength(1);
    await h.api.redo();
    expect(h.book.save().sheets['2']!.cellData?.[0]?.[0]?.v).toBeUndefined();
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual({ undos: 1, redos: 0 });
    expect(h.writes).toBe(0);
  } finally {
    release.resolve(); await execution?.catch(() => {}); await h.close();
  }
});

it('keeps the exact pending creation while real Undo/Redo runs, then uses current-source protection after ACK', async () => {
  const started = gate(), release = gate();
  const { blankWorkbookSheet } = await import('../../src/components/embedded/workbook/sheet-birth-context');
  const { standInWorkbookResult } = await import('../helpers/workbook-birth-transport');
  const { birthScope } = await import('../helpers/workbook-birth-fixture');
  const h = createWorkbookHistoryControllerFixture({
    write: async (intent, checkpoint, initial) => {
      intent.renderId ??= crypto.randomUUID(); await checkpoint();
      started.resolve(); await release.promise;
      const target = structuredClone(initial); target.sourceSha256 = 'b'.repeat(64);
      target.model.sheets.push(blankWorkbookSheet('2','Second'));
      return standInWorkbookResult(birthScope, intent, target, 'before-birth', 'after-birth');
    },
  });
  let saving: Promise<void> | undefined;
  try {
    const birth = await h.add();
    saving = h.writer.flush(); await started.promise;
    const pending = structuredClone(h.writer.checkpoint().pending);
    await h.api.undo();
    expect(h.book.save().sheets['2']).toBeUndefined();
    expect(h.writer.checkpoint().pending).toEqual(pending);
    expect(h.writer.checkpoint().sheetBirths?.removals?.[0]?.kind).toBe('pending-target');
    await h.api.redo();
    expect(h.book.save().sheets['2']!.cellData?.[0]?.[0]?.v).toBeUndefined();
    expect(h.writer.checkpoint().pending).toEqual(pending);
    release.resolve(); await saving;
    expect(h.writer.checkpoint().source.sourceSha256).toBe('b'.repeat(64));
    expect(h.writer.state().error).toBeNull();
    expect(h.writes).toBe(1);
    await h.api.undo();
    expect(h.book.save().sheets['2']).toBeUndefined();
    expect(h.writer.checkpoint().sheetDeletions).toHaveLength(2);
    expect(h.writer.checkpoint().sheetDeletions?.at(-1)?.sourceSha256).toBe('b'.repeat(64));
    await h.api.redo();
    expect(h.book.save().sheets['2']!.cellData?.[0]?.[0]?.v).toBeUndefined();
    expect(h.writer.checkpoint().sheetBirths?.entries[0]?.descriptor).toEqual(birth.descriptor);
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual({ undos: 1, redos: 0 });
    expect(h.writes).toBe(1);
  } finally { release.resolve(); await saving; await h.close(); }
});

it.each(['focus','registration','controller'] as const)('refuses %s withdrawal during storage before pop without quarantining untouched data', async withdrawal => {
  const blocked = gate(), release = gate();
  let block = false;
  const h = fixture(async value => {
    if (block && value?.sheetBirths?.removals?.length) { blocked.resolve(); await release.promise; }
  });
  let execution: Promise<unknown> | undefined;
  try {
    await h.add(); block = true;
    const before = h.book.save(), status = h.history.getUndoRedoStatus(h.book.getId());
    execution = h.api.undo(); void execution.catch(() => {});
    await blocked.promise;
    if (withdrawal === 'focus') {
      const { IUniverInstanceService } = await import('@univerjs/core');
      const other = h.api.createWorkbook({ id: 'other-history-focus', sheetOrder: ['1'], sheets: { '1': { id:'1', name:'Other', rowCount:100,columnCount:26 } } });
      h.univer.__getInjector().get(IUniverInstanceService).focusUnit(other.getId());
    } else if (withdrawal === 'registration') {
      const { UndoCommand } = await import('@univerjs/core');
      h.commands.unregisterCommand(UndoCommand.id);
      h.commands.registerCommand({ id: UndoCommand.id, type: UndoCommand.type, handler: () => false });
    } else h.controller.dispose();
    release.resolve();
    await expect(execution).rejects.toThrow('history changed');
    expect(h.book.save()).toEqual(before);
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual(status);
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    expect(h.writes).toBe(0);
  } finally { release.resolve(); await execution?.catch(() => {}); await h.close(); }
});

it('refuses a different native entry carrying a real issued birth token before it can insert forged data', async () => {
  const h = fixture(async () => {});
  try {
    const birth = await h.add(); await h.api.undo();
    const { InsertSheetMutation, RemoveSheetMutation } = await import('@univerjs/sheets');
    const forged = structuredClone(birth.initialSheet);
    forged.cellData = { 0: { 0: { v: 999, t: 2 } } };
    h.history.pushUndoRedo({ unitID: h.book.getId(),
      undoMutations: [{ id: RemoveSheetMutation.id, params: { unitId: h.book.getId(), subUnitId: '2' } }],
      redoMutations: [{ id: InsertSheetMutation.id, params: { unitId: h.book.getId(), index: 1, sheet: forged } }],
    });
    h.history.popUndoToRedo();
    const before = h.book.save(), status = h.history.getUndoRedoStatus(h.book.getId());
    const failure = await h.api.redo().catch(error => error);
    expect.soft(h.book.save()).toEqual(before);
    expect.soft(h.history.getUndoRedoStatus(h.book.getId())).toEqual(status);
    expect.soft(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('native entry');
    expect(h.writes).toBe(0);
  } finally { await h.close(); }
});

it('rejects edit→Undo ABA while storage waits even when source values and native top return', async () => {
  const blocked = gate(), release = gate();
  let block = false;
  const h = fixture(async value => {
    if (block && value?.sheetBirths?.removals?.length) { blocked.resolve(); await release.promise; }
  });
  let execution: Promise<unknown> | undefined;
  try {
    await h.add(); block = true;
    const before = h.book.save(), status = h.history.getUndoRedoStatus(h.book.getId());
    execution = h.api.undo(); void execution.catch(() => {}); await blocked.promise;
    h.book.getSheetBySheetId('1')!.getRange('A1').setValue(99);
    await h.api.undo();
    expect(h.book.save()).toEqual(before);
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual({ undos: status.undos, redos: 1 });
    release.resolve();
    await expect(execution).rejects.toThrow('workbook changed');
    expect(h.book.save()).toEqual(before);
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    expect(h.writer.checkpoint().sheetBirths?.removals).toBeUndefined();
  } finally { release.resolve(); await execution?.catch(() => {}); await h.close(); }
});

it('never schedules protected synchronous membership Undo', async () => {
  const h = fixture(async () => {});
  try {
    const { UndoCommand } = await import('@univerjs/core');
    await h.add();
    const before = h.book.save(), status = h.history.getUndoRedoStatus(h.book.getId()), records = h.records.length;
    expect(() => h.commands.syncExecuteCommand(UndoCommand.id)).toThrow('asynchronous dispatch');
    await Promise.resolve();
    expect(h.book.save()).toEqual(before);
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual(status);
    expect(h.records).toHaveLength(records);
    expect(h.writer.checkpoint().sheetBirths?.removals).toBeUndefined();
  } finally { await h.close(); }
});

it('refuses unknown and compound membership rather than delegating unprotected history', async () => {
  const h = fixture(async () => {});
  try {
    const { InsertSheetMutation, RemoveSheetMutation } = await import('@univerjs/sheets');
    await h.add();
    for (const ids of [['3'],['2','3']]) {
      h.history.pushUndoRedo({ unitID: h.book.getId(),
        undoMutations: ids.map(id => ({ id: RemoveSheetMutation.id, params: { unitId: h.book.getId(), subUnitId: id } })),
        redoMutations: ids.map(id => ({ id: InsertSheetMutation.id, params: { unitId: h.book.getId(), index: 1, sheet: { id, name:'Unknown',rowCount:100,columnCount:26 } } })),
      });
      const before = h.book.save(), status = h.history.getUndoRedoStatus(h.book.getId());
      await expect(h.api.undo()).rejects.toThrow(ids.length === 1 ? 'live birth issuer' : 'Compound');
      expect(h.book.save()).toEqual(before);
      expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual(status);
      expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    }
  } finally { await h.close(); }
});

it.each(['undo','redo'] as const)('refuses in-place native payload changes before %s, using only public command params', async direction => {
  const h = fixture(async () => {});
  const { InsertSheetMutation } = await import('@univerjs/sheets');
  let retained: { sheet: import('@univerjs/core').IWorksheetData } | undefined;
  const listener = h.commands.onCommandExecuted(command => {
    if (!retained && command.id === InsertSheetMutation.id) retained = command.params as typeof retained;
  });
  try {
    await h.add();
    const issued = h.history.getUndoRedoCheckpoint().undoEntryId;
    expect(retained).toBeDefined();
    expect(h.book.save().sheets['2']!.cellData?.[0]?.[0]?.v).toBeUndefined();
    if (direction === 'redo') await h.api.undo();
    retained!.sheet.cellData = { 0: { 0: { v: 999, t: 2 } } };
    expect(h.history.getUndoRedoCheckpoint()[direction === 'undo' ? 'undoEntryId' : 'redoEntryId']).toBe(issued);
    const before = h.book.save(), status = h.history.getUndoRedoStatus(h.book.getId());
    const failure = await (direction === 'undo' ? h.api.undo() : h.api.redo()).catch(error => error);
    expect.soft(h.book.save()).toEqual(before);
    expect.soft(h.history.getUndoRedoStatus(h.book.getId())).toEqual(status);
    expect.soft(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('native payload');
    expect(h.writes).toBe(0);
  } finally { listener.dispose(); await h.close(); }
});

it('refuses a withdrawn native Add command registration before reserving or invoking a birth', async () => {
  const h = fixture(async () => {});
  try {
    const { InsertSheetCommand } = await import('@univerjs/sheets');
    let calls = 0;
    h.commands.unregisterCommand(InsertSheetCommand.id);
    const unknown = {
      id: InsertSheetCommand.id, type: InsertSheetCommand.type,
      handler: () => { calls++; return false; },
    };
    h.commands.registerCommand(unknown);
    const before = h.book.save(), records = h.records.length;
    await expect(h.add()).rejects.toThrow('owner is not current');
    expect(calls).toBe(0);
    expect(h.book.save()).toEqual(before);
    expect(h.records).toHaveLength(records);
    expect(h.writer.checkpoint().sheetBirths).toBeUndefined();
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    h.controller.dispose();
    expect(h.commands.syncExecuteCommand(InsertSheetCommand.id)).toBe(false);
    expect(calls).toBe(1);
  } finally { await h.close(); }
});

it('rechecks same-item public payload integrity after awaited storage before entering native history', async () => {
  const blocked = gate(), release = gate();
  let block = false;
  const h = fixture(async value => {
    if (block && value?.sheetBirths?.removals?.length) {
      blocked.resolve(); await release.promise;
    }
  });
  const { InsertSheetMutation } = await import('@univerjs/sheets');
  let retained: { sheet: import('@univerjs/core').IWorksheetData } | undefined;
  const listener = h.commands.onCommandExecuted(command => {
    if (!retained && command.id === InsertSheetMutation.id) retained = command.params as typeof retained;
  });
  let execution: Promise<unknown> | undefined;
  try {
    await h.add(); block = true;
    const before = h.book.save(), status = h.history.getUndoRedoStatus(h.book.getId());
    const id = h.history.getUndoRedoCheckpoint().undoEntryId;
    execution = h.api.undo(); void execution.catch(() => {});
    await blocked.promise;
    retained!.sheet.cellData = { 0: { 0: { v: 999, t: 2 } } };
    expect(h.history.getUndoRedoCheckpoint().undoEntryId).toBe(id);
    release.resolve();
    await expect(execution).rejects.toThrow('native payload');
    expect(h.book.save()).toEqual(before);
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual(status);
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    expect(h.writer.checkpoint().sheetBirths?.removals).toBeUndefined();
    expect(h.writes).toBe(0);
  } finally {
    release.resolve(); await execution?.catch(() => {});
    listener.dispose(); await h.close();
  }
});

it('keeps native Add Redo through a pending deletion ACK and re-creates only its original blank', async () => {
  const deleting = gate(), release = gate();
  const { blankWorkbookSheet } = await import('../../src/components/embedded/workbook/sheet-birth-context');
  const { standInWorkbookResult } = await import('../helpers/workbook-birth-transport');
  const { birthScope } = await import('../helpers/workbook-birth-fixture');
  let calls = 0;
  const h = createWorkbookHistoryControllerFixture({ write: async (intent, checkpoint, initial) => {
    calls++; intent.renderId ??= crypto.randomUUID(); await checkpoint();
    const target = structuredClone(initial);
    if (calls === 2) {
      deleting.resolve(); await release.promise;
      target.sourceSha256 = 'c'.repeat(64);
    } else {
      target.sourceSha256 = (calls === 1 ? 'b' : 'd').repeat(64);
      target.model.sheets.push(blankWorkbookSheet('2','Second'));
    }
    return standInWorkbookResult(birthScope, intent, target,
      calls === 1 ? 'before-birth' : calls === 2 ? 'after-birth' : 'after-delete',
      calls === 1 ? 'after-birth' : calls === 2 ? 'after-delete' : 'after-recreate');
  } });
  let saving: Promise<void> | undefined;
  try {
    const birth = await h.add(); await h.writer.flush();
    expect(h.writer.checkpoint().source.sourceSha256).toBe('b'.repeat(64));
    await h.api.undo();
    saving = h.writer.flush(); await deleting.promise;
    const pending = structuredClone(h.writer.checkpoint().pending);
    expect(pending?.intent.plan.sheets?.map(sheet => sheet.sheetId)).toEqual(['1']);
    await h.api.redo();
    expect(h.book.save().sheets['2']!.cellData?.[0]?.[0]?.v).toBeUndefined();
    expect(h.writer.checkpoint().pending).toEqual(pending);
    release.resolve(); await saving;
    expect(calls).toBe(3);
    expect(h.writer.checkpoint().source.sourceSha256).toBe('d'.repeat(64));
    expect(h.writer.state()).toEqual({ dirty: false, saving: false, error: null });
    expect(h.writer.checkpoint().sheetBirths?.entries[0]?.descriptor).toEqual(birth.descriptor);
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual({ undos: 1, redos: 0 });
    expect(h.book.save().sheets['2']!.cellData?.[0]?.[0]?.v).toBeUndefined();
  } finally { release.resolve(); await saving; await h.close(); }
});
