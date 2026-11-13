import { useEffect, useRef } from 'react';

/** The native artifact header owns the controls; the canvas owns their behavior. */
export function ArtifactAnnotationControls({ projectId, commenting, marking, onComment, onMark, onComments, onDiscard, dirty = false, disabled = false, markupAvailable = true }: {
  projectId: string; commenting: boolean; marking: boolean; onComment(): void; onMark(): void; onComments?(returnFocus: () => void): void; onDiscard?(): void; dirty?: boolean; disabled?: boolean; markupAvailable?: boolean;
}) {
  const commentsAvailable = Boolean(onComments);
  const controllerId = useRef(crypto.randomUUID()).current;
  const handlers = useRef({ onComment, onMark, onComments, onDiscard, disabled });
  useEffect(() => { handlers.current = { onComment, onMark, onComments, onDiscard, disabled }; }, [onComment, onMark, onComments, onDiscard, disabled]);
  useEffect(() => {
    if (window.parent === window) return;
    const publish = () => window.parent.postMessage({ type: 'studio:feedback-state', projectId, controllerId, commenting, marking, dirty, disabled, commentsAvailable, ...(markupAvailable ? {} : { markupAvailable: false }) }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.projectId !== projectId) return;
      if (event.data.type === 'studio:feedback-request') { publish(); return; }
      if (event.data.type === 'studio:discard-feedback' && event.data.controllerId === controllerId) { handlers.current.onDiscard?.(); return; }
      if (event.data.type !== 'studio:feedback-control' || event.data.controllerId !== controllerId || handlers.current.disabled) return;
      if (event.data.action === 'comment') handlers.current.onComment();
      if (event.data.action === 'comments') handlers.current.onComments?.(() => window.parent.postMessage({ type: 'studio:feedback-focus', projectId, controllerId }, window.location.origin));
      if (event.data.action === 'markup') handlers.current.onMark();
    };
    window.addEventListener('message', receive);
    publish();
    return () => {
      window.removeEventListener('message', receive);
    };
  }, [projectId, controllerId, commenting, marking, dirty, disabled, commentsAvailable, markupAvailable]);
  useEffect(() => () => { if (window.parent !== window) window.parent.postMessage({ type: 'studio:feedback-unavailable', projectId, controllerId }, window.location.origin); }, [projectId, controllerId]);
  return null;
}
