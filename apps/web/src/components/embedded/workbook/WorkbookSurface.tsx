'use client';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { RiDownloadLine, RiRefreshLine } from '@remixicon/react';
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

interface Props { projectId: string; fileName: string; title: string; sourceStamp: string; onDirtyChange?(dirty: boolean): void; onSaved?(): void }
export function WorkbookSurface(props: Props) {
  const viewer = useEmbeddedViewer();
  if (!viewer) return <div role="status" className="p-4 text-body-2-regular text-text-tertiary">Loading workbook…</div>;
  return <ScopedWorkbookSurface key={`${viewer.memberId}:${props.projectId}:${props.fileName}`} {...props} viewerId={viewer.memberId} />;
}
function ScopedWorkbookSurface({ projectId, fileName, title, sourceStamp, onDirtyChange, onSaved, viewerId }: Props & { viewerId: string }) {
  const [loaded, setLoaded] = useState<{ sourceSha256: string; model: WorkbookDocument } | null>(null);
  const [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const close = useRef<() => Promise<void>>(async () => {});
  const recovery = useWorkbookRecovery({ viewerId, projectId, fileName }, Boolean(loaded), () => close.current());
  const editorRef = useRef<ReturnType<typeof useWorkbookEditor> | null>(null);
  const history = useWorkbookHistory({ scope: { viewerId, projectId, fileName }, source: loaded, ready: Boolean(recovery.session),
    dirty: () => !editorRef.current || editorRef.current.stateRef.current.dirty || editorRef.current.discarding,
    pause: async () => editorRef.current?.pause() ?? false,
    resume: async accepted => { await editorRef.current?.resumeClean(accepted); },
    accepted: source => { setLoaded(source); setError(null); onSaved?.(); },
    unreadable: (message, refresh = true) => { setLoaded(null); setError(message ?? 'The saved version was restored but cannot be previewed. Choose another version in History.'); if (refresh) onSaved?.(); },
    onAccessLost: () => { void editorRef.current?.close(); setLoaded(null); setError('This workbook is unavailable. Reopen it after checking access.'); },
    focusOnClose: () => window.parent.postMessage({ type: 'studio:workbook-history-focus', projectId, controllerId: editorRef.current?.controllerId }, window.location.origin),
  });
  const editor = useWorkbookEditor(projectId, fileName, loaded, source => { setLoaded(source); onSaved?.(); }, dirty => onDirtyChange?.(dirty || history.blocked), recovery.session?.journal, () => { setLoaded(null); setRetry(value => value + 1); }, { open: history.open, blocked: history.blocked, visible: history.canOpen, show: history.toggle });
  editorRef.current = editor;
  const historyRef = useRef(history); historyRef.current = history;
  close.current = editor.close;
  useEffect(() => { onDirtyChange?.(editor.state.dirty || history.blocked); }, [onDirtyChange, editor.state.dirty, history.blocked]);
  const operation = useRef<{ stamp: string; id: string } | null>(null);
  useEffect(() => {
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
  }, [projectId, fileName, sourceStamp, retry]);
  const downloadCurrent = () => {
    try {
      const checkpoint = editor.checkpoint(); if (!checkpoint || !recovery.session) return;
      downloadWorkbookDraft(recovery.session.scope, checkpoint); setDownloadError(null);
    } catch { setDownloadError('The recovery copy could not be downloaded. Keep this workbook open.'); }
  };
  let content;
  if (!loaded) content = <div role={error ? 'alert' : 'status'} className="flex h-full items-center justify-center gap-2 p-4 text-body-2-regular text-text-tertiary">{error ?? 'Loading workbook…'}</div>;
  else if (recovery.session) content = <Suspense fallback={<div role="status" className="p-4 text-body-2-regular text-text-tertiary">Loading workbook…</div>}>
    <WorkbookGrid id={`${projectId}:${fileName}`} title={title} model={loaded.model} initialSnapshot={recovery.session.journal.restored?.desired} onReady={editor.ready} onSnapshot={editor.snapshot} formatScope={{ projectId, controllerId: editor.controllerId, blocked: editor.discarding || history.blocked }} />
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
    {editor.state.error || downloadError ? <div role="alert" className="absolute bottom-12 start-3 end-3 z-10 flex items-center gap-3 rounded-lg border border-border-button-default bg-background-primary-default p-3 text-body-2-regular text-text-error-primary">
      <span className="min-w-0 flex-1">{downloadError ?? editor.state.error}</span>
      <Button variant="ghost" size="small" iconOnly leadingIcon={RiDownloadLine} className={cx(ARTIFACT_ICON_BUTTON, 'shrink-0')} aria-label="Download recovery copy (JSON)" title="Download recovery copy (JSON)" onClick={downloadCurrent} />
    </div> : null}
    {error && !history.open && !history.blocked ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Retry loading workbook" title={error} className={cx(ARTIFACT_ICON_BUTTON, 'absolute end-3 top-3 z-30')} onClick={() => { setRetry(value => value + 1); void history.refresh(); }} /> : null}
  </div>;
}
