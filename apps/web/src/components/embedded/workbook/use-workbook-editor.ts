import { useCallback, useEffect, useRef, useState } from 'react';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookWriter, type WorkbookWriteState, type WorkbookJournal } from './workbook-writer';
import { newWorkbookSaveAttempt, saveWorkbook } from './save-transport';
import { loadWorkbookPreview } from './preview-transport';
import { WorkbookHostError } from './host-request';
import { isWorkbookSaveRejection } from './save-terminal';
import { cancelWorkbookSavePreparation } from './cancel-transport';
import { connectWorkbookDiscard, WorkbookDiscardNotCommittedError, type PreparedWorkbookDiscard } from './discard-controller';

type Preview = { sourceSha256: string; model: WorkbookDocument };

export function useWorkbookEditor(projectId: string, fileName: string, source: Preview | null,
  onAcknowledged: (source: Preview) => void, onDirtyChange?: (dirty: boolean) => void, journal?: WorkbookJournal, onDiscarded?: () => void) {
  const [state, setState] = useState<WorkbookWriteState>({ dirty: false, saving: false, error: null });
  const [discarding, setDiscarding] = useState(false);
  const current = useRef({ projectId, fileName, source, onAcknowledged, onDirtyChange, journal, onDiscarded }); current.current = { projectId, fileName, source, onAcknowledged, onDirtyChange, journal, onDiscarded };
  const restored = useRef(new WeakSet<WorkbookJournal>());
  const resume = useRef<ReturnType<WorkbookWriter['checkpoint']> | null>(null);
  const suspended = useRef<ReturnType<WorkbookWriter['checkpoint']> | null>(null);
  const discardTask = useRef<Promise<PreparedWorkbookDiscard> | null>(null);
  const writer = useRef<WorkbookWriter | null>(null), running = useRef<AbortController | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const controllerId = useRef(crypto.randomUUID()).current;
  const retired = useRef(Promise.resolve());
  const generation = useRef(0);
  const closeWriter = useCallback(() => {
    generation.current += 1;
    running.current?.abort();
    const owned = writer.current; writer.current = null;
    // Preserve drains even when a source-loss effect or another cleanup has
    // already detached the writer before the lease owner calls close().
    retired.current = Promise.all([retired.current, owned?.close()]).then(() => {});
    return retired.current;
  }, []);
  const ready = useCallback(async (initial: IWorkbookData) => {
    const source = current.current.source; if (!source) return;
    const closing = closeWriter(), owner = generation.current;
    await closing;
    if (generation.current !== owner || current.current.source?.sourceSha256 !== source.sourceSha256) return;
    const controller = new AbortController(); running.current = controller;
    const attempts = new Map<string, { save: ReturnType<typeof newWorkbookSaveAttempt>; previewId: string }>();
    let acknowledged: Preview | null = null;
    const journal = current.current.journal;
    const recovery = resume.current ?? (journal && !restored.current.has(journal) ? journal.restored : undefined);
    resume.current = null;
    if (journal) restored.current.add(journal);
    writer.current = new WorkbookWriter(source, initial, async (intent, checkpoint) => {
      let attempt = attempts.get(intent.id);
      if (!attempt) { attempt = { save: { ...newWorkbookSaveAttempt(projectId, fileName, intent.plan), operationId: intent.id, preparationId: intent.preparationId, renderId: intent.renderId }, previewId: intent.previewId }; attempts.set(intent.id, attempt); }
      const currentAttempt = attempt;
      const receipt = await saveWorkbook(currentAttempt.save, controller.signal, async () => {
        const previous = { renderId: intent.renderId, preparationId: intent.preparationId };
        intent.renderId = currentAttempt.save.renderId; intent.preparationId = currentAttempt.save.preparationId;
        try { await checkpoint(); } catch (error) { Object.assign(intent, previous); throw error; }
      }).catch(error => { if (isWorkbookSaveRejection(error, intent)) attempts.delete(intent.id); throw error; });
      let refreshed: Preview;
      try { refreshed = await loadWorkbookPreview(projectId, fileName, attempt.previewId, controller.signal); }
      catch (error) { if (error instanceof WorkbookHostError && [410, 422].includes(error.status)) intent.previewId = attempt.previewId = crypto.randomUUID(); await checkpoint(); throw error; }
      intent.previewId = attempt.previewId = crypto.randomUUID(); // a successfully consumed preview is removed
      if (refreshed.sourceSha256 !== receipt.targetSha256) throw new WorkbookHostError('The workbook changed after saving. Your edits are still here; keep a copy before reloading.', 409);
      attempts.delete(intent.id); return refreshed;
    }, next => {
      stateRef.current = next; setState(next); current.current.onDirtyChange?.(next.dirty);
      if (!next.dirty && acknowledged) { const saved = acknowledged; acknowledged = null; current.current.onAcknowledged(saved); }
    }, source => { acknowledged = source; }, journal ? { save: journal.save, restored: recovery } : undefined);
    const next = writer.current.state(); stateRef.current = next; setState(next); current.current.onDirtyChange?.(next.dirty);
  }, [projectId, fileName, closeWriter]);
  useEffect(() => {
    if (source) return;
    void closeWriter();
    const empty = { dirty: false, saving: false, error: null };
    stateRef.current = empty; setState(empty); current.current.onDirtyChange?.(false);
  }, [source, closeWriter]);
  const snapshot = useCallback((value: IWorkbookData) => {
    if (discardTask.current) return;
    writer.current?.update(value);
  }, []);
  const close = useCallback(() => discardTask.current ? discardTask.current.then(() => closeWriter()) : closeWriter(), [closeWriter]);
  const prepareDiscard = useCallback((signal: AbortSignal) => {
    if (discardTask.current) return Promise.reject(Error('A workbook discard is already being checked.'));
    const task = Promise.resolve().then(async (): Promise<PreparedWorkbookDiscard> => {
      const owned = writer.current, journal = current.current.journal, openedSource = current.current.source;
      if (!owned || !journal || !openedSource) throw Error('The workbook connection changed. Reopen it before discarding.');
      setDiscarding(true);
      const drain = closeWriter(), owner = generation.current;
      let checkpoint = owned.checkpoint();
      let cancelled: Promise<void> | null = null, committed: Promise<void> | null = null;
      const sameScope = () => current.current.projectId === projectId && current.current.fileName === fileName && current.current.journal === journal && current.current.source?.sourceSha256 === openedSource.sourceSha256;
      const belongs = () => generation.current === owner && sameScope();
      const cancel = () => cancelled ??= Promise.resolve().then(async () => {
        if (!belongs()) return;
        resume.current = checkpoint; await ready(checkpoint.desired); suspended.current = null;
        if (sameScope()) setDiscarding(false);
      });
      try {
        await drain;
        checkpoint = owned.checkpoint(); suspended.current = checkpoint; // includes any final checkpoint callback
        if (signal.aborted || !belongs()) throw new DOMException('Aborted', 'AbortError');
        if (checkpoint.pending) {
          const intent = checkpoint.pending.intent;
          const result = await cancelWorkbookSavePreparation({ ...newWorkbookSaveAttempt(projectId, fileName, intent.plan), operationId: intent.id, preparationId: intent.preparationId, ...(intent.renderId ? { renderId: intent.renderId } : {}) }, signal);
          if (result.state === 'admitted' && result.save.state === 'pending') throw Error('This save is still settling. Keep this draft and check again before discarding.');
          if (result.state === 'unadmitted') {
            checkpoint.pending = null;
            await journal.save(checkpoint); // known no-future-write transition
          }
        }
        if (signal.aborted || !belongs()) throw new DOMException('Aborted', 'AbortError');
        return {
          cancel,
          commit: () => committed ??= Promise.resolve().then(async () => {
            // Only the exact prepared controller can grant this point. There
            // are no asynchronous checks between ownership and deletion.
            if (!belongs()) throw new WorkbookDiscardNotCommittedError('The workbook connection changed before discard committed. Your draft was kept.');
            await journal.save(null);
            if (belongs()) {
              suspended.current = null;
              const next = { dirty: false, saving: false, error: null };
              stateRef.current = next; setState(next); setDiscarding(false);
              current.current.onDirtyChange?.(false); current.current.onDiscarded?.();
            }
          }).catch(error => { committed = null; throw error; }),
        };
      } catch (error) {
        await cancel();
        if (sameScope()) {
          const next = { ...(writer.current?.state() ?? { dirty: true, saving: false }), error: error instanceof Error ? error.message : 'The draft could not be checked. Your edits have been kept.' };
          stateRef.current = next; setState(next);
        }
        throw error;
      }
    }).finally(() => { if (discardTask.current === task) discardTask.current = null; });
    discardTask.current = task; return task;
  }, [projectId, fileName, closeWriter, ready]);
  useEffect(() => connectWorkbookDiscard(projectId, controllerId, prepareDiscard), [projectId, controllerId, prepareDiscard, source?.sourceSha256]);
  useEffect(() => {
    const publish = () => window.parent.postMessage({ type: 'studio:workbook-state', projectId, controllerId, ...state, error: state.error?.slice(0, 1000) ?? null }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.projectId !== projectId) return;
      if (event.data.type === 'studio:artifact-request') publish();
      if (!discardTask.current && event.data.type === 'studio:workbook-control' && event.data.controllerId === controllerId && event.data.action === 'save') void writer.current?.flush();

    };
    publish(); window.addEventListener('message', receive);
    const unload = (event: BeforeUnloadEvent) => { if (stateRef.current.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('beforeunload', unload); };
  }, [projectId, controllerId, state]);
  useEffect(() => () => {
    void closeWriter();
    window.parent.postMessage({ type: 'studio:workbook-unavailable', projectId, controllerId }, window.location.origin);
  }, [projectId, controllerId, closeWriter]);
  const checkpoint = useCallback(() => writer.current?.checkpoint() ?? suspended.current, []);
  return { controllerId, state, stateRef, ready, snapshot, close, checkpoint, discarding };
}
