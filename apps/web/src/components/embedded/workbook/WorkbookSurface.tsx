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

const WorkbookGrid = lazy(() => import('./WorkbookGrid').then(module => ({ default: module.WorkbookGrid })));

interface Props { projectId: string; fileName: string; title: string; sourceStamp: string }
export function WorkbookSurface(props: Props) {
  const viewer = useEmbeddedViewer();
  if (!viewer) return <div role="status" className="p-4 text-body-2-regular text-text-tertiary">Loading workbook…</div>;
  return <ScopedWorkbookSurface key={`${viewer.memberId}:${props.projectId}:${props.fileName}`} {...props} />;
}
function ScopedWorkbookSurface({ projectId, fileName, title, sourceStamp }: Props) {
  const [loaded, setLoaded] = useState<{ sourceSha256: string; model: WorkbookDocument } | null>(null);
  const [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const operation = useRef<{ stamp: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (!operation.current || operation.current.stamp !== sourceStamp) operation.current = { stamp: sourceStamp, id: crypto.randomUUID() };
    void loadWorkbookPreview(projectId, fileName, operation.current.id, controller.signal).then(preview => {
      if (controller.signal.aborted) return;
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
  return <div className="relative h-full min-h-0 w-full">
    {loaded ? <Suspense fallback={<div role="status" className="p-4 text-body-2-regular text-text-tertiary">Loading workbook…</div>}><WorkbookGrid id={`${projectId}:${fileName}`} title={title} model={loaded.model} /></Suspense> : <div role={error ? 'alert' : 'status'} className="flex h-full items-center justify-center gap-2 p-4 text-body-2-regular text-text-tertiary">{error ?? 'Loading workbook…'}</div>}
    {error ? <Button variant="ghost" size="small" iconOnly leadingIcon={RiRefreshLine} aria-label="Retry loading workbook" title={error} className={cx(ARTIFACT_ICON_BUTTON, 'absolute end-3 top-3')} onClick={() => setRetry(value => value + 1)} /> : null}
  </div>;
}
