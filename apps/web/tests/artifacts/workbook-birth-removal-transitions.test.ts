import { WorkbookSheetMutationOwner } from '../../src/components/embedded/workbook/sheet-mutation-owner';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { birthScope as scope } from '../helpers/workbook-birth-fixture';
import { expect, it, vi } from 'vitest';
import { createBirthRemovalHarness } from '../helpers/workbook-birth-removal-fixture';
import { standInWorkbookResult } from '../helpers/workbook-birth-transport';
import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import type { WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';

function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

it('carries unsaved19/20 through unrelated A→B, binds both to exact creation21, and retains original capture A', async () => {
  const started = gate(), release = gate();
  const operations: string[] = [];
  const admitted: WorkbookCheckpoint[] = [];
  const h = createBirthRemovalHarness({
    write: async (intent, checkpoint, initial) => {
      operations.push(intent.id); intent.renderId ??= crypto.randomUUID(); await checkpoint();
      const target = structuredClone(initial); target.model.sheets[0]!.cells[0]!.value = 20;
      if (operations.length === 1) {
        expect(intent.plan.sheets).toBeUndefined();
        started.resolve(); await release.promise; target.sourceSha256 = 'b'.repeat(64);
        return standInWorkbookResult(scope, intent, target, 'before-literal', 'after-literal');
      }
      target.sourceSha256 = 'c'.repeat(64);
      const second = blankWorkbookSheet('2', 'Second'); second.cells.push({ row: 0, column: 0, kind: 'number', value: 21 }); target.model.sheets.push(second);
      expect(intent.plan.sourceSha256).toBe('b'.repeat(64));
      expect(intent.plan.sheets).toEqual([{ sheetId: '1', name: 'Existing', origin: 'source' }, { sheetId: '2', name: 'Second', origin: 'new' }]);
      expect(admitted.at(-1)?.sheetBirths?.removals?.every(value => value.kind === 'pending-target' && value.creation.operationId === intent.id && value.creation.sourceSha256 === 'b'.repeat(64))).toBe(true);
      return standInWorkbookResult(scope, intent, target, 'after-literal', 'after-creation');
    },
    save: async value => { if (value) admitted.push(structuredClone(value)); },
  });
  let saving: Promise<void> | undefined;
  try {
    h.edit('1', 20); saving = h.writer.flush(); await started.promise;
    const original = structuredClone(h.writer.checkpoint().pending!);
    const birth = await h.add();
    h.edit('2', 19); const first = await h.remove(birth); h.restore(first);
    h.edit('2', 20); const second = await h.remove(birth); h.restore(second);
    h.edit('2', 21);
    expect(h.writer.checkpoint().pending).toEqual(original);
    expect(h.writer.checkpoint().sheetBirths?.removals?.map(value => value.kind)).toEqual(['unsaved', 'unsaved']);
    release.resolve(); await saving;
    expect(operations).toHaveLength(2);
    const contexts = h.writer.checkpoint().sheetDeletions!;
    expect(contexts.map(value => value.removedSheet?.cellData?.[0]?.[0]?.v)).toEqual([19, 20]);
    expect(contexts.every(value => value.baseline.sheet.cells[0]?.value === 21 && value.sourceSha256 === 'c'.repeat(64))).toBe(true);
    expect(contexts.every(value => value.birthOrigin?.captureSourceSha256 === h.source.sourceSha256
      && value.birthOrigin.creation.operationId === operations[1]
      && value.birthOrigin.creation.sourceSha256 === 'b'.repeat(64)
      && value.receiptAssociation?.versionId === 'after-creation')).toBe(true);
    expect(h.writer.checkpoint().sheetBirths?.entries[0]?.initialSheet.cellData).toEqual({});
    expect(h.writer.checkpoint().sheetBirths?.removals).toBeUndefined();
    expect(() => serializeWorkbookDraft(scope, h.writer.checkpoint())).not.toThrow();
    expect(h.writer.state()).toEqual({ dirty: false, saving: false, error: null });
    const protectedCreation = admitted.find(value => value.source.sourceSha256 === 'b'.repeat(64)
      && value.pending?.intent.id === operations[1] && value.pending?.acknowledgement?.kind === 'history'
      && value.sheetDeletions?.length === 2)!;
    expect(protectedCreation).toBeDefined();
    expect(() => serializeWorkbookDraft(scope, protectedCreation)).not.toThrow();
    const originalData = JSON.stringify(protectedCreation);
    const firstAck = admitted.find(value => value.pending?.intent.id === operations[0] && value.pending?.acknowledgement?.kind === 'history')!.pending!.acknowledgement!;
    for (const mutate of [
      (value: WorkbookCheckpoint) => { value.sheetDeletions![1]!.birthOrigin!.birthToken = crypto.randomUUID(); },
      (value: WorkbookCheckpoint) => { value.sheetDeletions![1]!.birthOrigin!.creation.operationId = crypto.randomUUID(); },
      (value: WorkbookCheckpoint) => {
        const otherOperation = crypto.randomUUID(); // Same exact source/target checksums, different operation.
        value.sheetDeletions![1]!.receiptAssociation!.operationId = otherOperation;
        value.sheetDeletions![1]!.birthOrigin!.creation.operationId = otherOperation;
      },
      (value: WorkbookCheckpoint) => { value.pending!.acknowledgement = structuredClone(firstAck); },
    ]) {
      const forged = structuredClone(protectedCreation); mutate(forged);
      expect(() => serializeWorkbookDraft(scope, forged)).toThrow();
    }
    expect(JSON.stringify(protectedCreation)).toBe(originalData);
    const descriptive = structuredClone(protectedCreation);
    descriptive.sheetDeletions![1]!.birthOrigin!.captureSourceSha256 = 'f'.repeat(64);
    expect(() => serializeWorkbookDraft(scope, descriptive)).not.toThrow(); // Capture checksum is descriptive, not authentication.

    // A new operational owner does not hydrate live issuance from any stored
    // ACK/context/marker. Native history remains unchanged without that issuer.
    h.owner.dispose();
    const recoveredOwner = new WorkbookSheetMutationOwner(h.univer, h.book.getId(), {
      isCurrent: () => true, snapshot: () => h.book.save(), owns: () => false,
    });
    try {
      const before = h.book.save(), status = h.history.getUndoRedoStatus(h.book.getId());
      const after = { ...before, sheets: { ...before.sheets }, sheetOrder: ['1'] }; delete after.sheets['2'];
      const command = vi.fn(() => true);
      expect(() => recoveredOwner.run('remove', contexts[1]!.descriptor, before, after, command)).toThrow('not current');
      expect(command).not.toHaveBeenCalled();
      expect(h.book.save()).toEqual(before);
      expect(h.history.getUndoRedoStatus(h.book.getId())).toEqual(status);
    } finally { recoveredOwner.dispose(); }
  } finally { release.resolve(); await saving; await h.close(); }
});

it('preserves capture B independently from the kernel seed A when removal follows an unrelated checked ACK', async () => {
  let writes = 0;
  const h = createBirthRemovalHarness({ write: async (intent, checkpoint, initial) => {
    writes++; intent.renderId ??= crypto.randomUUID(); await checkpoint();
    const target = structuredClone(initial); target.model.sheets[0]!.cells[0]!.value = 20;
    target.sourceSha256 = (writes === 1 ? 'b' : 'c').repeat(64);
    if (writes > 1) { const second = blankWorkbookSheet('2', 'Second'); second.cells.push({ row: 0, column: 0, kind: 'number', value: 21 }); target.model.sheets.push(second); }
    return standInWorkbookResult(scope, intent, target, writes === 1 ? 'before-literal' : 'after-literal', writes === 1 ? 'after-literal' : 'after-creation');
  } });
  try {
    h.edit('1', 20); await h.writer.flush();
    const birth = await h.add(); h.edit('2', 19); const removed = await h.remove(birth); h.restore(removed); h.edit('2', 21);
    expect(removed.removal.captureSourceSha256).toBe('b'.repeat(64));
    expect(h.writer.checkpoint().sheetBirths?.axisOwner.sourceSha256).toBe(h.source.sourceSha256);
    await h.writer.flush();
    const context = h.writer.checkpoint().sheetDeletions![0]!;
    expect(context.birthOrigin?.captureSourceSha256).toBe('b'.repeat(64));
    expect(context.axisOwner.sourceSha256).toBe(h.source.sourceSha256);
    expect(context.birthOrigin?.captureSourceSha256).not.toBe(context.axisOwner.sourceSha256);
    expect(context.baseline.sheet.cells[0]?.value).toBe(21);
    expect(context.removedSheet?.cellData?.[0]?.[0]?.v).toBe(19);
    expect(h.writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { await h.close(); }
});
