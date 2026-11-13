import { useCallback, useLayoutEffect, useRef } from 'react';
import { useEmbeddedViewer } from './host-viewer';

/** Async feedback belongs to the artifact and person that started it. */
export function useArtifactScope(projectId: string): () => AbortSignal | null {
  const viewerId = useEmbeddedViewer()?.memberId;
  const key = JSON.stringify([projectId, viewerId]);
  const current = useRef<{ key: string; controller: AbortController } | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    current.current = { key, controller };
    return () => controller.abort();
  }, [key]);
  return useCallback(() => {
    const scope = current.current;
    return scope?.key === key && !scope.controller.signal.aborted ? scope.controller.signal : null;
  }, [key]);
}
