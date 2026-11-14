import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSourceDeleteHistoryFixture as rawFixture, sourceDeleteScope } from '../helpers/workbook-source-delete-fixture';
import { captureWorkbookSourceDeletion } from '../../src/components/embedded/workbook/sheet-delete-context';
import { membershipResult } from '../helpers/workbook-membership-result';
import { prepareWorkbookSheetBirth } from '../../src/components/embedded/workbook/sheet-birth-context';
import { workbookProtectedRootRetirement } from '../../src/components/embedded/workbook/sheet-root-retirement';
import * as budget from '../../src/components/embedded/workbook/native-history-budget';

import { IUniverInstanceService } from '@univerjs/core';
import { IDBFactory } from 'fake-indexeddb';
import { readWorkbookDraft, saveWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
function fixture(_owned: true, options: NonNullable<Parameters<typeof rawFixture>[1]> & { afterCommit?: () => void } = {}) {
  return rawFixture(true, { ...options,
    save: async state => { await options.save?.(state); await saveWorkbookDraft(sourceDeleteScope, state); },
    saveGuarded: async (state, guard) => {
      await options.save?.(state);
      await saveWorkbookDraft(sourceDeleteScope, state, guard);
      options.afterCommit?.();
    },
  });
}

it('retires forgotten native Rename issuers after actual native history clear without changing live data or history', async () => {
  const f = fixture(true);
  const admission = vi.spyOn(budget, 'admitWorkbookNativeIssuer');
  try {
    await f.controller!.rename('2', 'First rename');
    await f.controller!.rename('2', 'Second rename');
    f.history.clearUndoRedo(f.book.getId());
    const before = f.book.save();
    const history = f.history.getUndoRedoCheckpoint();
    expect(await f.controller!.retireProtectedRoots()).toMatchObject({ retiredIssuers: 2 });
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    admission.mockClear();
    await f.controller!.rename('2', 'Third rename');
    expect(admission.mock.calls[0]![0]).toBe(0);
  } finally { admission.mockRestore(); await f.close(); }
});

it('durably removes a genuinely unreferenced context without changing any snapshot or source identity', async () => {
  const records: unknown[] = [];
  const f = fixture(true, { save: async state => { records.push(structuredClone(state)); } });
  try {
    const context = captureWorkbookSourceDeletion(sourceDeleteScope, f.writer.checkpoint(), '2');
    f.writer.retainSheetDeletion(context);
    const before = f.writer.checkpoint();
    expect(await f.controller!.retireProtectedRoots()).toMatchObject({ retiredContexts: 1 });
    const after = f.writer.checkpoint();
    expect(after.sheetDeletions).toBeUndefined();
    const { sheetDeletions: _pool, ...untouched } = before;
    expect(after).toEqual(untouched);
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(after);
  } finally { await f.close(); }
});

it('keeps buried Undo and Redo Rename issuers usable while retiring nothing reachable', async () => {
  const f = fixture(true);
  try {
    await f.controller!.rename('2', 'First rename');
    await f.controller!.rename('2', 'Second rename');
    await f.api.undo();
    expect(await f.controller!.retireProtectedRoots()).toMatchObject({ retiredIssuers: 0 });
    await f.api.undo();
    expect(f.book.save().sheets['2']!.name).toBe('Sheet 2');
    await f.api.redo();
    await f.api.redo();
    expect(f.book.save().sheets['2']!.name).toBe('Second rename');
  } finally { await f.close(); }
});

it('retains a present unsaved birth and its high-water/axis owners after its native item is forgotten', async () => {
  const f = fixture(true);
  try {
    await f.controller!.add('Retained birth', 3);
    const before = f.writer.checkpoint();
    f.history.clearUndoRedo(f.book.getId());
    expect(await f.controller!.retireProtectedRoots()).toEqual({ retiredContexts: 0, retiredIssuers: 0 });
    expect(f.writer.checkpoint()).toEqual(before);
    await f.controller!.remove('4');
    await f.api.undo();
    expect(f.book.save().sheets['4']!.name).toBe('Retained birth');
  } finally { await f.close(); }
});

it('retires zero and keeps the full durable branch when reduced storage fails', async () => {
  let denied = false;
  const records: unknown[] = [];
  const f = fixture(true, { save: async state => {
    if (denied && !state?.sheetDeletions?.length) throw Error('Reduced storage denied');
    records.push(structuredClone(state));
  } });
  try {
    f.writer.retainSheetDeletion(captureWorkbookSourceDeletion(sourceDeleteScope, f.writer.checkpoint(), '2'));
    const before = f.writer.checkpoint();
    denied = true;
    await expect(f.controller!.retireProtectedRoots()).rejects.toThrow('Reduced storage denied');
    expect(f.writer.checkpoint()).toEqual(before);
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(before);
    denied = false;
    expect(await f.controller!.retireProtectedRoots()).toMatchObject({ retiredContexts: 1 });
  } finally { await f.close(); }
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it.each(['history', 'lease', 'edit'] as const)('retires zero when %s changes before the guarded storage transaction', async change => {
  const started = gate(), release = gate();
  let blocking = false, current = true;
  const records: unknown[] = [];
  const f = fixture(true, { current: () => current, save: async state => {
    if (blocking && !state?.sheetDeletions?.length) { started.resolve(); await release.promise; }
    records.push(structuredClone(state));
  } });
  let retiring: Promise<unknown> | undefined;
  try {
    f.writer.retainSheetDeletion(captureWorkbookSourceDeletion(sourceDeleteScope, f.writer.checkpoint(), '2'));
    blocking = true;
    retiring = f.controller!.retireProtectedRoots();
    void retiring.catch(() => {});
    await started.promise;
    if (change === 'lease') current = false;
    else if (change === 'history') f.history.pushUndoRedo({ unitID: f.book.getId(), undoMutations: [], redoMutations: [{ id: 'unused', params: {} }] });
    else f.book.getSheetBySheetId('1')!.getRange('A1').setValue(123);
    const before = f.writer.checkpoint();
    blocking = false;
    release.resolve();
    // The real IndexedDB boundary intentionally exposes its stable public
    // abort error rather than the private synchronous guard's message.
    await expect(retiring).rejects.toThrow('The workbook recovery transaction did not commit.');
    expect(f.writer.checkpoint()).toEqual(before);
    await expect.poll(() => readWorkbookDraft(sourceDeleteScope)).toEqual(before);
  } finally { blocking = false; release.resolve(); await retiring?.catch(() => {}); await f.close(); }
});

it('preserves pending creation roots and exact pending intent while a birth is absent in desired', async () => {
  const started = gate(), release = gate();
  const f = fixture(true, { write: async () => { started.resolve(); await release.promise; throw Error('Owned uncertain transport'); } });
  let saving: Promise<void> | undefined;
  try {
    await f.controller!.add('Pending birth', 3);
    saving = f.writer.flush();
    await started.promise;
    await f.controller!.remove('4');
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    expect(before.pending).not.toBeNull();
    expect(before.sheetBirths?.removals?.[0]?.kind).toBe('pending-target');
    expect(await f.controller!.retireProtectedRoots()).toEqual({ retiredContexts: 0, retiredIssuers: 0 });
    expect(f.writer.checkpoint()).toEqual(before);
  } finally { release.resolve(); await saving; await f.close(); }
});

it('does not retire a restored present origin or its historical backing after redo is cleared', async () => {
  const f = fixture(true);
  try {
    await f.controller!.remove('2');
    await f.api.undo();
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(23);
    const before = f.writer.checkpoint();
    expect(f.history.getUndoRedoEntryIds(f.book.getId()).redos).toEqual([]);
    expect(await f.controller!.retireProtectedRoots()).toEqual({ retiredContexts: 0, retiredIssuers: 0 });
    expect(f.writer.checkpoint()).toEqual(before);
    await f.controller!.remove('2');
    await f.api.undo();
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(23);
  } finally { await f.close(); }
});

it('retains pre-save receipt-conversion contexts until the checked ACK, then retires an unreferenced associated context', async () => {
  const started = gate(), release = gate();
  let f!: ReturnType<typeof fixture>;
  f = fixture(true, { write: async (intent, checkpoint) => {
    intent.renderId ??= crypto.randomUUID();
    await checkpoint();
    started.resolve();
    await release.promise;
    return membershipResult(f.writer.checkpoint().source, intent, 'b'.repeat(64));
  } });
  let saving: Promise<void> | undefined;
  try {
    f.writer.retainSheetDeletion(captureWorkbookSourceDeletion(sourceDeleteScope, f.writer.checkpoint(), '2'));
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(22);
    saving = f.writer.flush();
    await started.promise;
    const pending = f.writer.checkpoint().pending;
    expect(await f.controller!.retireProtectedRoots()).toMatchObject({ retiredContexts: 0 });
    expect(f.writer.checkpoint().pending).toEqual(pending);
    release.resolve();
    await saving;
    expect(f.writer.state().error).toBeNull();
    expect(f.writer.checkpoint().sheetDeletions?.[0]?.receiptAssociation).toBeDefined();
    const before = f.writer.checkpoint();
    expect(await f.controller!.retireProtectedRoots()).toMatchObject({ retiredContexts: 1 });
    expect(f.writer.checkpoint().source).toEqual(before.source);
    expect(f.writer.checkpoint().sourceAcknowledgement).toEqual(before.sourceAcknowledgement);
    expect(f.writer.checkpoint().sourceSnapshotBinding).toEqual(before.sourceSnapshotBinding);
  } finally { release.resolve(); await saving; await f.close(); }
});

it('adopts the committed reduced pool after focus loss and never promotes a copied native item into an issuer', async () => {
  let afterCommit: (() => void) | undefined;
  const f = fixture(true, { afterCommit: () => afterCommit?.() });
  try {
    f.writer.retainSheetDeletion(captureWorkbookSourceDeletion(sourceDeleteScope, f.writer.checkpoint(), '2'));
    await f.controller!.rename('2', 'Forgotten rename');
    const native = structuredClone(f.history.pitchTopUndoElement()!);
    f.history.clearUndoRedo(f.book.getId());
    const instances = f.univer.__getInjector().get(IUniverInstanceService);
    const other = f.api.createWorkbook({ id: 'retirement-other', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Other', rowCount: 10, columnCount: 10 } } });
    instances.focusUnit(f.book.getId());
    afterCommit = () => instances.focusUnit(other.getId());
    await expect(f.controller!.retireProtectedRoots()).rejects.toThrow('history changed');
    expect(f.writer.checkpoint().sheetDeletions).toBeUndefined();
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(f.writer.checkpoint());
    instances.focusUnit(f.book.getId());
    afterCommit = undefined;
    f.history.pushUndoRedo({ unitID: f.book.getId(), undoMutations: native.undoMutations, redoMutations: native.redoMutations });
    await expect(f.api.undo()).rejects.toThrow('Rename history has no live issuer');
    f.history.clearUndoRedo(f.book.getId());
    expect(await f.controller!.retireProtectedRoots()).toMatchObject({ retiredIssuers: 1 });
  } finally { await f.close(); }
});

it('cannot issue any new protected origin while pruning awaits its guarded commit', async () => {
  const started = gate(), release = gate();
  let blocking = false;
  const f = fixture(true, { save: async () => { if (blocking) { started.resolve(); await release.promise; } } });
  let retiring: Promise<unknown> | undefined;
  try {
    blocking = true;
    retiring = f.controller!.retireProtectedRoots();
    await started.promise;
    const before = f.book.save();
    await expect(f.controller!.add('Blocked', 3)).rejects.toThrow('not current');
    await expect(f.controller!.remove('2')).rejects.toThrow('not current');
    await expect(f.controller!.rename('2', 'Blocked')).rejects.toThrow('not current');
    expect(f.book.save()).toEqual(before);
    blocking = false;
    release.resolve();
    await retiring;
  } finally { blocking = false; release.resolve(); await retiring; await f.close(); }
});

it('holds checked source ACK conversion behind the entire retirement barrier', async () => {
  const transport = gate(), response = gate(), pruning = gate(), commit = gate();
  let blocking = false;
  let f!: ReturnType<typeof fixture>;
  f = fixture(true, {
    save: async () => { if (blocking) { pruning.resolve(); await commit.promise; } },
    write: async (intent, checkpoint) => {
      intent.renderId ??= crypto.randomUUID();
      await checkpoint();
      transport.resolve();
      await response.promise;
      return membershipResult(f.writer.checkpoint().source, intent, 'b'.repeat(64));
    },
  });
  let saving: Promise<void> | undefined;
  let retiring: Promise<unknown> | undefined;
  try {
    f.writer.retainSheetDeletion(captureWorkbookSourceDeletion(sourceDeleteScope, f.writer.checkpoint(), '2'));
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(22);
    saving = f.writer.flush();
    await transport.promise;
    blocking = true;
    retiring = f.controller!.retireProtectedRoots();
    await pruning.promise;
    const before = f.writer.checkpoint();
    response.resolve();
    // Yield a real event-loop turn after delivering the response, rather than
    // using a clock delay or assuming a particular number of promise stages.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.writer.checkpoint()).toEqual(before);
    blocking = false;
    commit.resolve();
    await retiring;
    await saving;
    expect(f.writer.state().error).toBeNull();
    expect(f.writer.checkpoint().source.sourceSha256).toBe('b'.repeat(64));
    expect(f.writer.checkpoint().sheetDeletions?.[0]?.receiptAssociation).toBeDefined();
  } finally { blocking = false; response.resolve(); commit.resolve(); await retiring; await saving; await f.close(); }
});

it('removes an unused prepared birth record while preserving numeric high-water and axis-generation data', async () => {
  const f = fixture(true);
  try {
    const before = f.writer.checkpoint();
    const prepared = prepareWorkbookSheetBirth(sourceDeleteScope, before, 'Never entered', 3);
    const state = { ...before, sheetBirths: prepared.state };
    const reduced = workbookProtectedRootRetirement(state, f.book.save(), []);
    expect(reduced.births?.entries).toEqual([]);
    expect(reduced.births?.highWaterId).toBe(prepared.state.highWaterId);
    expect(reduced.births?.axisOwner).toEqual(prepared.state.axisOwner);
    expect(reduced.births?.scope).toEqual(prepared.state.scope);
    expect(state.sheetBirths).toEqual(prepared.state);
  } finally { await f.close(); }
});

it.each(['undo', 'redo'] as const)('retains several Rename issuers genuinely buried in the same native %s stack', async direction => {
  const f = fixture(true);
  try {
    for (const name of ['First rename', 'Second rename', 'Third rename']) await f.controller!.rename('2', name);
    if (direction === 'redo') for (let index = 0; index < 3; index++) await f.api.undo();
    const ids = f.history.getUndoRedoEntryIds(f.book.getId());
    expect(ids[direction === 'undo' ? 'undos' : 'redos']).toHaveLength(3);
    const before = f.writer.checkpoint();
    expect(await f.controller!.retireProtectedRoots()).toEqual({ retiredContexts: 0, retiredIssuers: 0 });
    expect(f.writer.checkpoint()).toEqual(before);
    for (let index = 0; index < 3; index++) await (direction === 'undo' ? f.api.undo() : f.api.redo());
    expect(f.book.save().sheets['2']!.name).toBe(direction === 'undo' ? 'Sheet 2' : 'Third rename');
  } finally { await f.close(); }
});

it.each(['birth', 'delete'] as const)('retains a %s issuer buried under ordinary native scalar history without reading its unavailable payload', async kind => {
  const f = fixture(true);
  try {
    if (kind === 'birth') await f.controller!.add('Buried birth', 3);
    else await f.controller!.remove('2');
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(22);
    expect(f.history.getUndoRedoEntryIds(f.book.getId()).undos).toHaveLength(2);
    const before = f.writer.checkpoint();
    expect(await f.controller!.retireProtectedRoots()).toEqual({ retiredContexts: 0, retiredIssuers: 0 });
    expect(f.writer.checkpoint()).toEqual(before);
    await f.api.undo();
    expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(21);
    await f.api.undo();
    if (kind === 'birth') expect(f.book.save().sheets['4']).toBeUndefined();
    else expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(17);
  } finally { await f.close(); }
});
