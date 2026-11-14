import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { decodeWorkbookDraft } from '../../src/components/embedded/workbook/workbook-checkpoint';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { expect, it } from 'vitest';
import { RemoveSheetMutation } from '@univerjs/sheets';
import { createBirthRemovalHarness } from '../helpers/workbook-birth-removal-fixture';
import { standInWorkbookResult } from '../helpers/workbook-birth-transport';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import { WorkbookWriter, type WorkbookWriteIntent, type WorkbookWriteResult, type WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';

function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function bornTarget(initial: WorkbookCheckpoint['source'], sha: string, value: number) {
  const target = structuredClone(initial); target.sourceSha256 = sha;
  const second = blankWorkbookSheet('2', 'Second'); second.cells.push({ row: 0, column: 0, kind: 'number', value }); target.model.sheets.push(second);
  return target;
}

it('refuses precommand durable failure without native mutation/history pop and keeps later ordinary edits saveable', async () => {
  const started = gate(), release = gate();
  let denied = false, writes = 0, mutations = 0;
  const h = createBirthRemovalHarness({
    write: async (intent, checkpoint, initial) => {
      writes++; intent.renderId ??= crypto.randomUUID(); await checkpoint();
      if (writes === 1) { started.resolve(); await release.promise; }
      return standInWorkbookResult(scope, intent, bornTarget(initial, (writes === 1 ? 'b' : 'c').repeat(64), writes === 1 ? 17 : 19),
        writes === 1 ? 'before-birth' : 'after-birth', writes === 1 ? 'after-birth' : 'after-edit');
    },
    save: async value => { if (!denied && value?.sheetBirths?.removals?.length) { denied = true; throw Error('Device storage refused the protected candidate'); } },
  });
  const observer = h.commands.onCommandExecuted(command => { if (command.id === RemoveSheetMutation.id) mutations++; });
  let saving: Promise<void> | undefined;
  try {
    const birth = await h.add(); h.edit('2', 17); saving = h.writer.flush(); await started.promise;
    const original = structuredClone(h.writer.checkpoint().pending!);
    h.edit('2', 19); const status = h.history.getUndoRedoStatus(h.book.getId());
    await expect(h.remove(birth)).rejects.toThrow('Device storage refused');
    expect(mutations).toBe(0);
    expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual(status);
    expect(h.book.save().sheets['2']!.cellData?.[0]?.[0]?.v).toBe(19);
    expect(h.writer.checkpoint().pending).toEqual(original);
    expect(h.writer.checkpoint().sheetBirths?.removals).toBeUndefined();
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    release.resolve(); await saving;
    expect(writes).toBe(2);
    expect(h.writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { release.resolve(); await saving; observer.dispose(); await h.close(); }
});

it('waits for protected storage when ACK arrives early without deadlocking source retirement', async () => {
  const started = gate(), release = gate(), protecting = gate(), allowProtection = gate(), returningAck = gate();
  let writes = 0, blocked = false;
  const h = createBirthRemovalHarness({
    write: async (intent, checkpoint, initial) => {
      writes++; intent.renderId ??= crypto.randomUUID(); await checkpoint();
      if (writes === 1) {
        started.resolve(); await release.promise;
        const result = standInWorkbookResult(scope, intent, bornTarget(initial, 'b'.repeat(64), 17), 'before-birth', 'after-birth');
        returningAck.resolve(); return result;
      }
      const deleted = structuredClone(initial); deleted.sourceSha256 = 'c'.repeat(64);
      return standInWorkbookResult(scope, intent, deleted, 'after-birth', 'after-delete');
    },
    save: async value => {
      if (!blocked && value?.sheetBirths?.removals?.length && value.desired.sheets['2']) {
        blocked = true; protecting.resolve(); await allowProtection.promise;
      }
    },
  });
  let saving: Promise<void> | undefined, removing: ReturnType<typeof h.remove> | undefined;
  try {
    const birth = await h.add(); h.edit('2', 17); saving = h.writer.flush(); await started.promise;
    h.edit('2', 19); removing = h.remove(birth); await protecting.promise;
    release.resolve(); await returningAck.promise;
    expect(h.writer.checkpoint().source.sourceSha256).toBe(h.source.sourceSha256);
    expect(h.writer.checkpoint().pending?.acknowledgement).toBeUndefined();
    expect(h.book.save().sheets['2']!.cellData?.[0]?.[0]?.v).toBe(19);
    allowProtection.resolve(); await Promise.all([removing, saving]);
    expect(writes).toBe(2);
    expect(h.writer.checkpoint().sheetDeletions?.[0]?.removedSheet?.cellData?.[0]?.[0]?.v).toBe(19);
    expect(h.writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { allowProtection.resolve(); release.resolve(); await removing?.catch(() => {}); await saving; await h.close(); }
});


it('replays the exact operation after target ACK storage fails and recovers retained19 without restoring native history', async () => {
  const started = gate(), release = gate();
  const receipts = new Map<string, WorkbookWriteResult>(), bodies = new Map<string, string>(), calls: string[] = [];
  let rejected = false, commits = 0;
  const transport = async (intent: WorkbookWriteIntent, checkpoint: () => Promise<void>, initial: WorkbookCheckpoint['source']) => {
    intent.renderId ??= crypto.randomUUID(); calls.push(intent.id);
    const body = canonicalWorkbookJsonValue(intent);
    if (bodies.has(intent.id)) expect(body).toBe(bodies.get(intent.id)); else bodies.set(intent.id, body);
    await checkpoint();
    if (receipts.has(intent.id)) return receipts.get(intent.id)!;
    commits++;
    if (commits === 1) {
      started.resolve(); await release.promise;
      const result = standInWorkbookResult(scope, intent, bornTarget(initial, 'b'.repeat(64), 17), 'before-birth', 'after-birth');
      receipts.set(intent.id, result); return result;
    }
    const deleted = structuredClone(initial); deleted.sourceSha256 = 'c'.repeat(64);
    expect(intent.plan.sourceSha256).toBe('b'.repeat(64));
    const result = standInWorkbookResult(scope, intent, deleted, 'after-birth', 'after-delete'); receipts.set(intent.id, result); return result;
  };
  const h = createBirthRemovalHarness({ write: transport, save: async value => {
    if (!rejected && value?.pending?.acknowledgement?.kind === 'history' && value.sheetDeletions?.length) {
      rejected = true; throw Error('Receipt storage interrupted');
    }
  } });
  let saving: Promise<void> | undefined, recovered: WorkbookWriter | undefined;
  let fresh: ReturnType<typeof createWorkbookBirthFixture> | undefined;
  try {
    const birth = await h.add(); h.edit('2', 17); saving = h.writer.flush(); await started.promise;
    const original = structuredClone(h.writer.checkpoint().pending!);
    h.edit('2', 19); const removed = await h.remove(birth);
    release.resolve(); await saving;
    expect(commits).toBe(1);
    expect(h.writer.checkpoint().source.sourceSha256).toBe(h.source.sourceSha256);
    expect(h.writer.checkpoint().pending?.intent.id).toBe(original.intent.id);
    expect(h.writer.checkpoint().sheetDeletions?.[0]?.removedSheet?.cellData?.[0]?.[0]?.v).toBe(19);
    const durable = decodeWorkbookDraft(JSON.parse(serializeWorkbookDraft(scope, h.durable.value!)), scope);
    expect(durable.pending).toEqual(original);
    expect(durable.sheetBirths?.removals?.[0]?.descriptor).toEqual(removed.removal.descriptor);
    expect(durable.sheetBirths?.removals?.[0]?.removedSheet.cellData?.[0]?.[0]?.v).toBe(19);
    expect(durable.sheetDeletions).toBeUndefined();
    await h.writer.close(); h.owner.dispose();
    const second = blankWorkbookSheet('2', 'Second'); second.cells.push({ row: 0, column: 0, kind: 'number', value: 17 });
    fresh = createWorkbookBirthFixture('1', 100, [second], 'b'.repeat(64));
    expect(fresh.history.getUndoRedoStatus(fresh.book.getId())).toEqual({ undos: 0, redos: 0 });
    recovered = new WorkbookWriter(fresh.source, fresh.book.save(), (intent, checkpoint) => transport(intent, checkpoint, h.source), () => {}, undefined, {
      scope, restored: durable, isCurrent: () => true, validate: value => { serializeWorkbookDraft(scope, value); },
      save: async value => { if (value) serializeWorkbookDraft(scope, value); },
    });
    await recovered.flush();
    expect(calls.slice(0, 2)).toEqual([original.intent.id, original.intent.id]);
    expect(new Set(calls).size).toBe(2); expect(commits).toBe(2);
    expect(recovered.checkpoint().source.sourceSha256).toBe('c'.repeat(64));
    expect(recovered.checkpoint().sheetDeletions?.[0]?.removedSheet?.cellData?.[0]?.[0]?.v).toBe(19);
    expect(recovered.state()).toEqual({ dirty: false, saving: false, error: null });
    expect(fresh.history.getUndoRedoStatus(fresh.book.getId())).toEqual({ undos: 0, redos: 0 });
  } finally { release.resolve(); await saving; await recovered?.close(); fresh?.univer.dispose(); await h.close(); }
});


it('preserves all original unsaved roots and sends no request when binding a creation cannot be stored', async () => {
  const ready = gate();
  let block = false, writes = 0;
  const h = createBirthRemovalHarness({
    write: async (intent, checkpoint, initial) => {
      writes++; intent.renderId ??= crypto.randomUUID(); await checkpoint();
      return standInWorkbookResult(scope, intent, bornTarget(initial, 'b'.repeat(64), 21), 'before-creation', 'after-creation');
    },
    save: async value => {
      if (block && value?.pending && value.sheetBirths?.removals?.some(record => record.kind === 'pending-target')) throw Error('Creation association storage failed');
    },
    afterSave: value => {
      if (!value?.pending && value?.desired.sheets['2']?.cellData?.[0]?.[0]?.v === 21 && value.sheetBirths?.removals?.length === 1) ready.resolve();
    },
  });
  try {
    const birth = await h.add(); h.edit('2', 19); const removed = await h.remove(birth); h.restore(removed); h.edit('2', 21);
    await ready.promise;
    const original = structuredClone(h.durable.value!);
    expect(original.sheetBirths?.removals?.[0]?.kind).toBe('unsaved');
    block = true; await h.writer.flush();
    expect(writes).toBe(0);
    expect(h.durable.value).toEqual(original);
    const bound = h.writer.checkpoint().sheetBirths?.removals?.[0]!;
    expect(bound).toMatchObject({ kind: 'pending-target', descriptor: removed.removal.descriptor, captureSourceSha256: removed.removal.captureSourceSha256 });
    expect(bound.removedSheet.cellData?.[0]?.[0]?.v).toBe(19);
    expect(h.writer.checkpoint().source.sourceSha256).toBe(h.source.sourceSha256);
    const retainedOperation = h.writer.checkpoint().pending!.intent.id;
    block = false; await h.writer.flush();
    expect(writes).toBe(1);
    expect(h.writer.checkpoint().sheetDeletions?.[0]?.birthOrigin?.creation.operationId).toBe(retainedOperation);
    expect(h.writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { block = false; await h.close(); }
});

it('repeats target association when another protected removal is admitted during ACK storage', async () => {
  const started = gate(), release = gate(), receiptStore = gate(), allowReceipt = gate();
  let blocked = false, writes = 0;
  const h = createBirthRemovalHarness({
    write: async (intent, checkpoint, initial) => {
      writes++; intent.renderId ??= crypto.randomUUID(); await checkpoint();
      if (writes === 1) { started.resolve(); await release.promise; return standInWorkbookResult(scope, intent, bornTarget(initial, 'b'.repeat(64), 17), 'before-birth', 'after-birth'); }
      const deleted = structuredClone(initial); deleted.sourceSha256 = 'c'.repeat(64);
      return standInWorkbookResult(scope, intent, deleted, 'after-birth', 'after-delete');
    },
    save: async value => {
      if (!blocked && value?.pending?.acknowledgement?.kind === 'history' && value.sheetDeletions?.length === 1) {
        blocked = true; receiptStore.resolve(); await allowReceipt.promise;
      }
    },
  });
  let saving: Promise<void> | undefined, removing: ReturnType<typeof h.remove> | undefined;
  try {
    const birth = await h.add(); h.edit('2', 17); saving = h.writer.flush(); await started.promise;
    const original = structuredClone(h.writer.checkpoint().pending!);
    h.edit('2', 19); const first = await h.remove(birth);
    release.resolve(); await receiptStore.promise;
    expect(h.writer.checkpoint().source.sourceSha256).toBe(h.source.sourceSha256);
    h.restore(first); h.edit('2', 20); removing = h.remove(birth);
    allowReceipt.resolve(); await Promise.all([removing, saving]);
    expect(writes).toBe(2);
    expect(h.writer.checkpoint().sheetDeletions?.map(value => value.removedSheet?.cellData?.[0]?.[0]?.v)).toEqual([19, 20]);
    expect(h.writer.checkpoint().sheetDeletions?.every(value => value.sourceSha256 === 'b'.repeat(64)
      && value.receiptAssociation?.operationId === original.intent.id)).toBe(true);
    expect(h.writer.checkpoint().sheetBirths?.removals).toBeUndefined();
    expect(h.writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { allowReceipt.resolve(); release.resolve(); await removing?.catch(() => {}); await saving; await h.close(); }
});

it('refuses a stale protected capture after newer edits arrive during storage without consuming history or poisoning them', async () => {
  const started = gate(), release = gate(), protecting = gate(), allowProtection = gate();
  let writes = 0, blocked = false, mutations = 0;
  const h = createBirthRemovalHarness({
    write: async (intent, checkpoint, initial) => {
      writes++; intent.renderId ??= crypto.randomUUID(); await checkpoint();
      if (writes === 1) { started.resolve(); await release.promise; }
      return standInWorkbookResult(scope, intent, bornTarget(initial, (writes === 1 ? 'b' : 'c').repeat(64), writes === 1 ? 17 : 20),
        writes === 1 ? 'before-birth' : 'after-birth', writes === 1 ? 'after-birth' : 'after-edit');
    },
    save: async value => {
      if (!blocked && value?.sheetBirths?.removals?.length && value.desired.sheets['2']) { blocked = true; protecting.resolve(); await allowProtection.promise; }
    },
  });
  const observer = h.commands.onCommandExecuted(command => { if (command.id === RemoveSheetMutation.id) mutations++; });
  let saving: Promise<void> | undefined, removing: ReturnType<typeof h.remove> | undefined;
  try {
    const birth = await h.add(); h.edit('2', 17); saving = h.writer.flush(); await started.promise;
    h.edit('2', 19); removing = h.remove(birth); await protecting.promise;
    h.edit('2', 20); const history = h.history.getUndoRedoStatus(h.book.getId());
    allowProtection.resolve(); await expect(removing).rejects.toThrow('changed while protecting');
    expect(mutations).toBe(0); expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual(history);
    expect(h.writer.checkpoint().desired.sheets['2']!.cellData?.[0]?.[0]?.v).toBe(20);
    expect(h.writer.checkpoint().sheetBirths?.removals).toBeUndefined();
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    release.resolve(); await saving;
    expect(h.writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { allowProtection.resolve(); release.resolve(); await removing?.catch(() => {}); await saving; observer.dispose(); await h.close(); }
});
