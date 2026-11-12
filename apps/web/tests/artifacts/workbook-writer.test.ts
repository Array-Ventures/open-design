import { expect, it, vi } from 'vitest';
import { CellValueType, type IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookWriter, type WorkbookWriteIntent, type WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { WorkbookSaveTerminalError, WorkbookSaveUnadmittedError } from '../../src/components/embedded/workbook/save-terminal';
function fixture() {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 1 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
  const initial = gridWorkbook(model, 'grid', 'Forecast').data as IWorkbookData;
  const snapshot = (value: number) => { const next = structuredClone(initial); next.sheets.s!.cellData![0]![0] = { v: value, t: CellValueType.NUMBER }; return next; };
  return { source: { sourceSha256: 'a'.repeat(64), model }, initial, snapshot };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
it('keeps a clean workbook clean and clears dirty state after an acknowledged write', async () => {
  const { source, initial, snapshot } = fixture(), changed = vi.fn(), write = vi.fn(async () => ({ ...source, sourceSha256: 'b'.repeat(64) }));
  const writer = new WorkbookWriter(source, initial, write, changed);
  expect(writer.state().dirty).toBe(false); writer.update(snapshot(2)); expect(writer.state().dirty).toBe(true);
  await writer.flush(); expect(writer.state()).toEqual({ dirty: false, saving: false, error: null }); expect(write).toHaveBeenCalledTimes(1);
});
it('reuses the frozen intent after uncertainty while retaining newer edits for a second save', async () => {
  const { source, initial, snapshot } = fixture(), intents: WorkbookWriteIntent[] = [];
  let calls = 0;
  const writer = new WorkbookWriter(source, initial, async intent => { intents.push(intent); if (++calls === 1) throw new Error('Response lost'); return { ...source, sourceSha256: calls === 2 ? 'b'.repeat(64) : 'c'.repeat(64) }; }, () => {});
  writer.update(snapshot(2)); await writer.flush(); writer.update(snapshot(3)); await writer.flush();
  expect(intents).toHaveLength(3); expect(intents[0]).toBe(intents[1]); expect(intents[2]!.id).not.toBe(intents[0]!.id);
  expect(intents[1]!.plan.edits[0]!.cell.value).toBe(2); expect(intents[2]!.plan.edits[0]!.cell.value).toBe(3); expect(intents[2]!.plan.sourceSha256).toBe('b'.repeat(64));
  expect(writer.state().dirty).toBe(false);
});
it('serializes a concurrent flush and does not clear edits made while saving', async () => {
  const { source, initial, snapshot } = fixture(), first = deferred<typeof source>(), second = deferred<typeof source>();
  const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const writer = new WorkbookWriter(source, initial, write, () => {});
  writer.update(snapshot(2)); const running = writer.flush(); expect(writer.flush()).toBe(running); await Promise.resolve();
  writer.update(snapshot(3)); first.resolve({ ...source, sourceSha256: 'b'.repeat(64) }); await Promise.resolve(); await Promise.resolve();
  expect(writer.state()).toMatchObject({ dirty: true, saving: true }); second.resolve({ ...source, sourceSha256: 'c'.repeat(64) }); await running;
  expect(write).toHaveBeenCalledTimes(2); expect(writer.state().dirty).toBe(false);
});
it('blocks unsupported changes without losing them and permits undo to the original', async () => {
  const { source, initial } = fixture(), write = vi.fn(), writer = new WorkbookWriter(source, initial, write, () => {});
  const changed = structuredClone(initial); changed.sheetOrder.push('new'); writer.update(changed); await writer.flush();
  expect(write).not.toHaveBeenCalled(); expect(writer.state()).toMatchObject({ dirty: true, error: expect.stringContaining('structure') });
  writer.update(initial); expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
});
it('ignores late acknowledgements and publishes nothing after disposal', async () => {
  const { source, initial, snapshot } = fixture(), response = deferred<typeof source>(), changed = vi.fn(), accepted = vi.fn();
  const writer = new WorkbookWriter(source, initial, () => response.promise, changed, accepted);
  writer.update(snapshot(2)); const running = writer.flush(); await Promise.resolve(); writer.dispose(); changed.mockClear(); response.resolve(source); await running;
  expect(changed).not.toHaveBeenCalled(); expect(accepted).not.toHaveBeenCalled();
});
it('treats a resize-only workbook as dirty and sends its dimension intent', async () => {
  const { source, initial } = fixture(), write = vi.fn(async (_intent: WorkbookWriteIntent) => ({ ...source, sourceSha256: 'b'.repeat(64) }));
  const writer = new WorkbookWriter(source, initial, write, () => {}), resized = structuredClone(initial);
  resized.sheets.s!.columnData![0] = { w: 180 }; writer.update(resized);
  expect(writer.state().dirty).toBe(true); await writer.flush();
  expect(write.mock.calls[0]![0].plan.dimensions).toEqual([{ sheetId: 's', axis: 'column', index: 0, size: 25 }]);
  expect(writer.state().dirty).toBe(false);
});
it('persists a frozen save identity before calling the remote writer and blocks admission if protection fails', async () => {
  const { source, initial, snapshot } = fixture(), saved: WorkbookCheckpoint[] = [], order: string[] = [];
  const journal = { save: vi.fn(async (value: WorkbookCheckpoint | null) => { if (value) saved.push(structuredClone(value)); order.push('checkpoint'); }) };
  const writer = new WorkbookWriter(source, initial, async intent => {
    expect(saved.at(-1)?.pending?.intent).toEqual(intent); order.push('write'); return { ...source, sourceSha256: 'b'.repeat(64) };
  }, () => {}, undefined, journal);
  writer.update(snapshot(2)); await writer.flush(); expect(order.indexOf('write')).toBeGreaterThan(order.indexOf('checkpoint'));
  expect(journal.save).toHaveBeenLastCalledWith(null);
  const write = vi.fn(), broken = new WorkbookWriter(source, initial, write, () => {}, undefined, { save: async () => { throw new Error('Quota exceeded'); } });
  broken.update(snapshot(2)); await broken.flush(); expect(write).not.toHaveBeenCalled(); expect(broken.state()).toMatchObject({ dirty: true, error: expect.stringContaining('could not be protected') });
});
it('recovers the exact pending intent and preserves edits made during the uncertain save', async () => {
  const { source, initial, snapshot } = fixture(); const protectedState: { checkpoint: WorkbookCheckpoint | null } = { checkpoint: null };
  const journal = { save: async (value: WorkbookCheckpoint | null) => { protectedState.checkpoint = value; } };
  const first = new WorkbookWriter(source, initial, async () => { throw new Error('Response lost'); }, () => {}, undefined, journal);
  first.update(snapshot(2)); await first.flush(); first.update(snapshot(3));
  // flush reuses the pending intent and guarantees the last local update was journaled.
  await first.flush(); const recovered = structuredClone(protectedState.checkpoint!), pending = recovered.pending!.intent;
  first.dispose(); const intents: WorkbookWriteIntent[] = [];
  const next = new WorkbookWriter({ ...source, sourceSha256: 'b'.repeat(64) }, initial, async intent => { intents.push(intent); return { ...source, sourceSha256: intents.length === 1 ? 'b'.repeat(64) : 'c'.repeat(64) }; }, () => {}, undefined, { ...journal, restored: recovered });
  expect(next.recoveredSnapshot()).toEqual(snapshot(3)); await next.flush();
  expect(intents[0]).toEqual(pending); expect(intents[0]!.plan.edits[0]!.cell.value).toBe(2); expect(intents[1]!.plan.edits[0]!.cell.value).toBe(3);
  expect(intents[1]!.id).not.toBe(pending.id); expect(next.state().dirty).toBe(false); expect(protectedState.checkpoint).toBeNull();
});
it('does not write an unsaved recovered draft over a changed source without a pending operation to reconcile', async () => {
  const { source, initial, snapshot } = fixture(), first = new WorkbookWriter(source, initial, vi.fn(), () => {});
  first.update(snapshot(2)); const restored = first.checkpoint(), write = vi.fn(); first.dispose();
  const next = new WorkbookWriter({ ...source, sourceSha256: 'b'.repeat(64) }, initial, write, () => {}, undefined, { save: async () => {}, restored });
  await next.flush(); expect(write).not.toHaveBeenCalled(); expect(next.state()).toMatchObject({ dirty: true, error: expect.stringContaining('older workbook') }); expect(next.recoveredSnapshot()).toEqual(snapshot(2));
});
it('does not release ownership while a late transport checkpoint can still write', async () => {
  const { source, initial, snapshot } = fixture(), transport = deferred<void>(), started = deferred<void>(), released = vi.fn();
  const journal = { save: vi.fn(async (_checkpoint: WorkbookCheckpoint | null) => {}) };
  const writer = new WorkbookWriter(source, initial, async (_intent, checkpoint) => {
    started.resolve(); await transport.promise; await checkpoint(); return source;
  }, () => {}, undefined, journal);
  writer.update(snapshot(2)); void writer.flush(); await started.promise;
  const closing = writer.close().then(released);
  expect(released).not.toHaveBeenCalled(); const before = journal.save.mock.calls.length;
  transport.resolve(); await closing;
  expect(journal.save.mock.calls.length).toBeGreaterThan(before); expect(released).toHaveBeenCalledOnce();
  const after = journal.save.mock.calls.length; writer.update(snapshot(3)); await Promise.resolve(); expect(journal.save).toHaveBeenCalledTimes(after);
});
it('journals a verified terminal rejection without losing edits or retrying a conflict against the old source', async () => {
  const { source, initial, snapshot } = fixture(), saved: (WorkbookCheckpoint | null)[] = [];
  const write = vi.fn(async (intent: WorkbookWriteIntent) => { throw new WorkbookSaveTerminalError(intent.id, crypto.randomUUID(), 'conflict'); });
  const writer = new WorkbookWriter(source, initial, write, () => {}, undefined, { save: async state => { saved.push(state); } });
  writer.update(snapshot(2)); await writer.flush();
  expect(writer.checkpoint().pending).toBeNull(); expect(saved.at(-1)?.pending).toBeNull(); expect(writer.state().dirty).toBe(true);
  expect(writer.recoveredSnapshot()).toEqual(snapshot(2)); await writer.flush(); expect(write).toHaveBeenCalledOnce();
});
it('does not clear a pending intent for a terminal receipt belonging to another operation', async () => {
  const { source, initial, snapshot } = fixture();
  const writer = new WorkbookWriter(source, initial, async () => { throw new WorkbookSaveTerminalError(crypto.randomUUID(), crypto.randomUUID(), 'cancelled'); }, () => {});
  writer.update(snapshot(2)); await writer.flush(); expect(writer.checkpoint().pending).not.toBeNull(); expect(writer.state().dirty).toBe(true);
});
it('keeps edits and permits a fresh explicit retry after a failed preparation is proven unable to write', async () => {
  const { source, initial, snapshot } = fixture(), intents: string[] = [], stored: (WorkbookCheckpoint | null)[] = [];
  const writer = new WorkbookWriter(source, initial, async intent => {
    intents.push(intent.id);
    if (intents.length === 1) throw new WorkbookSaveUnadmittedError(intent.id, crypto.randomUUID(), 'failed', 'The calculation failed.');
    return { ...source, sourceSha256: 'b'.repeat(64) };
  }, () => {}, undefined, { save: async checkpoint => { stored.push(checkpoint); } });
  writer.update(snapshot(2)); await writer.flush();
  expect(writer.checkpoint().pending).toBeNull(); expect(stored.at(-1)?.pending).toBeNull(); expect(writer.state().dirty).toBe(true);
  expect(writer.recoveredSnapshot()).toEqual(snapshot(2)); await writer.flush();
  expect(intents).toHaveLength(2); expect(intents[0]).not.toBe(intents[1]); expect(writer.state().dirty).toBe(false);
});
it('retains the fence when a rejection identifies a different candidate', async () => {
  const { source, initial, snapshot } = fixture();
  const writer = new WorkbookWriter(source, initial, async intent => {
    intent.renderId = '66a28381-a8cf-40cd-91d2-b1f9cd696ac0';
    throw new WorkbookSaveUnadmittedError(intent.id, '66a28381-a8cf-40cd-91d2-b1f9cd696ac1', 'failed', 'Failed');
  }, () => {});
  writer.update(snapshot(2)); await writer.flush(); expect(writer.checkpoint().pending).not.toBeNull(); expect(writer.state().dirty).toBe(true);
});
