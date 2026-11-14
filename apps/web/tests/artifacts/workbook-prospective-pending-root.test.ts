import { expect, it } from 'vitest';
import { createWorkbookHistoryControllerFixture } from '../helpers/workbook-history-controller-fixture';
import { createBirthRemovalHarness } from '../helpers/workbook-birth-removal-fixture';
import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
it('adds an unrelated birth while the original pending creation and its removal remain frozen', async () => {
  const started = gate(), release = gate();
  const h = createWorkbookHistoryControllerFixture({ write: async (intent, checkpoint) => {
    intent.renderId ??= crypto.randomUUID(); await checkpoint();
    started.resolve(); await release.promise;
    throw Error('Stand-in transport stopped after the pending-root assertions');
  } });
  let saving: Promise<void> | undefined;
  try {
    const birth = await h.add(); saving = h.writer.flush(); await started.promise;
    await h.api.undo();
    const pending = structuredClone(h.writer.checkpoint().pending);
    const removed = structuredClone(h.writer.checkpoint().sheetBirths?.removals);
    expect(removed?.[0]?.kind).toBe('pending-target');
    const next = await h.add('Third');
    expect(next.descriptor.sheetId).not.toBe(birth.descriptor.sheetId);
    expect(h.book.save().sheetOrder).toEqual(['1', next.descriptor.sheetId]);
    expect(h.writer.checkpoint().pending).toEqual(pending);
    expect(h.writer.checkpoint().sheetBirths?.removals).toEqual(removed);
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
    expect(h.writes).toBe(1);
  } finally { release.resolve(); await saving; await h.close(); }
});
it('deletes a current source sheet without replacing a different frozen birth creation root', async () => {
  const started = gate(), release = gate();
  const h = createBirthRemovalHarness({ additionalSheets: [blankWorkbookSheet('2','Existing two')], write: async (intent, checkpoint) => {
    intent.renderId ??= crypto.randomUUID(); await checkpoint();
    started.resolve(); await release.promise;
    throw Error('Stand-in transport stopped after the pending-root assertions');
  } });
  let saving: Promise<void> | undefined;
  try {
    const birth = await h.add(); saving = h.writer.flush(); await started.promise;
    await h.remove(birth);
    const pending = structuredClone(h.writer.checkpoint().pending);
    const removed = structuredClone(h.writer.checkpoint().sheetBirths?.removals);
    expect(removed?.[0]?.kind).toBe('pending-target');
    expect(h.book.save().sheets['2']).toBeDefined();
    const context = await h.removeSource('2');
    expect(h.book.save().sheetOrder).toEqual(['1']);
    expect(h.writer.checkpoint().pending).toEqual(pending);
    expect(h.writer.checkpoint().sheetBirths?.removals).toEqual(removed);
    expect(h.writer.checkpoint().sheetDeletions?.[0]?.descriptor).toEqual(context.descriptor);
    expect(h.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { release.resolve(); await saving; await h.close(); }
});
it('finishes the original creation then saves the unrelated birth without discarding its removal roots', async () => {
  const started = gate(), release = gate();
  const { standInWorkbookResult } = await import('../helpers/workbook-birth-transport');
  const { birthScope } = await import('../helpers/workbook-birth-fixture');
  let calls = 0;
  const h = createWorkbookHistoryControllerFixture({ write: async (intent, checkpoint, initial) => {
    calls++; intent.renderId ??= crypto.randomUUID(); await checkpoint();
    if (calls === 1) { started.resolve(); await release.promise; }
    const target = structuredClone(initial);
    target.sourceSha256 = (calls === 1 ? 'b' : 'c').repeat(64);
    target.model.sheets.push(blankWorkbookSheet(calls === 1 ? '2' : '3', calls === 1 ? 'Second' : 'Third'));
    return standInWorkbookResult(birthScope, intent, target,
      calls === 1 ? 'before-original' : 'after-original', calls === 1 ? 'after-original' : 'after-unrelated');
  } });
  let saving: Promise<void> | undefined;
  try {
    await h.add(); saving = h.writer.flush(); await started.promise;
    await h.api.undo(); const original = structuredClone(h.writer.checkpoint().pending);
    const next = await h.add('Third');
    expect(h.writer.checkpoint().pending).toEqual(original);
    release.resolve(); await saving;
    expect(calls).toBe(2);
    expect(h.writer.checkpoint().source.sourceSha256).toBe('c'.repeat(64));
    expect(h.writer.checkpoint().pending).toBeNull();
    expect(h.writer.checkpoint().sheetDeletions).toHaveLength(1);
    expect(h.writer.checkpoint().sheetDeletions?.[0]?.descriptor.sheetId).toBe('2');
    expect(h.book.save().sheetOrder).toEqual(['1', next.descriptor.sheetId]);
    expect(h.writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { release.resolve(); await saving; await h.close(); }
});
