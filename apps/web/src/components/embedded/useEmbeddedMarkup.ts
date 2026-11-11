import { useEffect, useRef, useState } from 'react';
import { ANNOTATION_EVENT, type AnnotationEventDetail } from '../PreviewDrawOverlay';
import { stageHostContext } from './host-context';
import { FeedbackImageUpload } from './feedback-image-upload';

/** The embedded canvas stages feedback in Evebot's composer; it never runs a bot. */
export function useEmbeddedMarkup(projectId: string, fileNames: string[]) {
  const upload = useRef(new FeedbackImageUpload());
  const [notice, setNotice] = useState<string | null>(null);
  const filesKey = JSON.stringify(fileNames);
  const allowed = useRef(new Set<string>());
  useEffect(() => { allowed.current = new Set<string>(JSON.parse(filesKey)); }, [filesKey]);
  useEffect(() => {
    let active = true;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<AnnotationEventDetail>).detail;
      if (!detail || typeof detail.ack !== 'function') return;
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
          const prepared = await upload.current.prepare(projectId, images, key);
          if (!active) { detail.ack?.({ ok: false, message: 'Reopen the artifact to add this feedback.' }); return; }
          const text = detail.note.trim() || 'Update the marked area.';
          const accepted = await stageHostContext(projectId, text, prepared.operationId, detail.preparationId, prepared.paths, [{ filePath: detail.filePath, kind: 'markup', label: 'Visual markup', ...(detail.slideIndex !== undefined ? { slideIndex: detail.slideIndex } : {}) }]);
          if (accepted) upload.current.clear();
          if (active) setNotice(accepted ? 'Added to your chat draft.' : 'Open a chat beside this artifact and try again.');
          detail.ack?.({ ok: accepted, ...(accepted ? {} : { message: 'Open a chat beside this artifact and try again.' }) });
        } catch {
          detail.ack?.({ ok: false, message: 'The markup could not be added. Your drawing is still available.' });
        }
      })();
    };
    window.addEventListener(ANNOTATION_EVENT, receive);
    return () => { active = false; window.removeEventListener(ANNOTATION_EVENT, receive); };
  }, [projectId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  return notice;
}
