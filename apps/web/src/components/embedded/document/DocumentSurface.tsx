import type { ArtifactFeedbackProps } from '../LiveArtifactFeedbackPreview';
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RiRefreshLine } from '@remixicon/react';
import { Button } from '../boardui/button';
import { useEmbeddedViewer } from '../host-viewer';
import { confirmHostFeedbackDiscard } from '../host-context';
import { readDocumentFile, type DocumentFile } from './document-file';
import { isEditableDocument, isDocumentLinkSupported } from './document-html';
import { supportedDocumentImageElement } from './document-image-source';
import { DOCUMENT_ICON_BUTTON } from './document-controls';
import { DocumentEditor } from './DocumentEditor';

const supported = new Set(['main', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'br', 'span', 'code', 'pre', 'img']);
function supportedDocument(html: string, fileName: string): boolean {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return isEditableDocument(html) && [...parsed.body.querySelectorAll('*')].every(element => supported.has(element.tagName.toLowerCase())) && [...parsed.body.querySelectorAll('a[href]')].every(link => isDocumentLinkSupported(link.getAttribute('href')!)) && [...parsed.body.querySelectorAll('img')].every(image => supportedDocumentImageElement(image, fileName));
}

type DocumentSurfaceProps = {
  feedback?: ArtifactFeedbackProps; projectId: string; fileName: string; title: string; generation?: number; fallback: ReactNode; onSaved(): void; onDirtyChange?(dirty: boolean): void;
};
/** Account changes invalidate editor state and outstanding reads, even for the same project URL. */
export function DocumentSurface(props: DocumentSurfaceProps) {
  const viewer = useEmbeddedViewer();
  if (!viewer && (typeof window === 'undefined' || window.parent !== window)) return <div role="status" className="p-4 text-body-2-regular text-text-tertiary">Loading document…</div>;
  return <ScopedDocumentSurface key={`${viewer?.memberId ?? 'pending'}:${props.projectId}:${props.fileName}`} {...props} />;
}
/** Keep an active draft mounted across external file reads and refresh failures. */
function ScopedDocumentSurface({ feedback, projectId, fileName, title, generation = 0, fallback, onSaved, onDirtyChange }: DocumentSurfaceProps) {
  const [loaded, setLoaded] = useState<DocumentFile | null>(null);
  const [pending, setPending] = useState<{ file: DocumentFile; base: string | null } | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [retry, setRetry] = useState(0);
  const failRead = (cause: unknown) => {
    const status = typeof cause === 'object' && cause !== null && 'status' in cause ? Number(cause.status) : 0;
    if ([401, 403, 404].includes(status)) setAccessLost(true);
    setError(cause instanceof Error ? cause.message : 'The document could not be loaded.');
  };
  const acknowledged = useRef<string | null>(null);
  const dirtyCurrent = useRef(false), documentDirty = useRef(false), commentDirty = useRef(false);
  const savingCurrent = useRef(false);
  const revision = useRef(0);
  const reload = useRef<AbortController | null>(null);
  useEffect(() => () => { reload.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController(); const base = acknowledged.current;
    void readDocumentFile(projectId, fileName, controller.signal).then(value => {
      if (controller.signal.aborted || (base !== acknowledged.current && value.sha256 !== acknowledged.current)) return;
      setError(null); setAccessLost(false);
      if (value.sha256 === acknowledged.current) { setPending(null); return; }
      if (dirtyCurrent.current) { setPending({ file: value, base }); return; }
      acknowledged.current = value.sha256; setLoaded(value); setPending(null);
    }).catch(cause => { if (!controller.signal.aborted) failRead(cause); });
    return () => controller.abort();
  }, [projectId, fileName, generation, retry]);
  useEffect(() => {
    if (!dirty && pending) {
      if (pending.file.sha256 !== acknowledged.current) {
        if (pending.base === acknowledged.current) { acknowledged.current = pending.file.sha256; setLoaded(pending.file); }
        else setRetry(value => value + 1);
      }
      setPending(null);
    }
  }, [dirty, pending]);
  const loadLatest = async () => {
    if (reload.current || savingCurrent.current) return;
    const controller = new AbortController(); reload.current = controller; setReloading(true);
    const captured = revision.current; const base = acknowledged.current;
    try {
      if (dirtyCurrent.current && !await confirmHostFeedbackDiscard(projectId, 'document')) return;
      if (controller.signal.aborted || revision.current !== captured || savingCurrent.current) return;
      const value = await readDocumentFile(projectId, fileName, controller.signal);
      if (controller.signal.aborted) return;
      if (revision.current !== captured || acknowledged.current !== base || savingCurrent.current) {
        setError('The document changed while loading. Try again.'); return;
      }
      acknowledged.current = value.sha256; dirtyCurrent.current = false; setDirty(false); setLoaded(value); setReloadEpoch(value => value + 1); setPending(null); setError(null); setAccessLost(false); onDirtyChange?.(false);
    } catch (cause) { if (!controller.signal.aborted) failRead(cause); }
    finally { if (reload.current === controller) reload.current = null; if (!controller.signal.aborted) setReloading(false); }
  };
  if (accessLost) return <div role="alert" className="flex items-center gap-2 p-4 text-body-2-regular text-text-tertiary">Document unavailable.<Button variant="ghost" size="small" iconOnly className={DOCUMENT_ICON_BUTTON} leadingIcon={RiRefreshLine} aria-label="Retry loading document" onClick={() => setRetry(value => value + 1)} /></div>;
  if (!loaded) return <div role={error ? 'alert' : 'status'} className="flex items-center gap-2 p-4 text-body-2-regular text-text-tertiary">{error ?? 'Loading document…'}{error ? <Button variant="ghost" size="small" iconOnly className={DOCUMENT_ICON_BUTTON} leadingIcon={RiRefreshLine} aria-label="Retry loading document" onClick={() => setRetry(value => value + 1)} /> : null}</div>;
  // Unsupported semantic nodes stay in the original viewer rather than disappearing on save.
  if (!supportedDocument(loaded.html, fileName)) return <>{fallback}</>;
  return <div className="flex min-h-0 flex-1 flex-col">
    {pending || error || writeError ? <div role={writeError ? "alert" : "status"} className="flex items-center gap-2 px-3 py-2 text-caption-1-regular text-text-tertiary">{error ?? writeError ?? 'Document changed elsewhere.'}<Button variant="ghost" size="small" iconOnly className={DOCUMENT_ICON_BUTTON} leadingIcon={RiRefreshLine} aria-label="Load latest document" title="Load latest" disabled={saving || reloading} onClick={() => { void loadLatest(); }} /></div> : null}
    <DocumentEditor onCommentDirtyChange={value => { revision.current++; commentDirty.current = value; dirtyCurrent.current = value || documentDirty.current; setDirty(dirtyCurrent.current); onDirtyChange?.(dirtyCurrent.current); }} feedback={feedback} key={`${loaded.sha256}:${reloadEpoch}`} projectId={projectId} fileName={fileName} title={title} observed={loaded}
      onDirtyChange={(value, activeSave) => { revision.current++; documentDirty.current = value; dirtyCurrent.current = value || commentDirty.current; savingCurrent.current = activeSave; setDirty(dirtyCurrent.current); setSaving(activeSave); onDirtyChange?.(dirtyCurrent.current); }}
      onWriteError={setWriteError}
      onSaved={value => { revision.current++; acknowledged.current = value.sha256; onSaved(); }} />
  </div>;
}
