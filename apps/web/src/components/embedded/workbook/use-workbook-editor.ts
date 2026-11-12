import { useCallback, useEffect, useRef, useState } from 'react';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookWriter, type WorkbookWriteState, type WorkbookJournal } from './workbook-writer';
import { newWorkbookSaveAttempt, saveWorkbook } from './save-transport';
import { loadWorkbookPreview } from './preview-transport';
import { WorkbookHostError } from './host-request';
import { z } from 'zod';
import { isWorkbookSaveRejection } from './save-terminal';

type Preview = { sourceSha256: string; model: WorkbookDocument };
const DiscardRequest = z.object({ type: z.literal('studio:discard-workbook'), projectId: z.string().uuid(), controllerId: z.string().uuid(), requestId: z.string().uuid() }).strict();
export function useWorkbookEditor(projectId: string, fileName: string, source: Preview | null,
  onAcknowledged: (source: Preview) => void, onDirtyChange?: (dirty: boolean) => void, journal?: WorkbookJournal, onDiscarded?: () => void) {
  const [state, setState] = useState<WorkbookWriteState>({ dirty: false, saving: false, error: null });
  const [discarding, setDiscarding] = useState(false);
  const current = useRef({ source, onAcknowledged, onDirtyChange, journal, onDiscarded }); current.current = { source, onAcknowledged, onDirtyChange, journal, onDiscarded };
  const restored = useRef(new WeakSet<WorkbookJournal>());
  const resume = useRef<ReturnType<WorkbookWriter['checkpoint']> | null>(null);
  const discardTask = useRef<Promise<boolean> | null>(null);
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
  const discard = useCallback(() => {
    if (discardTask.current) return discardTask.current;
    const task = Promise.resolve().then(async () => {
      const owned = writer.current, journal = current.current.journal;
      if (!owned || !journal) return false;
      const checkpoint = owned.checkpoint();
      if (checkpoint.pending) {
        const next = { ...owned.state(), error: 'Check this save’s status before discarding. Its result may already be committed.' };
        stateRef.current = next; setState(next); return false;
      }
      setDiscarding(true);
      try {
        await closeWriter();
        await journal.save(null);
        const next = { dirty: false, saving: false, error: null };
        stateRef.current = next; setState(next); current.current.onDirtyChange?.(false); current.current.onDiscarded?.();
        return true;
      } catch {
        resume.current = checkpoint; await ready(checkpoint.desired);
        const next = { ...(writer.current?.state() ?? { dirty: true, saving: false }), error: 'The draft could not be discarded. Your edits have been kept; try again.' };
        stateRef.current = next; setState(next); return false;
      } finally { setDiscarding(false); }
    }).finally(() => { if (discardTask.current === task) discardTask.current = null; });
    discardTask.current = task; return task;
  }, [closeWriter, ready]);
  useEffect(() => {
    const publish = () => window.parent.postMessage({ type: 'studio:workbook-state', projectId, controllerId, ...state, error: state.error?.slice(0, 1000) ?? null }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.projectId !== projectId) return;
      if (event.data.type === 'studio:artifact-request') publish();
      if (!discardTask.current && event.data.type === 'studio:workbook-control' && event.data.controllerId === controllerId && event.data.action === 'save') void writer.current?.flush();
      const request = DiscardRequest.safeParse(event.data);
      if (request.success && request.data.controllerId === controllerId) {
        const requestId = request.data.requestId;
        void discard().then(accepted => window.parent.postMessage({ type: 'studio:workbook-discarded', projectId, controllerId, requestId, accepted }, window.location.origin));
      }
    };
    publish(); window.addEventListener('message', receive);
    const unload = (event: BeforeUnloadEvent) => { if (stateRef.current.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('beforeunload', unload); };
  }, [projectId, controllerId, state, discard]);
  useEffect(() => () => {
    void closeWriter();
    window.parent.postMessage({ type: 'studio:workbook-unavailable', projectId, controllerId }, window.location.origin);
  }, [projectId, controllerId, closeWriter]);
  const checkpoint = useCallback(() => writer.current?.checkpoint() ?? null, []);
  return { state, stateRef, ready, snapshot, close, checkpoint, discarding };
}
