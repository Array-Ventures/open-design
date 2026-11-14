// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommandType, type IWorkbookData } from '@univerjs/core';
import { WorkbookSheetHistoryController } from '../../src/components/embedded/workbook/sheet-history-controller';
import { useWorkbookEditor } from '../../src/components/embedded/workbook/use-workbook-editor';
import { createSourceDeleteHistoryFixture, sourceDeleteScope as scope } from '../helpers/workbook-source-delete-fixture';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import type { WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
import { isIssuedWorkbookMembershipWriterLease, type WorkbookMembershipWriterLease } from '../../src/components/embedded/workbook/membership-writer-lease';
import type { WorkbookSaveAttempt } from '../../src/components/embedded/workbook/save-transport';
const host = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock('../../src/components/embedded/workbook/save-transport', async original => ({ ...await original<object>(), saveWorkbook: host.save }));
vi.mock('../../src/components/embedded/workbook/preview-transport', () => ({ loadWorkbookPreview: host.load }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

it('binds the real controller to the exact live Writer lease and refuses after close before native pop', async () => {
  const f = createSourceDeleteHistoryFixture(false), save = vi.fn(async (_state: WorkbookCheckpoint | null) => {});
  let current = true;
  const journal = { scope, isCurrent: () => current, validate: (checkpoint: WorkbookCheckpoint) => { serializeWorkbookDraft(scope, checkpoint); }, save };
  const hook = renderHook(() => useWorkbookEditor(scope.projectId, scope.fileName, f.source, vi.fn(), undefined, journal));
  let controller: WorkbookSheetHistoryController | undefined;
  const observer = f.commands.onCommandExecuted(command => { if (command.type === CommandType.MUTATION) hook.result.current.snapshot(f.book.save()); });
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    const lease = hook.result.current.membershipLease();
    expect(lease?.isCurrent()).toBe(true);
    expect(isIssuedWorkbookMembershipWriterLease(lease!)).toBe(true);
    expect(isIssuedWorkbookMembershipWriterLease({ ...lease! })).toBe(false);
    controller = new WorkbookSheetHistoryController(f.univer, lease!.writer, lease!.scope, () => f.book.save(), () => lease!.isCurrent());
    await act(async () => { await controller!.remove('2'); });
    expect(f.book.save().sheets['2']).toBeUndefined();
    const native = f.history.getUndoRedoCheckpoint(), before = f.book.save();
    current = false;
    await expect(f.api.undo()).rejects.toThrow(/current|lease/);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(native); expect(f.book.save()).toEqual(before);
    current = true;
    await act(async () => { await f.api.undo(); await hook.result.current.close(); });
    expect(lease!.isCurrent()).toBe(false); expect(hook.result.current.membershipLease()).toBeNull();
    const closed = f.history.getUndoRedoCheckpoint();
    await expect(f.api.redo()).rejects.toThrow(/current/);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(closed);
    expect(save).toHaveBeenCalled(); expect(host.save).not.toHaveBeenCalled();
  } finally { observer.dispose(); controller?.dispose(); hook.unmount(); await f.close(); }
});

it('keeps the same lease during checked own-ACK publication and retires it for an external preview identity', async () => {
  const f = createSourceDeleteHistoryFixture(false);
  const target = structuredClone(f.source); target.sourceSha256 = 'b'.repeat(64); target.model.sheets[0]!.cells[0]!.value = 22;
  const journal = { scope, isCurrent: () => true, validate: (checkpoint: WorkbookCheckpoint) => { serializeWorkbookDraft(scope, checkpoint); }, save: async () => {} };
  host.save.mockImplementation(async (attempt: WorkbookSaveAttempt, _signal: AbortSignal, prepared?: () => Promise<void>) => {
    attempt.renderId ??= crypto.randomUUID(); await prepared?.();
    return { id: attempt.operationId, projectId: scope.projectId, fileName: scope.fileName, renderId: attempt.renderId, state: 'applied', sourceSha256: f.source.sourceSha256, targetSha256: target.sourceSha256, actualSha256: target.sourceSha256, sourceVersionId: 'before-own-ack', versionId: 'after-own-ack' };
  });
  host.load.mockResolvedValue(target);
  let lease: WorkbookMembershipWriterLease | null = null;
  const synchronousPublicationChecks: boolean[] = [];
  const hook = renderHook(({ source }) => useWorkbookEditor(scope.projectId, scope.fileName, source, saved => {
    synchronousPublicationChecks.push(Boolean(lease?.isCurrent()));
    hook.rerender({ source: saved });
    synchronousPublicationChecks.push(Boolean(lease?.isCurrent()));
  }, undefined, journal), { initialProps: { source: f.source } });
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    lease = hook.result.current.membershipLease(); expect(lease?.isCurrent()).toBe(true);
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(22);
    await act(async () => { hook.result.current.snapshot(f.book.save());
      window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId: scope.projectId, controllerId: hook.result.current.controllerId, action: 'save' } })); });
    await waitFor(() => expect(hook.result.current.state.dirty).toBe(false));
    expect(synchronousPublicationChecks).toEqual([true, true]);
    expect(hook.result.current.membershipLease()).toBe(lease); expect(lease!.isCurrent()).toBe(true);
    hook.rerender({ source: structuredClone(target) });
    expect(lease!.isCurrent()).toBe(false);
  } finally { hook.unmount(); await f.close(); }
});

it('withdraws the Writer before any later save and retains its original pending checkpoint for recovery', async () => {
  const f = createSourceDeleteHistoryFixture(false), stored: (WorkbookCheckpoint | null)[] = [];
  const journal = { scope, isCurrent: () => true, validate: (checkpoint: WorkbookCheckpoint) => { serializeWorkbookDraft(scope, checkpoint); }, save: async (checkpoint: WorkbookCheckpoint | null) => { stored.push(structuredClone(checkpoint)); } };
  let rejectSave!: (error: Error) => void;
  host.save.mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
  const hook = renderHook(() => useWorkbookEditor(scope.projectId, scope.fileName, f.source, vi.fn(), undefined, journal));
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    const lease = hook.result.current.membershipLease()!;
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(22);
    act(() => { hook.result.current.snapshot(f.book.save()); window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId: scope.projectId, controllerId: hook.result.current.controllerId, action: 'save' } })); });
    await waitFor(() => expect(host.save).toHaveBeenCalledTimes(1));
    const pending = structuredClone(lease.writer.checkpoint().pending);
    act(() => { lease.withdraw(); });
    expect(lease.isCurrent()).toBe(false); expect(hook.result.current.checkpoint()?.pending).toEqual(pending);
    rejectSave(Error('Owned interrupted transport'));
    await act(async () => { await lease.writer.close(); });
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId: scope.projectId, controllerId: hook.result.current.controllerId, action: 'save' } })); });
    expect(host.save).toHaveBeenCalledTimes(1);
    expect(stored.at(-1)?.pending).toEqual(pending);
    expect(hook.result.current.state).toMatchObject({ dirty: true, error: expect.stringContaining('calculation stopped') });
  } finally { hook.unmount(); await f.close(); }
});

it('holds transport behind the bound calculation admission while preserving the real frozen pending intent', async () => {
  const f = createSourceDeleteHistoryFixture(false), stored: (WorkbookCheckpoint | null)[] = [];
  const journal = { scope, isCurrent: () => true, validate: (checkpoint: WorkbookCheckpoint) => { serializeWorkbookDraft(scope, checkpoint); }, save: async (checkpoint: WorkbookCheckpoint | null) => { stored.push(structuredClone(checkpoint)); } };
  let release!: () => void;
  const applied = new Promise<void>(resolve => { release = resolve; });
  const hook = renderHook(() => useWorkbookEditor(scope.projectId, scope.fileName, f.source, vi.fn(), undefined, journal));
  host.save.mockRejectedValue(Error('Owned offline stand-in'));
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    const lease = hook.result.current.membershipLease()!;
    const unbind = lease.bindCalculation(() => applied);
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(22);
    act(() => { hook.result.current.snapshot(f.book.save()); window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId: scope.projectId, controllerId: hook.result.current.controllerId, action: 'save' } })); });
    await waitFor(() => expect(stored.some(checkpoint => Boolean(checkpoint?.pending))).toBe(true));
    const pending = structuredClone(lease.writer.checkpoint().pending);
    expect(pending).not.toBeNull(); expect(host.save).not.toHaveBeenCalled();
    release(); await waitFor(() => expect(host.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.state.saving).toBe(false));
    expect(lease.writer.checkpoint().pending).toEqual(pending);
    unbind();
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId: scope.projectId, controllerId: hook.result.current.controllerId, action: 'save' } })); });
    expect(host.save).toHaveBeenCalledTimes(1); // a removed binding never becomes the old unguarded path
    expect(lease.writer.checkpoint().pending).toEqual(pending);
  } finally { release(); hook.unmount(); await f.close(); }
});

it('retains preparation identity checkpoints that finish while a withdrawn Writer drains', async () => {
  const f = createSourceDeleteHistoryFixture(false);
  const journal = { scope, isCurrent: () => true, validate: (checkpoint: WorkbookCheckpoint) => { serializeWorkbookDraft(scope, checkpoint); }, save: async (_checkpoint: WorkbookCheckpoint | null) => {} };
  let release!: () => void;
  const progress = new Promise<void>(resolve => { release = resolve; });
  const renderId = crypto.randomUUID();
  host.save.mockImplementation(async (attempt: WorkbookSaveAttempt, _signal: AbortSignal, prepared?: () => Promise<void>) => {
    await progress; attempt.renderId = renderId; await prepared?.();
    throw Error('Owned admitted response was interrupted');
  });
  const hook = renderHook(() => useWorkbookEditor(scope.projectId, scope.fileName, f.source, vi.fn(), undefined, journal));
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    const lease = hook.result.current.membershipLease()!;
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(22);
    act(() => { hook.result.current.snapshot(f.book.save()); window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId: scope.projectId, controllerId: hook.result.current.controllerId, action: 'save' } })); });
    await waitFor(() => expect(host.save).toHaveBeenCalledTimes(1));
    const original = structuredClone(lease.writer.checkpoint().pending);
    act(() => { lease.withdraw(); });
    release(); await act(async () => { await lease.writer.close(); });
    expect(lease.writer.checkpoint().pending?.intent.renderId).toBe(renderId);
    expect(hook.result.current.checkpoint()?.pending).toEqual(lease.writer.checkpoint().pending);
    expect(hook.result.current.checkpoint()?.pending?.intent.id).toBe(original?.intent.id);
    expect(hook.result.current.checkpoint()?.pending?.intent.plan).toEqual(original?.intent.plan);
  } finally { release(); hook.unmount(); await f.close(); }
});

it.each(['stale-source', 'same-hash-model-tamper'] as const)('keeps recovered %s data inert until a checked authoritative baseline is available', async variant => {
  const donor = createSourceDeleteHistoryFixture(false);
  const source = structuredClone(donor.source);
  if (variant === 'same-hash-model-tamper') source.model.sheets[0]!.cells[0]!.value = 999;
  const { WorkbookWriter } = await import('../../src/components/embedded/workbook/workbook-writer');
  const { gridWorkbook } = await import('../../src/components/embedded/workbook/grid-model');
  const { seedWorkbookStructureIdentity } = await import('../../src/components/embedded/workbook/grid-structure-identity');
  const { decodeWorkbookDraft } = await import('../../src/components/embedded/workbook/workbook-checkpoint');
  const baseline = seedWorkbookStructureIdentity(gridWorkbook(source.model, `${scope.projectId}:${scope.fileName}`, 'Recovery').data as typeof donor.initial, source.sourceSha256);
  await donor.close();
  const f = createSourceDeleteHistoryFixture(false, { initial: baseline });
  const pendingWriter = new WorkbookWriter(source, f.book.save(), async () => { throw Error('Owned original response was lost'); }, () => {}, undefined, { scope, isCurrent: () => true, validate: checkpoint => { serializeWorkbookDraft(scope, checkpoint); }, save: async () => {} });
  f.book.getSheetBySheetId('1')!.getRange('A1').setValue(22);
  pendingWriter.update(f.book.save()); await pendingWriter.flush();
  const restored = decodeWorkbookDraft(JSON.parse(serializeWorkbookDraft(scope, pendingWriter.checkpoint())), scope);
  await pendingWriter.close();
  const fresh = structuredClone(f.source);
  if (variant === 'stale-source') { fresh.sourceSha256 = 'b'.repeat(64); fresh.model.sheets[0]!.cells[0]!.value = 22; fresh.model.sheets[2]!.cells[1]!.value = 39; }
  const journal = { scope, restored, isCurrent: () => true, validate: (checkpoint: WorkbookCheckpoint) => { serializeWorkbookDraft(scope, checkpoint); }, save: async () => {} };
  const hook = renderHook(({ source }) => useWorkbookEditor(scope.projectId, scope.fileName, source, saved => hook.rerender({ source: saved }), undefined, journal), { initialProps: { source: fresh } });
  let controller: WorkbookSheetHistoryController | undefined;
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    const lease = hook.result.current.membershipLease()!;
    expect(lease.isOwned()).toBe(true); expect(lease.isCurrent()).toBe(false);
    controller = new WorkbookSheetHistoryController(f.univer, lease.writer, lease.scope, () => f.book.save(), () => lease.isCurrent());
    const before = f.book.save(), native = f.history.getUndoRedoCheckpoint();
    await expect(controller.remove('2')).rejects.toThrow('not current');
    expect(f.book.save()).toEqual(before); expect(f.history.getUndoRedoCheckpoint()).toEqual(native);
    expect(host.save).not.toHaveBeenCalled();
    if (variant === 'stale-source') {
      host.save.mockImplementation(async (attempt: WorkbookSaveAttempt, _signal: AbortSignal, prepared?: () => Promise<void>) => {
        expect(attempt.operationId).toBe(restored.pending!.intent.id);
        attempt.renderId ??= crypto.randomUUID(); await prepared?.();
        return { id: attempt.operationId, projectId: scope.projectId, fileName: scope.fileName, renderId: attempt.renderId, state: 'applied', sourceSha256: restored.source.sourceSha256, targetSha256: fresh.sourceSha256, actualSha256: fresh.sourceSha256, sourceVersionId: 'checked-original-source', versionId: 'checked-reconciled-target' };
      });
      host.load.mockResolvedValue(fresh);
      const unbind = lease.bindCalculation(async () => {}); // inert lifetime may reconcile; this is not operational issuance
      await act(async () => { window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId: scope.projectId, controllerId: hook.result.current.controllerId, action: 'save' } })); });
      await waitFor(() => expect(hook.result.current.state).toMatchObject({ dirty: false, error: null }));
      expect(hook.result.current.membershipLease()).toBe(lease); expect(lease.isCurrent()).toBe(true);
      expect(lease.writer.checkpoint().source.sourceSha256).toBe(fresh.sourceSha256);
      expect(lease.writer.checkpoint().pending).toBeNull(); unbind();
    }
  } finally { controller?.dispose(); hook.unmount(); await f.close(); }
});

it.each(['legacy-receipt', 'unsupported-target'] as const)('withdraws operational membership after %s without inventing authority from the old kernel', async variant => {
  const f = createSourceDeleteHistoryFixture(false);
  const target = structuredClone(f.source); target.sourceSha256 = 'b'.repeat(64); target.model.sheets[0]!.cells[0]!.value = 22;
  if (variant === 'unsupported-target') target.model.worksheetMembershipEditable = false;
  const journal = { scope, isCurrent: () => true, validate: (checkpoint: WorkbookCheckpoint) => { serializeWorkbookDraft(scope, checkpoint); }, save: async () => {} };
  host.save.mockImplementation(async (attempt: WorkbookSaveAttempt, _signal: AbortSignal, prepared?: () => Promise<void>) => {
    attempt.renderId ??= crypto.randomUUID(); await prepared?.();
    return { id: attempt.operationId, projectId: scope.projectId, fileName: scope.fileName, renderId: attempt.renderId, state: 'applied', sourceSha256: f.source.sourceSha256, targetSha256: target.sourceSha256, actualSha256: target.sourceSha256, sourceVersionId: variant === 'legacy-receipt' ? null : 'checked-source', versionId: 'checked-target' };
  });
  host.load.mockResolvedValue(target);
  const hook = renderHook(({ source }) => useWorkbookEditor(scope.projectId, scope.fileName, source, saved => hook.rerender({ source: saved }), undefined, journal), { initialProps: { source: f.source } });
  let controller: WorkbookSheetHistoryController | undefined;
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    const lease = hook.result.current.membershipLease()!; expect(lease.isCurrent()).toBe(true);
    controller = new WorkbookSheetHistoryController(f.univer, lease.writer, lease.scope, () => f.book.save(), () => lease.isCurrent());
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(22);
    await act(async () => { hook.result.current.snapshot(f.book.save()); window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:workbook-control', projectId: scope.projectId, controllerId: hook.result.current.controllerId, action: 'save' } })); });
    await waitFor(() => expect(hook.result.current.state.dirty).toBe(false));
    expect(lease.isOwned()).toBe(true); expect(lease.isCurrent()).toBe(false);
    const before = f.book.save(), native = f.history.getUndoRedoCheckpoint();
    await expect(controller.remove('2')).rejects.toThrow('not current');
    expect(f.book.save()).toEqual(before); expect(f.history.getUndoRedoCheckpoint()).toEqual(native);
  } finally { controller?.dispose(); hook.unmount(); await f.close(); }
});

it('keeps a quarantined recovery branch owned but never operationally current', async () => {
  const f = createSourceDeleteHistoryFixture(false);
  const journal = { scope, isCurrent: () => true, validate: (checkpoint: WorkbookCheckpoint) => { serializeWorkbookDraft(scope, checkpoint); }, save: async () => {} };
  const hook = renderHook(() => useWorkbookEditor(scope.projectId, scope.fileName, f.source, vi.fn(), undefined, journal));
  let controller: WorkbookSheetHistoryController | undefined;
  const { RemoveSheetMutation } = await import('@univerjs/sheets');
  const observer = f.commands.onCommandExecuted(command => {
    if (command.id === RemoveSheetMutation.id) f.book.getSheetBySheetId('1')!.getRange('A1').setValue(999);
    hook.result.current.snapshot(f.book.save());
  });
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    const lease = hook.result.current.membershipLease()!;
    controller = new WorkbookSheetHistoryController(f.univer, lease.writer, lease.scope, () => f.book.save(), () => lease.isCurrent());
    await act(async () => { await expect(controller!.remove('2')).rejects.toThrow('needs recovery'); });
    expect(lease.isOwned()).toBe(true); expect(lease.isCurrent()).toBe(false);
    expect(lease.writer.checkpoint().sheetActionConflict).toBe(true);
    expect(host.save).not.toHaveBeenCalled();
  } finally { observer.dispose(); controller?.dispose(); hook.unmount(); await f.close(); }
});

it.each(['clean', 'uncertain', 'other-operation', 'revoked', 'external', 'replacement', 'ordinary-save'] as const)('hands a confirmed no-effect History pause back to the same actual RPC kernel and private native birth: %s', async mode => {
  const { NodeWorkbookWorker } = await import('../helpers/workbook-node-worker');
  const { createWorkbookMembershipRpcFixture } = await import('../helpers/workbook-membership-rpc-fixture');
  const { bindWorkbookCleanResumeOwner } = await import('../../src/components/embedded/workbook/clean-resume-owner');
  const { blankWorkbookSheet } = await import('../../src/components/embedded/workbook/sheet-birth-context');
  const { gridWorkbook } = await import('../../src/components/embedded/workbook/grid-model');
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  f.controller.dispose(); await f.writer.close();
  const original = { model: f.model, sourceSha256: 'a'.repeat(64) };
  const target = structuredClone(original); target.sourceSha256 = 'b'.repeat(64);
  target.model.sheets.push(blankWorkbookSheet('4', 'Fourth'));
  let loaded = target;
  host.save.mockImplementation(async (attempt: WorkbookSaveAttempt, _signal: AbortSignal, prepared?: () => Promise<void>) => {
    attempt.renderId ??= crypto.randomUUID(); await prepared?.();
    loaded = attempt.plan.sourceSha256 === original.sourceSha256 ? target : original;
    return { id: attempt.operationId, projectId: f.scope.projectId, fileName: f.scope.fileName, renderId: attempt.renderId,
      state: 'applied', sourceSha256: attempt.plan.sourceSha256, targetSha256: loaded.sourceSha256, actualSha256: loaded.sourceSha256,
      sourceVersionId: loaded === target ? 'before-birth' : 'after-birth', versionId: loaded === target ? 'after-birth' : 'after-undo' };
  });
  host.load.mockImplementation(async () => loaded);
  const records: Array<WorkbookCheckpoint | null> = [];
  let journalCurrent = true;
  const journal = { scope: f.scope, isCurrent: () => journalCurrent, validate: (value: WorkbookCheckpoint) => { serializeWorkbookDraft(f.scope, value); },
    save: async (value: WorkbookCheckpoint | null) => { records.push(structuredClone(value)); } };
  let currentSource = original;
  let hook!: ReturnType<typeof renderHook<ReturnType<typeof useWorkbookEditor>, { blocked: boolean }>>;
  const accepted = (next: typeof original) => {
    currentSource = next;
    f.calculation.rebaseSource(next.model, gridWorkbook(next.model, f.book.getId(), 'Membership').data as IWorkbookData, f.book.save());
    hook.rerender({ blocked: false });
  };
  hook = renderHook(({ blocked }) => useWorkbookEditor(f.scope.projectId, f.scope.fileName, currentSource, accepted, undefined, journal, undefined,
    { open: blocked, blocked, show() {} }), { initialProps: { blocked: false as boolean } });
  let live: WorkbookMembershipWriterLease | null = null;
  let controller: WorkbookSheetHistoryController | undefined;
  let release: (() => void) | undefined;
  const observer = f.commands.onCommandExecuted(command => { if (command.type === CommandType.MUTATION) hook.result.current.snapshot(f.book.save()); });
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    live = hook.result.current.membershipLease()!;
    controller = new WorkbookSheetHistoryController(f.univer, live.writer, live.scope, () => f.book.save(), () => live?.isCurrent() === true, f.calculation.runProtectedSequence);
    const resetKernel = vi.fn();
    const bound = bindWorkbookCleanResumeOwner(live, { controller, calculation: f.calculation, snapshot: () => f.book.save(),
      ownerCurrent: () => live?.isQualified() === true && f.owner.ready, qualified: () => live?.isQualified() === true && f.owner.ready, currentLease: () => hook.result.current.membershipLease(), setLease: next => { live = next; }, resetKernel });
    release = () => bound.dispose();
    await act(async () => { await controller!.add('Fourth', 3); await live!.writer.flush(); });
    expect(hook.result.current.state.dirty).toBe(false);
    // Leave an ordinary cell Redo entry above the protected native birth.
    await act(async () => {
      f.book.getSheetBySheetId('1')!.getRange('A1').setValue(22);
      await f.calculation.awaitQuiescent();
      await f.api.undo(); await f.calculation.awaitQuiescent();
    });
    expect(hook.result.current.state.dirty).toBe(false);
    const before = f.book.save(), native = f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint();
    const worker = f.owner.worker, previousWriter = live.writer;
    if (mode === 'ordinary-save') {
      const { SetRangeValuesMutation } = await import('@univerjs/sheets');
      const held: unknown[] = [];
      let holding = true;
      const contains = (value: unknown): boolean => value === SetRangeValuesMutation.id || Boolean(value && typeof value === 'object' && Object.values(value).some(contains));
      f.worker.acceptIncoming = message => { if (holding && contains(message)) { if (!held.includes(message)) held.push(message); return false; } return true; };
      await act(async () => { f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19); });
      await vi.waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 5000 });
      expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(38);
      expect(f.statuses.at(-1)?.phase).toBe('pending');
      const ordinary = structuredClone(target); ordinary.sourceSha256 = 'c'.repeat(64);
      ordinary.model.sheets[1]!.cells[0]!.value = 19; ordinary.model.sheets[2]!.cells[1]!.value = 40;
      let atTransport: { value: unknown; phase: string | undefined } | undefined;
      host.save.mockImplementationOnce(async (attempt: WorkbookSaveAttempt, _signal: AbortSignal, prepared?: () => Promise<void>) => {
        atTransport = { value: f.book.save().sheets['3']!.cellData![1]![0]!.v, phase: f.statuses.at(-1)?.phase };
        loaded = ordinary; attempt.renderId ??= crypto.randomUUID(); await prepared?.();
        return { id: attempt.operationId, projectId: f.scope.projectId, fileName: f.scope.fileName, renderId: attempt.renderId,
          state: 'applied', sourceSha256: attempt.plan.sourceSha256, targetSha256: ordinary.sourceSha256, actualSha256: ordinary.sourceSha256,
          sourceVersionId: 'after-birth', versionId: 'after-ordinary' };
      });
      let saving!: Promise<void>;
      await act(async () => { saving = live!.writer.flush(); void saving.catch(() => {}); });
      expect(host.save).toHaveBeenCalledTimes(1); expect(hook.result.current.state.saving).toBe(true);
      holding = false; for (const message of held) f.worker.thread.emit('message', message);
      await act(async () => { await saving; });
      expect(host.save).toHaveBeenCalledTimes(2); expect(atTransport).toEqual({ value: 40, phase: 'live' });
      expect(hook.result.current.state.error).toBeNull(); expect(live.writer.checkpoint().source.sourceSha256).toBe(ordinary.sourceSha256);
      expect(f.owner.ready).toBe(true); expect(resetKernel).not.toHaveBeenCalled(); return;
    }
    if (mode === 'replacement') {
      await act(async () => { await hook.result.current.ready(f.book.save()); });
      const replacement = hook.result.current.membershipLease()!;
      bound.observeLease(replacement); bound.observeLease(replacement);
      expect(resetKernel).toHaveBeenCalledOnce();
      expect(replacement.writer).not.toBe(previousWriter); expect(live.writer).toBe(previousWriter);
      await expect(f.api.undo()).rejects.toThrow();
      expect(f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint()).toEqual(native);
      expect(f.book.save()).toEqual(before); expect(host.save).toHaveBeenCalledTimes(1);
      return;
    }
    const operationId = crypto.randomUUID();
    hook.rerender({ blocked: true });
    await act(async () => { expect(await hook.result.current.pause({ projectId: f.scope.projectId, fileName: f.scope.fileName, operationId, sourceSha256: target.sourceSha256 })).toBe(true); });
    expect(live.isOwned()).toBe(false);
    await expect(f.api.redo()).rejects.toThrow();
    expect(f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint()).toEqual(native);
    expect(() => f.book.getSheetBySheetId('1')!.getRange('A1').setValue(999)).toThrow('paused');
    const evidence = { projectId: f.scope.projectId, fileName: f.scope.fileName, operationId, sourceSha256: target.sourceSha256, outcome: 'cancelled' as const };
    if (mode === 'uncertain' || mode === 'other-operation') {
      await act(async () => {
        if (mode === 'uncertain') await hook.result.current.resumeClean(false);
        else await expect(hook.result.current.resumeClean(false, { ...evidence, operationId: crypto.randomUUID() })).rejects.toThrow('operation changed');
      });
      expect(hook.result.current.membershipLease()).toBeNull();
      const checkpoint = f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint();
      await expect(f.api.undo()).rejects.toThrow();
      expect(f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint()).toEqual(checkpoint);
      expect(f.book.save()).toEqual(before); expect(host.save).toHaveBeenCalledTimes(1);
    }
    if (mode === 'revoked' || mode === 'external') {
      if (mode === 'revoked') journalCurrent = false;
      else { currentSource = structuredClone(target); currentSource.model.sheets[0]!.cells[0]!.value = 999; hook.rerender({ blocked: true }); }
      await act(async () => { await expect(hook.result.current.resumeClean(false, evidence)).rejects.toThrow('owner changed'); });
      await expect(f.api.undo()).rejects.toThrow();
      expect(f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint()).toEqual(native);
      expect(f.book.save()).toEqual(before); expect(host.save).toHaveBeenCalledTimes(1);
      return;
    }
    await act(async () => { await hook.result.current.resumeClean(false, evidence); });
    hook.rerender({ blocked: false });
    expect(live.writer).not.toBe(previousWriter);
    expect(live.isCurrent()).toBe(true); expect(f.owner.worker).toBe(worker);
    bound.observeLease(live); expect(resetKernel).not.toHaveBeenCalled();
    expect(f.book.save()).toEqual(before);
    expect(f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint()).toEqual(native);
    await act(async () => { await f.api.undo(); await f.calculation.awaitMembership(); });
    expect(f.book.save().sheets['4']).toBeUndefined();
    expect(live.writer.state().dirty).toBe(true);
    await act(async () => { await live!.writer.flush(); });
    expect(host.save).toHaveBeenCalledTimes(2);
    expect(f.owner.ready).toBe(true); expect(records.some(value => value?.sheetBirths?.entries.length)).toBe(true);
  } finally { observer.dispose(); release?.(); controller?.dispose(); hook.unmount(); await f.close(); vi.unstubAllGlobals(); }
}, 20_000);

it('keeps an existing native entry through a real late owned cache update without rebasing source or ACK data', async () => {
  const { NodeWorkbookWorker } = await import('../helpers/workbook-node-worker');
  const { createWorkbookMembershipRpcFixture } = await import('../helpers/workbook-membership-rpc-fixture');
  const { bindWorkbookCleanResumeOwner } = await import('../../src/components/embedded/workbook/clean-resume-owner');
  const { IUndoRedoService } = await import('@univerjs/core');
  const { SetRangeValuesMutation } = await import('@univerjs/sheets');
  const { SetFormulaCalculationStartMutation } = await import('@univerjs/engine-formula');
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(true, 100, 999);
  f.controller.dispose(); await f.writer.close();
  const source = { model: f.model, sourceSha256: 'a'.repeat(64) };
  const journal = { scope: f.scope, isCurrent: () => true, validate: (value: WorkbookCheckpoint) => { serializeWorkbookDraft(f.scope, value); }, save: async () => {} };
  const hook = renderHook(({ blocked }) => useWorkbookEditor(f.scope.projectId, f.scope.fileName, source, vi.fn(), undefined, journal, undefined,
    { open: blocked, blocked, show() {} }), { initialProps: { blocked: false as boolean } });
  let live: WorkbookMembershipWriterLease | null = null;
  let controller: WorkbookSheetHistoryController | undefined;
  let release: (() => void) | undefined;
  const observer = f.commands.onCommandExecuted(command => { if (command.type === CommandType.MUTATION) hook.result.current.snapshot(f.book.save()); });
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    live = hook.result.current.membershipLease()!;
    controller = new WorkbookSheetHistoryController(f.univer, live.writer, live.scope, () => f.book.save(), () => live?.isCurrent() === true, f.calculation.runProtectedSequence);
    const bound = bindWorkbookCleanResumeOwner(live, { controller, calculation: f.calculation, snapshot: () => f.book.save(), ownerCurrent: () => live?.isQualified() === true && f.owner.ready, qualified: () => live?.isQualified() === true && f.owner.ready,
      currentLease: () => hook.result.current.membershipLease(), setLease: value => { live = value; }, resetKernel: vi.fn() });
    release = () => bound.dispose();
    const history = f.univer.__getInjector().get(IUndoRedoService);
    // Seed one ordinary SDK history entry to isolate late initial calculation;
    // this is not membership issuance or a serialized/native-history restore.
    const mutation = { id: SetRangeValuesMutation.id, params: { unitId: f.book.getId(), subUnitId: '1', cellValue: { 0: { 0: { v: 21, t: 2 } } } } };
    history.pushUndoRedo({ unitID: f.book.getId(), undoMutations: [mutation], redoMutations: [structuredClone(mutation)] });
    const native = history.getUndoRedoCheckpoint();
    const protectedBefore = live.writer.checkpoint();
    const operationId = crypto.randomUUID();
    hook.rerender({ blocked: true });
    await act(async () => { expect(await hook.result.current.pause({ projectId: f.scope.projectId, fileName: f.scope.fileName, operationId, sourceSha256: source.sourceSha256 })).toBe(true); });
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(999);
    await act(async () => {
      let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const listener = f.api.getFormula().calculationStart(() => started());
      try {
        // Use the real epoch-stamped host start path. The Node-only generic
        // facade trigger also schedules an unstamped worker-local start.
        await f.commands.executeCommand(SetFormulaCalculationStartMutation.id, { forceCalculation: true });
        await ready; await f.calculation.awaitQuiescent();
      }
      finally { listener.dispose(); }
    });
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(38);
    expect(history.getUndoRedoCheckpoint()).toEqual(native);
    await act(async () => { await hook.result.current.resumeClean(false, { projectId: f.scope.projectId, fileName: f.scope.fileName, operationId, sourceSha256: source.sourceSha256, outcome: 'unadmitted' }); });
    hook.rerender({ blocked: false });
    const resumed = live.writer.checkpoint();
    expect(resumed.source).toEqual(protectedBefore.source);
    expect(resumed.acknowledged).toEqual(protectedBefore.acknowledged);
    expect(resumed.sourceAcknowledgement).toEqual(protectedBefore.sourceAcknowledgement);
    expect(resumed.sourceSnapshotBinding).toEqual(protectedBefore.sourceSnapshotBinding);
    expect(resumed.desired.sheets['3']!.cellData![1]![0]!.v).toBe(38);
    expect(hook.result.current.state.dirty).toBe(false);
    expect(history.getUndoRedoCheckpoint()).toEqual(native);
    await act(async () => { await f.api.undo(); await f.calculation.awaitQuiescent(); });
    expect(history.getUndoRedoCheckpoint().redoEntryId).toBe(native.undoEntryId);
    expect(host.save).not.toHaveBeenCalled(); expect(f.owner.ready).toBe(true);
  } finally { observer.dispose(); release?.(); controller?.dispose(); hook.unmount(); await f.close(); vi.unstubAllGlobals(); }
}, 20_000);
