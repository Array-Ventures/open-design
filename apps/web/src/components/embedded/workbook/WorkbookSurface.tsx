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
  const editor = useWorkbookEditor(projectId, fileName, loaded, source => { setLoaded(source); onSaved?.(); }, onDirtyChange, recovery.session?.journal, () => { setLoaded(null); setRetry(value => value + 1); });
  close.current = editor.close;
  const operation = useRef<{ stamp: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (!operation.current || operation.current.stamp !== sourceStamp) operation.current = { stamp: sourceStamp, id: crypto.randomUUID() };
    void loadWorkbookPreview(projectId, fileName, operation.current.id, controller.signal).then(preview => {
      if (controller.signal.aborted) return;
      if (editor.stateRef.current.dirty) {
        operation.current = null;
        if (preview.sourceSha256 === loaded?.sourceSha256) return;
        setError('The workbook was refreshed while you have unsaved changes. Save or keep a copy before reloading.'); return;
      }
      setLoaded(current => current?.sourceSha256 === preview.sourceSha256 ? current : preview); setError(null);
      // A successful preview is removed. A later explicit reload needs fresh intent.
      operation.current = null;
    }).catch(cause => {
      if (controller.signal.aborted) return;
      if (cause instanceof WorkbookHostError && [410, 422].includes(cause.status)) operation.current = null;
      if (cause instanceof WorkbookHostError && [401, 403, 404].includes(cause.status)) setLoaded(null);
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
    <WorkbookGrid id={`${projectId}:${fileName}`} title={title} model={loaded.model} initialSnapshot={recovery.session.journal.restored?.desired} onReady={editor.ready} onSnapshot={editor.snapshot} />
  </Suspense>;
  else content = <div className="flex h-full items-center justify-center overflow-auto p-4">
    {recovery.busy && !recovery.drafts.length && !recovery.error ? <div role="status" className="text-body-2-regular text-text-tertiary">Checking workbook recovery…</div> :
      <WorkbookRecoveryCard drafts={recovery.drafts} busy={recovery.busy} error={recovery.error} onRestore={id => void recovery.restore(id)} onDiscard={id => void recovery.discard(id)} onDownload={id => void recovery.download(id)} onContinue={() => void recovery.continueCurrent()} />}
  </div>;
  return <div className="relative h-full min-h-0 w-full">
    <div className="h-full" onKeyDownCapture={event => { if (editor.discarding) { event.preventDefault(); event.stopPropagation(); } }} onPointerDownCapture={event => { if (editor.discarding) { event.preventDefault(); event.stopPropagation(); } }}>{content}</div>
    {editor.discarding ? <div role="status" className="absolute inset-0 flex items-center justify-center bg-background-primary-default/80 text-body-2-regular text-text-tertiary">Discarding changes…</div> : null}
    {editor.state.error || downloadError ? <div role="alert" className="absolute bottom-12 start-3 end-3 flex items-center gap-3 rounded-lg border border-border-button-default bg-background-primary-default p-3 text-body-2-regular text-text-error-primary">
      <span className="min-w-0 flex-1">{downloadError ?? editor.state.error}</span>
      <Button variant="ghost" size="small" iconOnly leadingIcon={RiDownloadLine} aria-label="Download recovery copy (JSON)" title="Download recovery copy (JSON)" onClick={downloadCurrent} />
    </div> : null}
    {error ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Retry loading workbook" title={error} className={cx(ARTIFACT_ICON_BUTTON, 'absolute end-3 top-3')} onClick={() => setRetry(value => value + 1)} /> : null}
  </div>;
}
