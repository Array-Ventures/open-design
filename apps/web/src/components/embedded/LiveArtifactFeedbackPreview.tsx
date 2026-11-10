import { useEffect, useState, type ComponentProps } from 'react';
import { FileViewer } from '../FileViewer';
import type { ProjectFile } from '../../types';
import { Button } from './boardui/button';

export type ArtifactFeedbackProps = Pick<ComponentProps<typeof FileViewer>,
  'previewComments' | 'previewCommentsState' | 'onRetryPreviewComments' | 'onSavePreviewComment' |
  'onRemovePreviewComment' | 'onReorderPreviewComment' | 'onSendBoardCommentAttachments'>;

/** Annotate the frozen, authorized render; never fall back to the current template. */
export function LiveArtifactFeedbackPreview({ projectId, previewUrl, source, files, feedback }: {
  projectId: string; previewUrl: string; source: { sourceDirectory: string; templateFile: string };
  files: ProjectFile[]; feedback: ArtifactFeedbackProps;
}) {
  const path = `${source.sourceDirectory === '.' ? '' : source.sourceDirectory + '/'}${source.templateFile}`;
  const scope = `${projectId}\0${previewUrl.split('?')[0]}\0${path}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void fetch(previewUrl, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Preview unavailable');
      const html = await response.text();
      if (!controller.signal.aborted) setSnapshot({ scope, html });
    }).catch(() => { if (!controller.signal.aborted) setError(scope); });
    return () => controller.abort();
  }, [previewUrl, retry, scope]);
  const currentSnapshot = snapshot?.scope === scope ? snapshot : null;
  const failed = error === scope;
  const file = files.find(item => item.name === path);
  if (!file) return <div role="status" className="inline-preview-status">The dashboard source is unavailable.</div>;
  return <>
    {failed ? <div role="alert" className="inline-preview-status">The preview could not be loaded. <Button size="small" variant="ghost" onClick={() => setRetry(value => value + 1)}>Retry</Button></div> : null}
    {currentSnapshot ? <FileViewer key={scope} embedded inlineAnnotations staticSnapshot previewFrameTestId="live-artifact-preview-frame" projectId={projectId} projectKind="prototype"
      file={{ ...file, kind: 'html' }} liveHtml={currentSnapshot.html} manualEditEntryAllowed={false} {...feedback} />
      : !failed ? <div role="status" className="inline-preview-status">Loading preview…</div> : null}
  </>;
}
