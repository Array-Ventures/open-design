import { useEffect, useRef } from 'react';

/** The native artifact header owns the controls; the canvas owns their behavior. */
export function ArtifactAnnotationControls({ projectId, commenting, marking, onComment, onMark, disabled = false }: {
  projectId: string; commenting: boolean; marking: boolean; onComment(): void; onMark(): void; disabled?: boolean;
}) {
  const controllerId = useRef(crypto.randomUUID()).current;
  const handlers = useRef({ onComment, onMark, disabled });
  useEffect(() => { handlers.current = { onComment, onMark, disabled }; }, [onComment, onMark, disabled]);
  useEffect(() => {
    if (window.parent === window) return;
    const publish = () => window.parent.postMessage({ type: 'studio:feedback-state', projectId, controllerId, commenting, marking, disabled }, window.location.origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.projectId !== projectId) return;
      if (event.data.type === 'studio:feedback-request') { publish(); return; }
      if (event.data.type !== 'studio:feedback-control' || event.data.controllerId !== controllerId || handlers.current.disabled) return;
      if (event.data.action === 'comment') handlers.current.onComment();
      if (event.data.action === 'markup') handlers.current.onMark();
    };
    window.addEventListener('message', receive);
    publish();
    return () => {
      window.removeEventListener('message', receive);
      window.parent.postMessage({ type: 'studio:feedback-unavailable', projectId, controllerId }, window.location.origin);
    };
  }, [projectId, controllerId, commenting, marking, disabled]);
  return null;
}
