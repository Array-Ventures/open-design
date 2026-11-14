import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { WorkbookKernelAcknowledgement } from './kernel-acknowledgement';
import { checkedWorkbookSaveAcknowledgement, type WorkbookSaveAcknowledgement } from './save-provenance';
import { workbookGridPlan, workbookPlanHasChanges } from './grid-plan';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookWriter, type WorkbookWriteState, type WorkbookJournal, type WorkbookCheckpoint } from './workbook-writer';
import { newWorkbookSaveAttempt, saveWorkbook } from './save-transport';
import { loadWorkbookPreview } from './preview-transport';
import { WorkbookHostError } from './host-request';
import { isWorkbookSaveRejection } from './save-terminal';
import { cancelWorkbookSavePreparation } from './cancel-transport';
import { connectWorkbookDiscard, WorkbookDiscardNotCommittedError, type PreparedWorkbookDiscard } from './discard-controller';

type Preview = { sourceSha256: string; model: WorkbookDocument };
type WriterScope = { projectId: string; fileName: string; journal: WorkbookJournal | undefined };
type WriterHandoff = { scope: WriterScope; checkpoint: WorkbookCheckpoint };
// A recovery journal belongs to the current viewer's exclusive draft lease.
// Without that identity there is no account/lease fence for an in-memory carry.
const sameWriterScope = (a: WriterScope, b: WriterScope) => Boolean(a.journal && a.journal === b.journal && a.projectId === b.projectId && a.fileName === b.fileName);


export function useWorkbookEditor(projectId: string, fileName: string, source: Preview | null,
  onAcknowledged: (source: Preview, ticket?: WorkbookKernelAcknowledgement) => void, onDirtyChange?: (dirty: boolean) => void, journal?: WorkbookJournal, onDiscarded?: () => void, history?: { open: boolean; blocked: boolean; visible?: boolean; show(): void }) {
  const [state, setState] = useState<WorkbookWriteState>({ dirty: false, saving: false, error: null });
  const [discarding, setDiscarding] = useState(false);
  const current = useRef({ projectId, fileName, source, onAcknowledged, onDirtyChange, journal, onDiscarded, history, discarding }); current.current = { projectId, fileName, source, onAcknowledged, onDirtyChange, journal, onDiscarded, history, discarding };
  const restored = useRef(new WeakSet<WorkbookJournal>());
  const resume = useRef<WriterHandoff | null>(null);
  const writerScope = useRef<WriterScope | null>(null);
  const handoff = useRef<Promise<WriterHandoff> | null>(null);
  const suspended = useRef<ReturnType<WorkbookWriter['checkpoint']> | null>(null);
  const paused = useRef(false), pausedSnapshot = useRef<IWorkbookData | null>(null);
  const discardTask = useRef<Promise<PreparedWorkbookDiscard> | null>(null);
  const writer = useRef<WorkbookWriter | null>(null), running = useRef<AbortController | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const controllerId = useRef(crypto.randomUUID()).current;
  const retired = useRef(Promise.resolve());
  const generation = useRef(0);
  const closeWriter = useCallback((preserveHandoff = false) => {
    if (!preserveHandoff) handoff.current = null;
    generation.current += 1;
    running.current?.abort();
    const owned = writer.current; writer.current = null; writerScope.current = null;
    // Preserve drains even when a source-loss effect or another cleanup has
    // already detached the writer before the lease owner calls close().
    retired.current = Promise.all([retired.current, owned?.close()]).then(() => {});
    return retired.current;
  }, []);
  const sourceIdentity = source?.sourceSha256;
  const ready = useCallback(async (initial: IWorkbookData) => {
    const opened = current.current, source = opened.source;
    if (!source || opened.projectId !== projectId || opened.fileName !== fileName || source.sourceSha256 !== sourceIdentity || opened.journal !== journal) return;
    const scope: WriterScope = { projectId, fileName, journal: opened.journal };
    const previous = writer.current, previousScope = writerScope.current;
    const closing = closeWriter(true), owner = generation.current;
    // Read after the whole drain, including final render/preparation identity
    // checkpoints. Concurrent ready calls share the retiring writer's handoff.
    if (previous && previousScope) handoff.current = closing.then(() => ({ scope: previousScope, checkpoint: previous.checkpoint() }));
    const pendingHandoff = handoff.current;
    await closing;
    const carried = await pendingHandoff;
    if (generation.current !== owner || current.current.projectId !== projectId || current.current.fileName !== fileName
      || current.current.journal !== scope.journal || current.current.source?.sourceSha256 !== source.sourceSha256) return;
    handoff.current = null;
    const controller = new AbortController(); running.current = controller;
    const attempts = new Map<string, { save: ReturnType<typeof newWorkbookSaveAttempt>; previewId: string }>();
    let acknowledged: { source: Preview; snapshot: IWorkbookData; acknowledgement: WorkbookSaveAcknowledgement } | null = null;
    let publishedSource = source;
    let historyContinuity = Boolean(scope.journal);
    const ownedJournal = scope.journal;
    const matching = (candidate: WriterHandoff | null | undefined) => {
      if (!candidate || !sameWriterScope(candidate.scope, scope) || candidate.checkpoint.source.sourceSha256 !== source.sourceSha256) return undefined;
      const checkpoint = candidate.checkpoint;
      // A quarantined command deliberately restores its pre-command snapshot,
      // which may have an empty ordinary plan. That is not reset authority.
      if (checkpoint.sheetActionConflict) return checkpoint;
      // Keep only data needed by a still-live native history generation. A new
      // kernel starts new history; serialized birth records are not its issuer.
      if (checkpoint.sheetBirths && canonicalWorkbookJsonValue(checkpoint.sheetBirths.axisOwner)
        === canonicalWorkbookJsonValue(initial.custom?.evebotStructureOwner)) return checkpoint;
      // An acknowledged clean kernel replacement needs the fresh SDK baseline,
      // including its new source/axis identities. Only real dirty or unresolved
      // checkpoints may replace that baseline; invalid protected drafts stay.
      if (!checkpoint.pending) {
        try { if (!workbookPlanHasChanges(workbookGridPlan(checkpoint.source.model, checkpoint.source.sourceSha256, checkpoint.acknowledged, checkpoint.desired, { deletions: checkpoint.sheetDeletions, births: checkpoint.sheetBirths, sourceOwner: ownedJournal?.scope && checkpoint.sourceAcknowledgement && checkpoint.sourceSnapshotBinding ? { scope: ownedJournal.scope, acknowledgement: checkpoint.sourceAcknowledgement, binding: checkpoint.sourceSnapshotBinding } : undefined }))) return undefined; }
        catch { /* Preserve an unsupported or conflicted draft for recovery. */ }
      }
      return checkpoint;
    };
    const recovery = matching(resume.current) ?? matching(carried) ?? (ownedJournal && !restored.current.has(ownedJournal) ? ownedJournal.restored : undefined);
    resume.current = null;
    if (ownedJournal) restored.current.add(ownedJournal);
    writerScope.current = scope;
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
      const acknowledgement = checkedWorkbookSaveAcknowledgement(receipt, currentAttempt.save, refreshed.sourceSha256);
      attempts.delete(intent.id); return { preview: refreshed, acknowledgement };
    }, next => {
      stateRef.current = next; setState(next); current.current.onDirtyChange?.(next.dirty);
      if (!next.dirty && acknowledged) {
        const saved = acknowledged; acknowledged = null;
        const ticket = historyContinuity && saved.acknowledgement.kind === 'history' && ownedJournal && generation.current === owner
          && current.current.journal === ownedJournal && current.current.source === publishedSource
          ? { previous: publishedSource, target: saved.source, snapshot: saved.snapshot, acknowledgement: saved.acknowledgement, controllerId, journal: ownedJournal } : undefined;
        current.current.onAcknowledged(saved.source, ticket); publishedSource = saved.source;
      }
    }, (source, snapshot, acknowledgement) => { historyContinuity &&= acknowledgement.kind === 'history'; acknowledged = { source, snapshot, acknowledgement }; }, ownedJournal ? { save: ownedJournal.save, ...(ownedJournal.scope ? { scope: ownedJournal.scope } : {}), ...(ownedJournal.validate ? { validate: ownedJournal.validate } : {}), ...(ownedJournal.isCurrent ? { isCurrent: ownedJournal.isCurrent } : {}), restored: recovery } : undefined);
    const next = writer.current.state(); stateRef.current = next; setState(next); current.current.onDirtyChange?.(next.dirty);
  }, [projectId, fileName, sourceIdentity, journal, closeWriter]);
  useEffect(() => {
    if (source) return;
    void closeWriter();
    const empty = { dirty: false, saving: false, error: null };
    stateRef.current = empty; setState(empty); current.current.onDirtyChange?.(false);
  }, [source, closeWriter]);
  const snapshot = useCallback((value: IWorkbookData) => {
    if (discardTask.current || paused.current || current.current.history?.blocked) return;
    writer.current?.update(value);
  }, []);
  const close = useCallback(() => discardTask.current ? discardTask.current.then(() => closeWriter()) : closeWriter(), [closeWriter]);
  const prepareDiscard = useCallback((signal: AbortSignal) => {
    if (paused.current || current.current.history?.blocked) return Promise.reject(Error('Check the pending restore in History before discarding.'));
    if (discardTask.current) return Promise.reject(Error('A workbook discard is already being checked.'));
    const task = Promise.resolve().then(async (): Promise<PreparedWorkbookDiscard> => {
      if (paused.current || current.current.history?.blocked) throw Error('Check the pending restore in History before discarding.');
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
        resume.current = { scope: { projectId, fileName, journal }, checkpoint }; await ready(checkpoint.desired); suspended.current = null;
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
    const publish = () => history?.visible === false ? window.parent.postMessage({ type: 'studio:workbook-unavailable', projectId, controllerId }, window.location.origin) : window.parent.postMessage({ type: 'studio:workbook-state', projectId, controllerId, ...state, dirty: state.dirty || Boolean(history?.blocked), historyOpen: history?.open ?? false, restoring: history?.blocked ?? false, error: state.error?.slice(0, 1000) ?? null }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.projectId !== projectId) return;
      if (event.data.type === 'studio:artifact-request') publish();
      if (current.current.history?.visible === false) return;
      if (event.data.type === 'studio:workbook-control' && event.data.controllerId === controllerId && event.data.action === 'history') current.current.history?.show();
      if (!paused.current && !current.current.history?.blocked && !discardTask.current && event.data.type === 'studio:workbook-control' && event.data.controllerId === controllerId && event.data.action === 'save') void writer.current?.flush();

    };
    publish(); window.addEventListener('message', receive);
    const unload = (event: BeforeUnloadEvent) => { if (stateRef.current.dirty || current.current.history?.blocked) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('beforeunload', unload); };
  }, [projectId, controllerId, state, history?.open, history?.blocked, history?.visible]);
  useEffect(() => () => {
    void closeWriter();
    window.parent.postMessage({ type: 'studio:workbook-unavailable', projectId, controllerId }, window.location.origin);
  }, [projectId, controllerId, closeWriter]);
  const checkpoint = useCallback(() => writer.current?.checkpoint() ?? suspended.current, []);
  const pause = useCallback(async () => {
    if (paused.current) return true;
    if (stateRef.current.dirty || stateRef.current.saving || discardTask.current || current.current.discarding || !writer.current && current.current.source !== null) return false;
    paused.current = true; pausedSnapshot.current = writer.current?.checkpoint().desired ?? null;
    await closeWriter(); return true;
  }, [closeWriter]);
  const resumeClean = useCallback(async (accepted = false) => {
    const previous = pausedSnapshot.current; pausedSnapshot.current = null; paused.current = false;
    if (!accepted && previous) await ready(previous);
  }, [ready]);
  return { controllerId, state, stateRef, ready, snapshot, close, checkpoint, discarding, pause, resumeClean };
}
