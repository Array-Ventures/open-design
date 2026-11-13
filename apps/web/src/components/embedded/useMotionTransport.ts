import { useEffect, type RefObject } from 'react';

/** Only the mounted preview frame can report media state; only its host can drive it. */
export function useMotionTransport(projectId: string, surface: RefObject<HTMLDivElement>) {
  useEffect(() => {
    let current: { frame: HTMLIFrameElement; id: string } | null = null;
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'studio:motion-control') {
        if (event.source !== window.parent || event.origin !== window.location.origin || data.projectId !== projectId || !current || !surface.current?.contains(current.frame)) return;
        current.frame.contentWindow?.postMessage({ ...data, type: 'od:motion-control', id: current.id }, '*');
        return;
      }
      if (data.type !== 'od:motion-state' || typeof data.id !== 'string' || data.id.length > 128) return;
      const frame = Array.from(surface.current?.querySelectorAll('iframe') ?? []).find(frame => frame.contentWindow === event.source && frame.dataset.odMotionActive === 'true');
      if (!frame) return;
      if (!Number.isFinite(data.time) || !Number.isFinite(data.duration) || data.duration <= 0 || data.time < 0 || data.time > data.duration || typeof data.playing !== 'boolean' || typeof data.muted !== 'boolean' || typeof data.hasAudio !== 'boolean') return;
      current = { frame, id: data.id };
      window.parent.postMessage({ type: 'studio:motion-state', projectId, time: data.time, duration: data.duration, playing: data.playing, muted: data.muted, hasAudio: data.hasAudio }, window.location.origin);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [projectId, surface]);
}
