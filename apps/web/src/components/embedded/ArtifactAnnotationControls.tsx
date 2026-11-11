import { useEffect, useRef } from 'react';

/** The native artifact header owns the controls; the canvas owns their behavior. */
export function ArtifactAnnotationControls({ projectId, commenting, marking, onComment, onMark, onDiscard, dirty = false, disabled = false }: {
  projectId: string; commenting: boolean; marking: boolean; onComment(): void; onMark(): void; onDiscard?(): void; dirty?: boolean; disabled?: boolean;
}) {
  const controllerId = useRef(crypto.randomUUID()).current;
  const handlers = useRef({ onComment, onMark, onDiscard, disabled });
  useEffect(() => { handlers.current = { onComment, onMark, onDiscard, disabled }; }, [onComment, onMark, onDiscard, disabled]);
  useEffect(() => {
    if (window.parent === window) return;
    const publish = () => window.parent.postMessage({ type: 'studio:feedback-state', projectId, controllerId, commenting, marking, dirty, disabled }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.projectId !== projectId) return;
      if (event.data.type === 'studio:feedback-request') { publish(); return; }
      if (event.data.type === 'studio:discard-feedback' && event.data.controllerId === controllerId) { handlers.current.onDiscard?.(); return; }
      if (event.data.type !== 'studio:feedback-control' || event.data.controllerId !== controllerId || handlers.current.disabled) return;
      if (event.data.action === 'comment') handlers.current.onComment();
      if (event.data.action === 'markup') handlers.current.onMark();
    };
    window.addEventListener('message', receive);
    publish();
    return () => {
      window.removeEventListener('message', receive);
    };
  }, [projectId, controllerId, commenting, marking, dirty, disabled]);
  useEffect(() => () => { if (window.parent !== window) window.parent.postMessage({ type: 'studio:feedback-unavailable', projectId, controllerId }, window.location.origin); }, [projectId, controllerId]);
  return null;
}
