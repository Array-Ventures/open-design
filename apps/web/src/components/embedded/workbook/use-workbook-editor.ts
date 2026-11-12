import { useCallback, useEffect, useRef, useState } from 'react';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookWriter, type WorkbookWriteState } from './workbook-writer';
import { newWorkbookSaveAttempt, saveWorkbook } from './save-transport';
import { loadWorkbookPreview } from './preview-transport';
import { WorkbookHostError } from './host-request';

type Preview = { sourceSha256: string; model: WorkbookDocument };
export function useWorkbookEditor(projectId: string, fileName: string, source: Preview | null,
  onAcknowledged: (source: Preview) => void, onDirtyChange?: (dirty: boolean) => void) {
  const [state, setState] = useState<WorkbookWriteState>({ dirty: false, saving: false, error: null });
  const current = useRef({ source, onAcknowledged, onDirtyChange }); current.current = { source, onAcknowledged, onDirtyChange };
  const writer = useRef<WorkbookWriter | null>(null), running = useRef<AbortController | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const controllerId = useRef(crypto.randomUUID()).current;
  const ready = useCallback((initial: IWorkbookData) => {
    const source = current.current.source; if (!source) return;
    writer.current?.dispose(); running.current?.abort();
    const controller = new AbortController(); running.current = controller;
    const attempts = new Map<string, { save: ReturnType<typeof newWorkbookSaveAttempt>; previewId: string }>();
    let acknowledged: Preview | null = null;
    writer.current = new WorkbookWriter(source, initial, async intent => {
      let attempt = attempts.get(intent.id);
      if (!attempt) { attempt = { save: { ...newWorkbookSaveAttempt(projectId, fileName, intent.plan), operationId: intent.id }, previewId: crypto.randomUUID() }; attempts.set(intent.id, attempt); }
      const receipt = await saveWorkbook(attempt.save, controller.signal);
      let refreshed: Preview;
      try { refreshed = await loadWorkbookPreview(projectId, fileName, attempt.previewId, controller.signal); }
      catch (error) { if (error instanceof WorkbookHostError && [410, 422].includes(error.status)) attempt.previewId = crypto.randomUUID(); throw error; }
      attempt.previewId = crypto.randomUUID(); // a successfully consumed preview is removed
      if (refreshed.sourceSha256 !== receipt.targetSha256) throw new WorkbookHostError('The workbook changed after saving. Your edits are still here; keep a copy before reloading.', 409);
      attempts.delete(intent.id); return refreshed;
    }, next => {
      stateRef.current = next; setState(next); current.current.onDirtyChange?.(next.dirty);
      if (!next.dirty && acknowledged) { const saved = acknowledged; acknowledged = null; current.current.onAcknowledged(saved); }
    }, source => { acknowledged = source; });
  }, [projectId, fileName]);
  useEffect(() => {
    if (source) return;
    writer.current?.dispose(); writer.current = null; running.current?.abort();
    const empty = { dirty: false, saving: false, error: null };
    stateRef.current = empty; setState(empty); current.current.onDirtyChange?.(false);
  }, [source]);
  const snapshot = useCallback((value: IWorkbookData) => writer.current?.update(value), []);
  useEffect(() => {
    const publish = () => window.parent.postMessage({ type: 'studio:workbook-state', projectId, controllerId, ...state, error: state.error?.slice(0, 1000) ?? null }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.projectId !== projectId) return;
      if (event.data.type === 'studio:artifact-request') publish();
      if (event.data.type === 'studio:workbook-control' && event.data.controllerId === controllerId && event.data.action === 'save') void writer.current?.flush();
    };
    publish(); window.addEventListener('message', receive);
    const unload = (event: BeforeUnloadEvent) => { if (stateRef.current.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('beforeunload', unload); };
  }, [projectId, controllerId, state]);
  useEffect(() => () => {
    writer.current?.dispose(); running.current?.abort();
    window.parent.postMessage({ type: 'studio:workbook-unavailable', projectId, controllerId }, window.location.origin);
  }, [projectId, controllerId]);
  return { state, stateRef, ready, snapshot };
}
