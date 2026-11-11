import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ANNOTATION_EVENT, type AnnotationEventDetail } from '../PreviewDrawOverlay';
import { stageHostContext } from './host-context';
import { FeedbackImageUpload } from './feedback-image-upload';
import { useArtifactScope } from './useArtifactScope';

/** The embedded canvas stages feedback in Evebot's composer; it never runs a bot. */
export function useEmbeddedMarkup(projectId: string, fileNames: string[]) {
  const scope = useArtifactScope(projectId);
  const upload = useRef(new FeedbackImageUpload());
  const [notice, setNotice] = useState<string | null>(null);
  const filesKey = JSON.stringify(fileNames);
  const allowed = useRef(new Set<string>());
  useLayoutEffect(() => { allowed.current = new Set<string>(JSON.parse(filesKey)); }, [filesKey]);
  useLayoutEffect(() => {
    const signal = scope();
    if (!signal) return;
    upload.current.clear(); setNotice(null);
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<AnnotationEventDetail>).detail;
      if (!detail || typeof detail.ack !== 'function' || signal.aborted) return;
      void (async () => {
        try {
          if (detail.action !== 'draft' || !detail.filePath || !allowed.current.has(detail.filePath)
            || typeof detail.note !== 'string' || detail.note.length > 24000) {
            detail.ack?.({ ok: false, message: 'Open this artifact and add its feedback to your chat draft.' });
            return;
          }
          const images = [detail.file, ...(detail.extraFiles ?? [])].filter((file): file is File => file instanceof File);
          if (!images.length && !detail.note.trim()) { detail.ack?.({ ok: false, message: 'Add a note or capture the marked image first.' }); return; }
          const key = JSON.stringify([detail.filePath, detail.note, detail.markKind, detail.bounds, detail.slideIndex]);
          const prepared = await upload.current.prepare(projectId, images, key, signal);
          if (signal.aborted || !allowed.current.has(detail.filePath)) { detail.ack?.({ ok: false, message: 'Reopen the artifact to add this feedback.' }); return; }
          const text = detail.note.trim() || 'Update the marked area.';
          let failure: string | undefined;
          const accepted = await stageHostContext(projectId, text, prepared.operationId, detail.preparationId, prepared.paths, [{ filePath: detail.filePath, kind: 'markup', label: 'Visual markup', ...(detail.slideIndex !== undefined ? { slideIndex: detail.slideIndex } : {}) }], message => { failure = message; });
          if (signal.aborted) { detail.ack?.({ ok: false, message: 'Reopen the artifact to add this feedback.' }); return; }
          if (accepted) upload.current.clear();
          setNotice(accepted ? 'Added to your chat draft.' : failure ?? 'The feedback could not be added. Try again.');
          detail.ack?.({ ok: accepted, ...(accepted ? {} : { message: failure ?? 'The feedback could not be added. Try again.' }) });
        } catch {
          detail.ack?.({ ok: false, message: 'The markup could not be added. Your drawing is still available.' });
        }
      })();
    };
    window.addEventListener(ANNOTATION_EVENT, receive);
    return () => { window.removeEventListener(ANNOTATION_EVENT, receive); };
  }, [projectId, scope]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  return notice;
}
