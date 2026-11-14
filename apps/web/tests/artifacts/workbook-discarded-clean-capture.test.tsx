// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkbookSheetHistoryController } from '../../src/components/embedded/workbook/sheet-history-controller';
import { bindWorkbookCleanResumeOwner } from '../../src/components/embedded/workbook/clean-resume-owner';
import { useWorkbookEditor } from '../../src/components/embedded/workbook/use-workbook-editor';
import { createSourceDeleteHistoryFixture, sourceDeleteScope as scope } from '../helpers/workbook-source-delete-fixture';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import type { WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';

const host = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock('../../src/components/embedded/workbook/save-transport', async original => ({ ...await original<object>(), saveWorkbook: host.save }));
vi.mock('../../src/components/embedded/workbook/preview-transport', () => ({ loadWorkbookPreview: host.load }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

it.each(['writer', 'source', 'revoked'] as const)('retires a discarded capture after actual %s replacement in the capture/pause gap without reviving the old owner', async mode => {
  const f = createSourceDeleteHistoryFixture(false);
  let journalCurrent = true;
  const journal = { scope, isCurrent: () => journalCurrent, validate: (state: WorkbookCheckpoint) => { serializeWorkbookDraft(scope, state); }, save: vi.fn(async () => {}) };
  const hook = renderHook(({ source }) => useWorkbookEditor(scope.projectId, scope.fileName, source, vi.fn(), undefined, journal), { initialProps: { source: f.source } });
  let controller: WorkbookSheetHistoryController | undefined;
  let bound: ReturnType<typeof bindWorkbookCleanResumeOwner> | undefined;
  let replacement: Promise<void> | undefined;
  let release!: () => void;
  const quiescent = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const resetKernel = vi.fn();
  let frozen = false;
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    const old = hook.result.current.membershipLease()!;
    controller = new WorkbookSheetHistoryController(f.univer, old.writer, old.scope, () => f.book.save(), () => old.isCurrent());
    const prepare = vi.spyOn(controller, 'prepareCleanResume'); // Calls the actual private capture; no fabricated ticket.
    bound = bindWorkbookCleanResumeOwner(old, { controller, calculation: {
      inputEpoch: 0, quiescent: true, awaitQuiescent: () => quiescent,
      freezeAuthoring: () => { frozen = true; return () => { frozen = false; }; },
    }, snapshot: () => f.book.save(), ownerCurrent: () => old.isQualified(), qualified: () => old.isQualified(),
      currentLease: () => hook.result.current.membershipLease(), setLease: () => { throw Error('No clean handoff is admitted.'); }, resetKernel });
    const before = f.book.save(), native = f.history.getUndoRedoCheckpoint(), protectedBefore = old.writer.checkpoint();
    // This callback is registered before the owner's await. Its nested task
    // runs after the real capture continuation but before pause's continuation.
    void quiescent.then(() => queueMicrotask(() => {
      expect(prepare).toHaveBeenCalledOnce(); order.push('captured-then-replacement');
      if (mode === 'writer') replacement = hook.result.current.ready(f.book.save());
      else if (mode === 'source') flushSync(() => hook.rerender({ source: structuredClone(f.source) }));
      else journalCurrent = false;
      expect(old.isQualified()).toBe(false); // The replacement actually happened before pause resumes.
    }));
    await act(async () => {
      const pausing = hook.result.current.pause({ projectId: scope.projectId, fileName: scope.fileName, sourceSha256: f.source.sourceSha256, operationId: crypto.randomUUID() });
      release(); expect(await pausing).toBe(false); order.push('pause-refused'); await replacement;
    });
    expect(order).toEqual(['captured-then-replacement', 'pause-refused']);
    expect(old.isOwned()).toBe(false);
    if (mode === 'source') await act(async () => { await hook.result.current.ready(f.book.save()); });
    if (mode === 'revoked') {
      bound.observeLease(old); bound.observeLease(null); expect(resetKernel).not.toHaveBeenCalled();
    } else {
      const next = hook.result.current.membershipLease()!;
      expect(next).not.toBe(old); expect(next.isOwned()).toBe(true);
      bound.observeLease(next); bound.observeLease(next); expect(resetKernel).toHaveBeenCalledOnce();
    }
    expect(frozen).toBe(true); // Revoked old kernel never receives authoring permission.
    expect(f.book.save()).toEqual(before); expect(f.history.getUndoRedoCheckpoint()).toEqual(native);
    expect(old.writer.checkpoint()).toEqual(protectedBefore);
    expect(host.save).not.toHaveBeenCalled(); expect(host.load).not.toHaveBeenCalled();
    await expect(f.api.undo()).rejects.toThrow(/paused|current|resume/);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(native);
  } finally { release(); await replacement; bound?.dispose(); controller?.dispose(); hook.unmount(); await f.close(); }
});

it('retains an accepted clean capture when normal Writer close aborts its old run signal', async () => {
  const f = createSourceDeleteHistoryFixture(false);
  const journal = { scope, isCurrent: () => true, validate: (state: WorkbookCheckpoint) => { serializeWorkbookDraft(scope, state); }, save: vi.fn(async () => {}) };
  const hook = renderHook(() => useWorkbookEditor(scope.projectId, scope.fileName, f.source, vi.fn(), undefined, journal));
  let controller: WorkbookSheetHistoryController | undefined;
  let bound: ReturnType<typeof bindWorkbookCleanResumeOwner> | undefined;
  let frozen = false;
  const resetKernel = vi.fn();
  try {
    await act(async () => { await hook.result.current.ready(f.book.save()); });
    let live = hook.result.current.membershipLease()!; const old = live;
    controller = new WorkbookSheetHistoryController(f.univer, live.writer, live.scope, () => f.book.save(), () => live.isCurrent());
    bound = bindWorkbookCleanResumeOwner(live, { controller, calculation: { inputEpoch: 0, quiescent: true, awaitQuiescent: async () => {}, freezeAuthoring: () => { frozen = true; return () => { frozen = false; }; } },
      snapshot: () => f.book.save(), ownerCurrent: () => live.isQualified(), qualified: () => live.isQualified(), currentLease: () => hook.result.current.membershipLease(), setLease: next => { live = next; }, resetKernel });
    const before = f.book.save(), native = f.history.getUndoRedoCheckpoint(), checkpoint = old.writer.checkpoint();
    const identity = { projectId: scope.projectId, fileName: scope.fileName, sourceSha256: f.source.sourceSha256, operationId: crypto.randomUUID() };
    await act(async () => { expect(await hook.result.current.pause(identity)).toBe(true); });
    expect(old.isOwned()).toBe(false); expect(frozen).toBe(true);
    await act(async () => { await hook.result.current.resumeClean(false, { ...identity, outcome: 'cancelled' }); });
    expect(live).not.toBe(old); expect(live.isCurrent()).toBe(true); expect(frozen).toBe(false);
    bound.observeLease(live); expect(resetKernel).not.toHaveBeenCalled();
    expect(f.book.save()).toEqual(before); expect(f.history.getUndoRedoCheckpoint()).toEqual(native);
    expect(live.writer.checkpoint()).toEqual(checkpoint);
    expect(host.save).not.toHaveBeenCalled(); expect(host.load).not.toHaveBeenCalled();
  } finally { bound?.dispose(); controller?.dispose(); hook.unmount(); await f.close(); }
});
