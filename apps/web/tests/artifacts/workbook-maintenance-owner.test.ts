import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalUndoRedoService, IUniverInstanceService } from '@univerjs/core';
import { IDBFactory, IDBTransaction } from 'fake-indexeddb';
import { createRetirementFixture as fixture } from '../helpers/workbook-retirement-fixture';
import { membershipResult } from '../helpers/workbook-membership-result';
import { WORKBOOK_SHEET_REMOVALS } from '../../src/components/embedded/workbook/sheet-removal-selection';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function idleQueue() {
  const callbacks = new Map<number, IdleRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => { callbacks.set(++id, callback); return id; });
  vi.stubGlobal('cancelIdleCallback', (handle: number) => { callbacks.delete(handle); });
  return {
    get count() { return callbacks.size; },
    run() {
      const [handle, callback] = [...callbacks][0]!;
      callbacks.delete(handle);
      callback({ didTimeout: false, timeRemaining: () => 50 });
    },
  };
}

it('automatically retires abandoned selectors after real native history clear without a user calling retirement', async () => {
  const idle = idleQueue();
  const f = fixture(true);
  try {
    await f.controller!.add('Automatic abandoned', 3);
    await f.api.undo();
    const owner = f.controller!.startMaintenance();
    f.history.clearUndoRedo(f.book.getId());
    expect(idle.count).toBe(1);
    idle.run();
    await f.controller!.settleMaintenance();
    expect(f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toBeUndefined();
    expect(f.writer.checkpoint().sheetBirths?.entries).toEqual([]);
    expect(idle.count).toBe(0);
    owner.dispose();
  } finally { await f.close(); }
});

it('coalesces actual SDK history bursts and never scans full native IDs until its single idle pass', async () => {
  const idle = idleQueue();
  const f = fixture(true);
  try {
    await f.controller!.add('Current born sheet', 3);
    const owner = f.controller!.startMaintenance();
    const scan = vi.spyOn(LocalUndoRedoService.prototype, 'getUndoRedoEntryIds');
    const retire = vi.spyOn(f.controller!, 'retireObsoleteSelectors');
    const commit = vi.spyOn(IDBTransaction.prototype, 'commit');
    for (let value = 0; value < 60; value++) f.book.getSheetBySheetId('1')!.getRange('A1').setValue(value);
    expect(idle.count).toBe(1);
    expect(scan).not.toHaveBeenCalled();
    expect(retire).not.toHaveBeenCalled();
    idle.run();
    await f.controller!.settleMaintenance();
    expect(retire).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled(); // Exact no-op: no extra draft write or live metadata apply.
    expect(f.book.save().sheets['4']!.name).toBe('Current born sheet');
    expect(idle.count).toBe(0);
    owner.dispose();
  } finally { await f.close(); }
});

it('awaits one pending maintenance pass before a new protected action instead of reaching stale quota accounting', async () => {
  const idle = idleQueue();
  const f = fixture(true);
  try {
    await f.controller!.add('Forgotten old', 3);
    await f.api.undo();
    const owner = f.controller!.startMaintenance();
    f.history.clearUndoRedo(f.book.getId());
    const retire = vi.spyOn(f.controller!, 'retireObsoleteSelectors');
    await f.controller!.add('Next generation', 3);
    expect(retire).toHaveBeenCalledTimes(1);
    expect(f.book.save().sheets['5']!.name).toBe('Next generation');
    expect(f.writer.checkpoint().sheetBirths?.entries).toHaveLength(1);
    expect(f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toBeUndefined();
    owner.dispose();
    expect(idle.count).toBe(0);
  } finally { await f.close(); }
});

it('cancels queued work and detaches native listeners when its installer disposes the maintenance owner', async () => {
  const idle = idleQueue();
  const f = fixture(true);
  try {
    await f.controller!.add('Stopped cleanup', 3);
    await f.api.undo();
    const before = f.writer.checkpoint();
    const owner = f.controller!.startMaintenance();
    expect(idle.count).toBe(1);
    owner.dispose();
    expect(idle.count).toBe(0);
    f.history.clearUndoRedo(f.book.getId());
    expect(idle.count).toBe(0);
    await f.controller!.settleMaintenance();
    expect(f.writer.checkpoint()).toEqual(before);
    expect(await f.controller!.retireObsoleteSelectors()).toMatchObject({ retiredSelectors: 1 });
  } finally { await f.close(); }
});

it('defers a scheduled pass while another real SDK unit has focus and resumes after native focus returns', async () => {
  const idle = idleQueue();
  const f = fixture(true);
  try {
    await f.controller!.add('Focus cleanup', 3);
    await f.api.undo();
    const owner = f.controller!.startMaintenance();
    const instances = f.univer.__getInjector().get(IUniverInstanceService);
    const other = f.api.createWorkbook({ id: 'maintenance-other', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Other', rowCount: 10, columnCount: 10 } } });
    instances.focusUnit(other.getId());
    f.history.clearUndoRedo(f.book.getId());
    idle.run();
    await f.controller!.settleMaintenance();
    expect(f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toBeDefined();
    expect(idle.count).toBe(0);
    instances.focusUnit(f.book.getId());
    expect(idle.count).toBe(1);
    idle.run();
    await f.controller!.settleMaintenance();
    expect(f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toBeUndefined();
    owner.dispose();
  } finally { await f.close(); }
});

it('does not spin after an idle storage failure and retries once before a later protected action', async () => {
  const idle = idleQueue();
  let denied = false;
  const f = fixture(true, { save: async state => { if (denied && state && !state.desired.custom?.[WORKBOOK_SHEET_REMOVALS]) throw Error('Owned maintenance storage failure'); } });
  try {
    await f.controller!.add('Failed cleanup', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const owner = f.controller!.startMaintenance();
    const before = f.writer.checkpoint();
    denied = true;
    idle.run();
    await f.controller!.settleMaintenance();
    expect(f.writer.checkpoint()).toEqual(before);
    expect(idle.count).toBe(0);
    denied = false;
    await f.controller!.add('Successful retry', 3);
    expect(f.book.save().sheets['5']!.name).toBe('Successful retry');
    expect(f.writer.checkpoint().sheetBirths?.entries).toHaveLength(1);
    owner.dispose();
  } finally { await f.close(); }
});

it('allows a bounded pass while a real save is pending and preserves the original creation roots', async () => {
  const idle = idleQueue();
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(true, { write: async () => { started(); await gate; throw Error('Owned uncertain response'); } });
  let saving: Promise<void> | undefined;
  try {
    await f.controller!.add('Pending creation', 3);
    saving = f.writer.flush();
    await entered;
    await f.controller!.remove('4');
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    expect(f.writer.state().saving).toBe(true);
    const retire = vi.spyOn(f.controller!, 'retireObsoleteSelectors');
    const owner = f.controller!.startMaintenance();
    idle.run();
    await f.controller!.settleMaintenance();
    expect(retire).toHaveBeenCalledTimes(1);
    expect(f.writer.checkpoint()).toEqual(before);
    owner.dispose();
  } finally { release(); await saving; await f.close(); }
});

it('uses the bounded task fallback when the host has no idle callback API', async () => {
  vi.stubGlobal('requestIdleCallback', undefined);
  const f = fixture(true);
  try {
    await f.controller!.add('Fallback cleanup', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const owner = f.controller!.startMaintenance();
    await expect.poll(() => f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toBeUndefined();
    await f.controller!.settleMaintenance();
    expect(f.writer.checkpoint().sheetBirths?.entries).toEqual([]);
    owner.dispose();
  } finally { await f.close(); }
});

it('serializes competing protected actions after their shared pre-admission cleanup', async () => {
  const idle = idleQueue();
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let blocking = false;
  const f = fixture(true, { save: async state => { if (blocking && state && !state.desired.custom?.[WORKBOOK_SHEET_REMOVALS]) { entered(); await gate; } } });
  let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined;
  try {
    await f.controller!.add('Old cleanup', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const owner = f.controller!.startMaintenance();
    blocking = true;
    idle.run();
    await waiting;
    first = f.controller!.add('First waiting', 3);
    second = f.controller!.add('Second waiting', 3);
    const results = Promise.allSettled([first, second]);
    blocking = false;
    release();
    const settled = await results;
    expect(settled.map(value => value.status)).toEqual(['fulfilled', 'rejected']);
    expect(f.book.save().sheetOrder).toEqual(['1', '2', '3', '5']);
    expect(f.book.save().sheets['5']!.name).toBe('First waiting');
    owner.dispose();
  } finally { blocking = false; release(); await Promise.allSettled([first, second]); await f.close(); }
});

it('accepts the exact checked-ACK mark without inventing a Writer listener or polling for a new source', async () => {
  const idle = idleQueue();
  let f!: ReturnType<typeof fixture>;
  f = fixture(true, { write: async (intent, checkpoint) => {
    intent.renderId ??= crypto.randomUUID();
    await checkpoint();
    return membershipResult(f.writer.checkpoint().source, intent, 'b'.repeat(64));
  } });
  try {
    await f.controller!.remove('2');
    f.history.clearUndoRedo(f.book.getId());
    const owner = f.controller!.startMaintenance();
    idle.run();
    await f.controller!.settleMaintenance();
    expect(f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toBeDefined(); // Still exists in source, so not obsolete.
    await f.writer.flush();
    expect(f.writer.state().error).toBeNull();
    expect(idle.count).toBe(0);
    // The installer invokes this only after its real checked source rebase;
    // this fixture uses the existing typed membership stand-in, not browser UI.
    f.controller!.requestMaintenance();
    expect(idle.count).toBe(1);
    idle.run();
    await f.controller!.settleMaintenance();
    expect(f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toBeUndefined();
    expect(f.writer.checkpoint().sheetDeletions).toBeUndefined();
    owner.dispose();
  } finally { await f.close(); }
});

it('does not start a queued maintenance microtask after its installer stops the owner', async () => {
  const idle = idleQueue();
  const f = fixture(true);
  try {
    await f.controller!.add('Stopped before admission', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    const retire = vi.spyOn(f.controller!, 'retireObsoleteSelectors');
    const owner = f.controller!.startMaintenance();
    idle.run();
    owner.dispose(); // Stop after scheduling runNow, before its first microtask.
    await f.controller!.settleMaintenance();
    expect(retire).not.toHaveBeenCalled();
    expect(f.writer.checkpoint()).toEqual(before);
    expect(idle.count).toBe(0);
  } finally { await f.close(); }
});
