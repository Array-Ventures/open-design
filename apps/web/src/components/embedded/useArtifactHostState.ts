import { useEffect } from 'react';
import type { ArtifactEntry } from './artifact-entry';

/** Only the trusted embedded shell sends this; authored content stays in an opaque child frame. */
export function useArtifactHostState(projectId: string, entry: ArtifactEntry | null, snapshot: boolean) {
  const fileName = entry?.file.name ?? null;
  const kind = entry?.kind ?? 'other';
  const title = (entry?.title || 'Artifact').slice(0, 160);
  const document = kind === 'document' && Boolean(fileName && /\.(html?|md|markdown)$/i.test(fileName));
  const html = Boolean(fileName && /\.html?$/i.test(fileName));
  useEffect(() => {
    if (window.parent === window) return;
    const send = () => {
      window.parent.postMessage({ type: 'studio:artifact-availability', projectId, available: Boolean(entry || snapshot) }, window.location.origin);
      window.parent.postMessage({ type: 'studio:artifact-state', projectId,
      entry: !snapshot && fileName ? { fileName, kind, title, formats: kind === 'workbook' ? (/\.csv$/i.test(fileName) ? ['csv'] : ['xlsx', 'csv']) : document ? ['docx', 'pdf', 'markdown'] : html ? kind === 'deck' ? ['html', 'pdf', 'image', 'pptx'] : ['html', 'pdf', 'image'] : [] } : null,
      }, window.location.origin);
    };
    const receive = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === window.location.origin && event.data?.type === 'studio:artifact-request' && event.data.projectId === projectId) send();
    };
    window.addEventListener('message', receive);
    send();
    return () => { window.removeEventListener('message', receive); window.parent.postMessage({ type: 'studio:artifact-state', projectId, entry: null }, window.location.origin); window.parent.postMessage({ type: 'studio:artifact-availability', projectId, available: false }, window.location.origin); };
  }, [projectId, fileName, kind, title, html, document, snapshot]);
}
