import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IUniverInstanceService, type Workbook } from '@univerjs/core';
import { IDBFactory, IDBTransaction, IDBObjectStore } from 'fake-indexeddb';
import { createRetirementFixture as fixture } from '../helpers/workbook-retirement-fixture';
import { sourceDeleteScope } from '../helpers/workbook-source-delete-fixture';
import { readWorkbookDraft, saveWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { membershipResult } from '../helpers/workbook-membership-result';
import { matchesWorkbookSourceSnapshot } from '../../src/components/embedded/workbook/source-snapshot-binding';
import { decodeWorkbookDraft, encodeWorkbookDraft } from '../../src/components/embedded/workbook/workbook-checkpoint';
import { WorkbookWriter } from '../../src/components/embedded/workbook/workbook-writer';
import { WorkbookSheetHistoryController } from '../../src/components/embedded/workbook/sheet-history-controller';
import { WORKBOOK_SHEET_REMOVALS } from '../../src/components/embedded/workbook/sheet-removal-selection';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

it('cleans an abandoned unsaved birth selector and its orphan origins after native history is forgotten', async () => {
  const f = fixture(true);
  try {
    await f.controller!.add('Abandoned birth', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    expect(before.desired.custom?.[WORKBOOK_SHEET_REMOVALS]).toBeDefined();
    const native = f.history.getUndoRedoCheckpoint();
    expect(await f.controller!.retireObsoleteSelectors()).toMatchObject({ retiredSelectors: 1 });
    const after = f.writer.checkpoint();
    expect(after.desired.custom?.[WORKBOOK_SHEET_REMOVALS]).toBeUndefined();
    expect(after.sheetBirths?.entries).toEqual([]);
    expect(after.sheetBirths?.removals ?? []).toEqual([]);
    expect(after.sheetBirths?.highWaterId).toBe(before.sheetBirths?.highWaterId);
    expect(after.source).toEqual(before.source);
    expect(after.pending).toEqual(before.pending);
    expect(f.book.save()).toEqual(after.desired);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(native);
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(after);
    await f.controller!.add('Next birth', 3);
    expect(f.book.save().sheetOrder.at(-1)).toBe('5');
  } finally { await f.close(); }
});

it('keeps selectors still needed by native birth Redo rather than interpreting absence as retirement', async () => {
  const f = fixture(true);
  try {
    await f.controller!.add('Native redo birth', 3);
    await f.api.undo();
    const before = f.writer.checkpoint();
    expect(await f.controller!.retireObsoleteSelectors()).toMatchObject({ retiredSelectors: 0 });
    expect(f.writer.checkpoint()).toEqual(before);
    await f.api.redo();
    expect(f.book.save().sheets['4']!.name).toBe('Native redo birth');
  } finally { await f.close(); }
});

it.each(['QuotaExceededError', 'InvalidStateError'])('rolls back only its live metadata after actual IDB %s following apply', async errorName => {
  const f = fixture(true);
  try {
    await f.controller!.add('Aborted cleanup', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    let observedApply = false;
    const commit = vi.spyOn(IDBTransaction.prototype, 'commit').mockImplementationOnce(() => {
      observedApply = f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS] === undefined;
      throw new DOMException('Owned commit failure', errorName);
    });
    await expect(f.controller!.retireObsoleteSelectors()).rejects.toThrow('transaction did not commit');
    commit.mockRestore();
    expect(observedApply).toBe(true);
    expect(f.book.save()).toEqual(before.desired);
    expect(f.writer.checkpoint()).toEqual(before);
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(before);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
    expect(await f.controller!.retireObsoleteSelectors()).toMatchObject({ retiredSelectors: 1 });
  } finally { vi.restoreAllMocks(); await f.close(); }
});

it('preserves a real later scalar edit and unrelated workbook custom data when aborted apply rolls back', async () => {
  const f = fixture(true);
  try {
    await f.controller!.add('Aborted after edit', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    const unit = f.univer.__getInjector().get(IUniverInstanceService).getUnit<Workbook>(f.book.getId())!;
    const commit = vi.spyOn(IDBTransaction.prototype, 'commit').mockImplementationOnce(() => {
      unit.setCustomMetadata({ ...unit.getCustomMetadata(), unrelated: { retained: true } });
      f.book.getSheetBySheetId('1')!.getRange('A1').setValue(123);
      throw new DOMException('Owned abort after scalar edit', 'InvalidStateError');
    });
    await expect(f.controller!.retireObsoleteSelectors()).rejects.toThrow('transaction did not commit');
    commit.mockRestore();
    expect(f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toEqual(before.desired.custom?.[WORKBOOK_SHEET_REMOVALS]);
    expect(f.book.save().custom?.unrelated).toEqual({ retained: true });
    expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(123);
    expect(f.writer.checkpoint().desired).toEqual(f.book.save());
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(f.writer.checkpoint());
    await f.api.undo();
    expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(21);
  } finally { vi.restoreAllMocks(); await f.close(); }
});

it.each(['focus', 'lease'])('retains rollback authority through %s withdrawal after apply without granting operational commands', async withdrawal => {
  let current = true;
  const f = fixture(true, { current: () => current });
  try {
    await f.controller!.add('Withdrawn cleanup', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    const instances = f.univer.__getInjector().get(IUniverInstanceService);
    const other = f.api.createWorkbook({ id: 'withdrawal-other', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Other', rowCount: 10, columnCount: 10 } } });
    instances.focusUnit(f.book.getId());
    const commit = vi.spyOn(IDBTransaction.prototype, 'commit').mockImplementationOnce(() => {
      if (withdrawal === 'lease') current = false;
      else instances.focusUnit(other.getId());
      throw new DOMException('Owned abort after withdrawal', 'InvalidStateError');
    });
    await expect(f.controller!.retireObsoleteSelectors()).rejects.toThrow('transaction did not commit');
    commit.mockRestore();
    expect(f.book.save()).toEqual(before.desired);
    expect(f.writer.checkpoint()).toEqual(before);
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(before);
    await expect(f.controller!.add('Unavailable', 3)).rejects.toThrow('not current');
  } finally { vi.restoreAllMocks(); await f.close(); }
});

it('quarantines the full old recovery branch when unmount ends the private rollback lifetime after apply', async () => {
  const f = fixture(true);
  try {
    await f.controller!.add('Unmount cleanup', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    const commit = vi.spyOn(IDBTransaction.prototype, 'commit').mockImplementationOnce(() => {
      f.controller!.dispose();
      throw new DOMException('Owned unmount abort', 'InvalidStateError');
    });
    await expect(f.controller!.retireObsoleteSelectors()).rejects.toThrow('transaction did not commit');
    commit.mockRestore();
    expect(f.writer.checkpoint()).toEqual({ ...before, sheetActionConflict: true });
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(f.writer.checkpoint());
    expect(f.writer.recoveredSnapshot()).toEqual(before.desired);
    await expect(f.controller!.add('Unavailable', 3)).rejects.toThrow('not current');
  } finally { vi.restoreAllMocks(); await f.close(); }
});

it('cleans a committed deletion in ACK and live metadata using only its existing checked receipt binding', async () => {
  let f!: ReturnType<typeof fixture>;
  f = fixture(true, { write: async (intent, checkpoint) => {
    intent.renderId ??= crypto.randomUUID();
    await checkpoint();
    return membershipResult(f.writer.checkpoint().source, intent, 'b'.repeat(64));
  } });
  try {
    await f.controller!.remove('2');
    await f.writer.flush();
    expect(f.writer.state().error).toBeNull();
    expect(f.writer.state().dirty).toBe(false);
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    expect(before.acknowledged.custom?.[WORKBOOK_SHEET_REMOVALS]).toBeDefined();
    expect(matchesWorkbookSourceSnapshot(before, sourceDeleteScope, before.source)).toBe(true);
    expect(await f.controller!.retireObsoleteSelectors()).toMatchObject({ retiredSelectors: 1 });
    const after = f.writer.checkpoint();
    expect(after.source).toEqual(before.source);
    expect(after.sourceAcknowledgement).toEqual(before.sourceAcknowledgement);
    expect(after.sourceSnapshotBinding?.acknowledgedSha256).not.toBe(before.sourceSnapshotBinding?.acknowledgedSha256);
    const { acknowledgedSha256: _beforeHash, ...beforeIdentity } = before.sourceSnapshotBinding!;
    const { acknowledgedSha256: _afterHash, ...afterIdentity } = after.sourceSnapshotBinding!;
    expect(afterIdentity).toEqual(beforeIdentity);
    expect(matchesWorkbookSourceSnapshot(after, sourceDeleteScope, after.source)).toBe(true);
    expect(after.acknowledged.custom?.[WORKBOOK_SHEET_REMOVALS]).toBeUndefined();
    expect(after.desired.custom?.[WORKBOOK_SHEET_REMOVALS]).toBeUndefined();
    expect(after.sheetDeletions).toBeUndefined();
    expect(f.book.save()).toEqual(after.desired);
    expect(f.writer.state().dirty).toBe(false);
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(after);
  } finally { await f.close(); }
});

it('leaves pending snapshot, intent, and provisional creation associations byte-for-byte unchanged', async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const f = fixture(true, { write: async () => { started(); await gate; throw Error('Owned uncertain response'); } });
  let saving: Promise<void> | undefined;
  try {
    await f.controller!.add('Pending owner', 3);
    saving = f.writer.flush();
    await entered;
    await f.controller!.remove('4');
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    expect(await f.controller!.retireObsoleteSelectors()).toMatchObject({ retiredSelectors: 0 });
    expect(f.writer.checkpoint()).toEqual(before);
    expect(JSON.stringify(f.writer.checkpoint().pending)).toBe(JSON.stringify(before.pending));
  } finally { release(); await saving; await f.close(); }
});

it('keeps old and new whole draft branches decodable at the metadata transaction boundary without recovered issuance', async () => {
  const f = fixture(true);
  let recovered: WorkbookWriter | undefined;
  let replacement: WorkbookSheetHistoryController | undefined;
  try {
    await f.controller!.add('Boundary birth', 3);
    const native = structuredClone(f.history.pitchTopUndoElement()!);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    expect(decodeWorkbookDraft(encodeWorkbookDraft(sourceDeleteScope, before), sourceDeleteScope)).toEqual(before);
    let persistedCandidate: ReturnType<typeof f.writer.checkpoint> | undefined;
    const put = IDBObjectStore.prototype.put;
    const capture = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'workbooks' && typeof value === 'string') persistedCandidate = decodeWorkbookDraft(JSON.parse(value), sourceDeleteScope);
      return Reflect.apply(put, this, [value, key]);
    });
    await f.controller!.retireObsoleteSelectors();
    capture.mockRestore();
    const after = await readWorkbookDraft(sourceDeleteScope);
    expect(persistedCandidate).toEqual(after);
    expect(after?.sheetBirths?.entries).toEqual([]);
    expect(decodeWorkbookDraft(encodeWorkbookDraft(sourceDeleteScope, after!), sourceDeleteScope)).toEqual(after);
    // Recovery constructs fresh private state. A copied old native item does
    // not regain its original live birth issuer from either decoded branch.
    f.controller!.dispose();
    recovered = new WorkbookWriter(after!.source, after!.acknowledged, async () => { throw Error('No transport'); }, () => {}, undefined, { restored: after!, save: async () => { throw Error('Recovered history must not persist'); } });
    replacement = new WorkbookSheetHistoryController(f.univer, recovered, sourceDeleteScope, () => f.book.save(), () => true);
    f.history.pushUndoRedo({ unitID: f.book.getId(), undoMutations: native.undoMutations, redoMutations: native.redoMutations });
    await expect(f.api.undo()).rejects.toThrow('no live birth issuer');
  } finally { vi.restoreAllMocks(); replacement?.dispose(); await recovered?.close(); await f.close(); }
});

it('keeps the full Add Undo recovery pool durable while its real native Redo item remains live', async () => {
  const f = fixture(true);
  try {
    await f.controller!.add('Durable native redo', 3);
    await f.api.undo();
    expect(f.history.getUndoRedoEntryIds(f.book.getId()).redos).toHaveLength(1);
    const state = f.writer.checkpoint();
    expect(state.sheetBirths?.removals).toHaveLength(1);
    await expect.poll(() => readWorkbookDraft(sourceDeleteScope), { timeout: 300 }).toEqual(state);
  } finally { await f.close(); }
});

it('keeps unrelated SDK custom changes even without a later command observer before rollback', async () => {
  const f = fixture(true);
  try {
    await f.controller!.add('Custom rollback', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    const unit = f.univer.__getInjector().get(IUniverInstanceService).getUnit<Workbook>(f.book.getId())!;
    const commit = vi.spyOn(IDBTransaction.prototype, 'commit').mockImplementationOnce(() => {
      unit.setCustomMetadata({ ...unit.getCustomMetadata(), retainedWithoutMutation: 42 });
      throw new DOMException('Owned abort with custom metadata', 'InvalidStateError');
    });
    await expect(f.controller!.retireObsoleteSelectors()).rejects.toThrow('transaction did not commit');
    commit.mockRestore();
    expect(f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toEqual(before.desired.custom?.[WORKBOOK_SHEET_REMOVALS]);
    expect(f.book.save().custom?.retainedWithoutMutation).toBe(42);
    expect(f.writer.checkpoint().desired).toEqual(f.book.save());
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(f.writer.checkpoint());
  } finally { vi.restoreAllMocks(); await f.close(); }
});

it('never applies rollback metadata to a replacement kernel that reuses the same public workbook ID', async () => {
  const f = fixture(true);
  try {
    await f.controller!.add('Replaced cleanup', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    let replacement: ReturnType<typeof f.api.createWorkbook> | undefined;
    const commit = vi.spyOn(IDBTransaction.prototype, 'commit').mockImplementationOnce(() => {
      expect(f.api.disposeUnit(f.book.getId())).toBe(true);
      replacement = f.api.createWorkbook({ ...structuredClone(before.acknowledged), custom: { ...before.acknowledged.custom, newOwner: true } });
      throw new DOMException('Owned replacement abort', 'InvalidStateError');
    });
    await expect(f.controller!.retireObsoleteSelectors()).rejects.toThrow('transaction did not commit');
    commit.mockRestore();
    expect(replacement!.save().custom?.newOwner).toBe(true);
    expect(replacement!.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toBeUndefined();
    expect(f.writer.checkpoint()).toEqual({ ...before, sheetActionConflict: true });
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(f.writer.checkpoint());
  } finally { vi.restoreAllMocks(); await f.close(); }
});

it.each(['focus', 'lease'])('keeps committed live/Writer metadata consistent after postcommit %s loss and rejects copied old origins', async withdrawal => {
  let current = true;
  let afterCommit: (() => void) | undefined;
  const f = fixture(true, { current: () => current, afterCommit: () => afterCommit?.() });
  try {
    await f.controller!.add('Committed cleanup', 3);
    const native = structuredClone(f.history.pitchTopUndoElement()!);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const instances = f.univer.__getInjector().get(IUniverInstanceService);
    const other = f.api.createWorkbook({ id: 'postcommit-selector-other', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Other', rowCount: 10, columnCount: 10 } } });
    instances.focusUnit(f.book.getId());
    afterCommit = () => { if (withdrawal === 'lease') current = false; else instances.focusUnit(other.getId()); };
    await expect(f.controller!.retireObsoleteSelectors()).rejects.toThrow('history changed');
    expect(f.writer.checkpoint().sheetBirths?.entries).toEqual([]);
    expect(f.book.save()).toEqual(f.writer.checkpoint().desired);
    expect(f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]).toBeUndefined();
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(f.writer.checkpoint());
    afterCommit = undefined;
    current = true;
    instances.focusUnit(f.book.getId());
    f.history.pushUndoRedo({ unitID: f.book.getId(), undoMutations: native.undoMutations, redoMutations: native.redoMutations });
    await expect(f.api.undo()).rejects.toThrow('no live birth issuer');
  } finally { await f.close(); }
});

it('allows clean-resume capture to await rejection-settled maintenance without starting work or flushing a save', async () => {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let blocking = false, current = true;
  const f = fixture(true, { current: () => current, save: async () => { if (blocking) { entered(); await gate; } } });
  let retiring: Promise<unknown> | undefined;
  try {
    await f.controller!.add('Paused cleanup', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    blocking = true;
    retiring = f.controller!.retireObsoleteSelectors();
    void retiring.catch(() => {});
    await waiting;
    current = false; // History working gate withdraws operational admission.
    let settled = false;
    const drain = f.controller!.settleMaintenance().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    blocking = false;
    release();
    await expect(retiring).rejects.toThrow('transaction did not commit');
    await drain;
    expect(settled).toBe(true);
    expect(f.writer.checkpoint()).toEqual(before);
    await f.controller!.settleMaintenance();
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(before);
  } finally { blocking = false; release(); await retiring?.catch(() => {}); await f.close(); }
});

it.each(['history', 'lease'])('aborts before live apply when %s changes while the cleaned checkpoint waits for storage', async withdrawal => {
  let entered!: () => void;
  let release!: () => void;
  const enteredStorage = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let blocking = false, current = true;
  const f = fixture(true, { current: () => current, save: async state => {
    if (blocking && state && !state.desired.custom?.[WORKBOOK_SHEET_REMOVALS]) { entered(); await gate; }
  } });
  let retiring: Promise<unknown> | undefined;
  try {
    await f.controller!.add('Preapply owner', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    blocking = true;
    retiring = f.controller!.retireObsoleteSelectors();
    void retiring.catch(() => {});
    await enteredStorage;
    if (withdrawal === 'lease') current = false;
    else f.history.pushUndoRedo({ unitID: f.book.getId(), undoMutations: [], redoMutations: [{ id: 'opaque-unissued', params: {} }] });
    blocking = false;
    release();
    await expect(retiring).rejects.toThrow('transaction did not commit');
    expect(f.book.save()).toEqual(before.desired);
    expect(f.writer.checkpoint()).toEqual(before);
    expect(await readWorkbookDraft(sourceDeleteScope)).toEqual(before);
  } finally { blocking = false; release(); await retiring?.catch(() => {}); await f.close(); }
});

it('does not clear a recovered selector merely because its decoded origin matches the stored pool', async () => {
  const f = fixture(true);
  let recovered: WorkbookWriter | undefined;
  let replacement: WorkbookSheetHistoryController | undefined;
  try {
    await f.controller!.add('Recovered data only', 3);
    await f.api.undo();
    f.history.clearUndoRedo(f.book.getId());
    const before = f.writer.checkpoint();
    f.controller!.dispose();
    recovered = new WorkbookWriter(before.source, before.acknowledged, async () => { throw Error('No transport'); }, () => {}, undefined, {
      scope: sourceDeleteScope, restored: before, isCurrent: () => true,
      validate: checkpoint => { encodeWorkbookDraft(sourceDeleteScope, checkpoint); },
      save: checkpoint => saveWorkbookDraft(sourceDeleteScope, checkpoint),
      saveGuarded: (checkpoint, protection) => saveWorkbookDraft(sourceDeleteScope, checkpoint, protection.guard, protection.beforeCommit),
    });
    replacement = new WorkbookSheetHistoryController(f.univer, recovered, sourceDeleteScope, () => f.book.save(), () => true);
    expect(await replacement.retireObsoleteSelectors()).toEqual({ retiredSelectors: 0, retiredIssuers: 0 });
    expect(recovered.checkpoint()).toEqual(before);
    expect(f.book.save()).toEqual(before.desired);
  } finally { replacement?.dispose(); await recovered?.close(); await f.close(); }
});
