'use client';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { RiRefreshLine } from '@remixicon/react';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { useEmbeddedViewer } from '../host-viewer';
import { Button } from '../boardui/button';
import { cx } from '../boardui/cx';
import { ARTIFACT_ICON_BUTTON } from '../artifact-controls';
import { loadWorkbookPreview } from './preview-transport';
import { WorkbookHostError } from './host-request';
import { useWorkbookEditor } from './use-workbook-editor';
import { useWorkbookRecovery } from './use-workbook-recovery';
import { WorkbookRecoveryCard } from './WorkbookRecoveryCard';
import { useWorkbookHistory } from './use-workbook-history';
import { WorkbookHistory } from './WorkbookHistory';
import { downloadWorkbookDraft } from './download-draft';

const WorkbookGrid = lazy(() => import('./WorkbookGrid').then(module => ({ default: module.WorkbookGrid })));

interface Props { projectId: string; fileName: string; title: string; sourceStamp: string; statusOnly?: boolean; onAccessLost?(): void; onDirtyChange?(dirty: boolean): void; onSaved?(): void }
export function WorkbookSurface(props: Props) {
  const viewer = useEmbeddedViewer();
  if (!viewer) return <div role="status" className="p-4 text-body-2-regular text-text-tertiary">Loading workbook…</div>;
  return <ScopedWorkbookSurface key={`${viewer.memberId}:${props.projectId}:${props.fileName}`} {...props} viewerId={viewer.memberId} />;
}
function ScopedWorkbookSurface({ projectId, fileName, title, sourceStamp, onDirtyChange, onSaved, viewerId, statusOnly, onAccessLost }: Props & { viewerId: string }) {
  const [loaded, setLoaded] = useState<{ sourceSha256: string; model: WorkbookDocument } | null>(null);
  const [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const close = useRef<() => Promise<void>>(async () => {});
  const recovery = useWorkbookRecovery({ viewerId, projectId, fileName }, Boolean(loaded), () => close.current());
  const editorRef = useRef<ReturnType<typeof useWorkbookEditor> | null>(null);
  const history = useWorkbookHistory({ statusOnly, scope: { viewerId, projectId, fileName }, source: loaded, ready: Boolean(recovery.session),
    dirty: () => !editorRef.current || editorRef.current.stateRef.current.dirty || editorRef.current.discarding,
    pause: async () => editorRef.current?.pause() ?? false,
    resume: async accepted => { await editorRef.current?.resumeClean(accepted); },
    accepted: source => { setLoaded(source); setError(null); onSaved?.(); },
    unreadable: (_message, refresh = true) => { setLoaded(null); setError(null); if (refresh) onSaved?.(); },
    onAccessLost: () => { void editorRef.current?.close(); setLoaded(null); setError('This workbook is unavailable. Reopen it after checking access.'); onAccessLost?.(); },
    focusOnClose: () => window.parent.postMessage({ type: 'studio:workbook-history-focus', projectId, controllerId: editorRef.current?.controllerId }, window.location.origin),
  });
  // The editor acknowledges only after the receipt and fresh preview hashes
  // match. A refresh warning from that same pending save is then obsolete.
  const editor = useWorkbookEditor(projectId, fileName, loaded, source => { setLoaded(source); setError(null); onSaved?.(); }, dirty => onDirtyChange?.(dirty || history.blocked), recovery.session?.journal, () => { setLoaded(null); setRetry(value => value + 1); }, { open: history.open, blocked: history.blocked, visible: history.canOpen, show: history.toggle });
  editorRef.current = editor;
  const historyRef = useRef(history); historyRef.current = history;
  close.current = editor.close;
  useEffect(() => { onDirtyChange?.(editor.state.dirty || history.blocked); }, [onDirtyChange, editor.state.dirty, history.blocked]);
  const operation = useRef<{ stamp: string; id: string } | null>(null);
  useEffect(() => {
    if (statusOnly) return;
    const controller = new AbortController(), generation = historyRef.current.generation();
    if (!operation.current || operation.current.stamp !== sourceStamp) operation.current = { stamp: sourceStamp, id: crypto.randomUUID() };
    void loadWorkbookPreview(projectId, fileName, operation.current.id, controller.signal).then(preview => {
      if (controller.signal.aborted || generation !== historyRef.current.generation()) return;
      if (historyRef.current.isRestoring()) {
        // A preview racing reload recovery cannot acknowledge the retained
        // restore receipt or replace its protected state. History owns that
        // confirmation; it does not imply that the person has editable drafts.
        operation.current = null;
        return;
      }
      if (editor.stateRef.current.dirty) {
        operation.current = null;
        if (preview.sourceSha256 === loaded?.sourceSha256) return;
        setError('The workbook was refreshed while you have unsaved changes. Save or keep a copy before reloading.'); return;
      }
      setLoaded(current => current?.sourceSha256 === preview.sourceSha256 ? current : preview); setError(null);
      // A successful preview is removed. A later explicit reload needs fresh intent.
      operation.current = null;
    }).catch(cause => {
      if (controller.signal.aborted || generation !== historyRef.current.generation()) return;
      if (cause instanceof WorkbookHostError && [410, 422].includes(cause.status)) operation.current = null;
      if (cause instanceof WorkbookHostError && [401, 403].includes(cause.status)) { historyRef.current.denyAccess(); return; }
      if (cause instanceof WorkbookHostError && cause.status === 404) { setLoaded(null); void historyRef.current.refresh(); }
      setError(cause instanceof Error ? cause.message : 'The workbook could not be loaded.');
    });
    return () => controller.abort();
  }, [projectId, fileName, sourceStamp, retry, statusOnly]);
  const downloadCurrent = () => {
    const checkpoint = editor.checkpoint();
    if (!checkpoint || !recovery.session) throw Error('This draft is no longer available.');
    downloadWorkbookDraft(recovery.session.scope, checkpoint);
  };
  const download = useRef(downloadCurrent); download.current = downloadCurrent;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window.parent || event.origin !== window.location.origin || !data || typeof data !== 'object'
        || Object.keys(data).length !== 5 || data.type !== 'studio:workbook-control' || data.projectId !== projectId
        || data.controllerId !== editor.controllerId || data.action !== 'download-recovery'
        || typeof data.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.requestId)) return;
      let error: string | null = null;
      try { download.current(); }
      catch { error = 'The recovery copy could not be downloaded. Keep this workbook open.'; }
      window.parent.postMessage({ type: 'studio:workbook-recovery-copy', projectId, controllerId: editor.controllerId, requestId: data.requestId, error }, window.location.origin);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [projectId, editor.controllerId]);
  let content;
  if (!loaded) content = history.open ? null : <div role={error ? 'alert' : 'status'} className="flex h-full items-center justify-center gap-2 p-4 text-body-2-regular text-text-tertiary">{error ?? history.notice ?? (statusOnly ? history.available && !history.intent && !history.checking ? 'No unresolved restore remains for this file.' : 'Open History to check the pending restore.' : 'Loading workbook…')}</div>;
  else if (recovery.session) content = <Suspense fallback={<div role="status" className="p-4 text-body-2-regular text-text-tertiary">Loading workbook…</div>}>
    <WorkbookGrid id={`${projectId}:${fileName}`} title={title} model={loaded.model} sourceSha256={loaded.sourceSha256} initialSnapshot={recovery.session.journal.restored?.desired} onReady={editor.ready} onSnapshot={editor.snapshot} exportScope={loaded.model.sourceFormat === 'csv' ? undefined : { projectId, controllerId: editor.controllerId, fileName, sourceSha256: loaded.sourceSha256, blocked: editor.state.dirty || editor.state.saving || editor.discarding || history.blocked }} structureSource={() => { const checkpoint = editor.checkpoint(); return checkpoint && !error && !editor.stateRef.current.error ? { model: checkpoint.source.model, sourceSha256: checkpoint.source.sourceSha256, acknowledged: checkpoint.acknowledged } : null; }} structureBlocked={Boolean(error || editor.state.error || editor.state.saving || editor.discarding || history.blocked)} formatScope={{ projectId, controllerId: editor.controllerId, saving: editor.state.saving, blocked: editor.discarding || history.blocked }} />
  </Suspense>;
  else content = <div className="flex h-full items-center justify-center overflow-auto p-4">
    {recovery.busy && !recovery.drafts.length && !recovery.error ? <div role="status" className="text-body-2-regular text-text-tertiary">Checking workbook recovery…</div> :
      <WorkbookRecoveryCard restoreDisabled={history.blocked} drafts={recovery.drafts} busy={recovery.busy} error={recovery.error} onRestore={id => void recovery.restore(id)} onDiscard={id => void recovery.discard(id)} onDownload={id => void recovery.download(id)} onContinue={() => void recovery.continueCurrent()} />}
  </div>;
  return <div className="relative h-full min-h-0 w-full">
    <div className="relative z-0 h-full" onKeyDownCapture={event => { if (editor.discarding || history.blocked) { event.preventDefault(); event.stopPropagation(); } }} onPointerDownCapture={event => { if (editor.discarding || history.blocked) { event.preventDefault(); event.stopPropagation(); } }}>{content}</div>
    {history.blocked && history.open ? <div aria-hidden className="absolute inset-0 z-20 bg-background-primary-default/60" /> : null}
    {history.blocked && !history.open ? <div role="status" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-background-primary-default/80 p-4 text-caption-1-regular text-text-secondary"><span>{history.checking ? 'Checking restore recovery…' : !history.available ? 'Workbook recovery is unavailable. Retry to check access.' : history.missing ? 'The current workbook is missing. History restore will not recreate it.' : 'A restore needs confirmation before editing.'}</span>{!history.checking && history.canOpen ? <Button variant="secondary" size="small" onClick={history.show}>History</Button> : null}</div> : null}
    <WorkbookHistory history={history} dirty={editor.state.dirty || editor.discarding} sourceSha256={loaded?.sourceSha256} reload={() => { setRetry(value => value + 1); void history.refresh(); }} />
    {editor.discarding ? <div role="status" className="absolute inset-0 z-20 flex items-center justify-center bg-background-primary-default/80 text-body-2-regular text-text-tertiary">Discarding changes…</div> : null}
    {error && !history.open && !history.blocked ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Retry loading workbook" title={error} className={cx(ARTIFACT_ICON_BUTTON, 'absolute end-3 top-3 z-30')} onClick={() => { setRetry(value => value + 1); void history.refresh(); }} /> : null}
  </div>;
}
