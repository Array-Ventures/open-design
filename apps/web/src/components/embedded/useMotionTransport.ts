import { useEffect, type RefObject } from 'react';
import { MOTION_PREVIEW_PROBE, MOTION_PREVIEW_REQUEST } from '@open-design/contracts/runtime/motion-source-player';

interface MotionOwner { frame: HTMLIFrameElement; id: string; controllerId: string }
interface MotionDocument { probe: string; id: string | null; capable: boolean; loaded(): void }

/** Playback activity owns pausing. This bridge owns only the host control lease. */
export function useMotionTransport(projectId: string, surface: RefObject<HTMLDivElement>) {
  useEffect(() => {
    let current: MotionOwner | null = null;
    const documents = new Map<HTMLIFrameElement, MotionDocument>();
    const capableFrames = new WeakSet<HTMLIFrameElement>();
    const active = (frame: HTMLIFrameElement) => Boolean(surface.current?.contains(frame) && frame.isConnected && frame.dataset.odMotionActive === 'true');
    const withdraw = () => {
      if (!current) return;
      const previous = current; current = null;
      window.parent.postMessage({ type: 'studio:motion-unavailable', projectId, controllerId: previous.controllerId }, window.location.origin);
    };
    const challenge = (frame: HTMLIFrameElement, document: MotionDocument) => {
      document.probe = crypto.randomUUID(); document.id = null;
      frame.contentWindow?.postMessage({ type: MOTION_PREVIEW_PROBE, probe: document.probe }, '*');
    };
    const documentFor = (frame: HTMLIFrameElement) => {
      let document = documents.get(frame);
      if (!document) {
        const owned: MotionDocument = { probe: '', id: null, capable: capableFrames.has(frame), loaded() {
          if (current?.frame === frame) withdraw();
          challenge(frame, owned);
        } };
        documents.set(frame, owned); frame.addEventListener('load', owned.loaded);
        challenge(frame, owned); document = owned;
      }
      return document;
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'studio:motion-control') {
        if (event.source !== window.parent || event.origin !== window.location.origin || data.projectId !== projectId || !current) return;
        if (!active(current.frame)) { withdraw(); return; }
        // Older hosts have no controller field. New hosts must name this lease.
        if (data.controllerId !== undefined && data.controllerId !== current.controllerId) return;
        current.frame.contentWindow?.postMessage({ ...data, type: 'od:motion-control', id: current.id }, '*');
        return;
      }
      if (![MOTION_PREVIEW_REQUEST, 'od:motion-state'].includes(data.type) || typeof data.id !== 'string' || !data.id.length || data.id.length > 128) return;
      const frame = Array.from(surface.current?.querySelectorAll('iframe') ?? []).find(frame => frame.contentWindow === event.source && frame.isConnected);
      if (!frame || data.type === 'od:motion-state' && !active(frame)) return;
      // Current-document nonce replies remain useful while playback is inactive.
      // Publishing state and forwarding controls still require activity.
      const document = documentFor(frame);
      if (data.probeVersion === 1) { document.capable = true; capableFrames.add(frame); }
      if (data.type === MOTION_PREVIEW_REQUEST) {
        if (data.probeVersion === 1 && data.probe === document.probe) document.id = data.id;
        return;
      }
      if (data.probeVersion !== undefined && data.probeVersion !== 1) return;
      if (data.probeVersion === 1 && document.id !== data.id) return;
      // Legacy players do not echo probes. Keep basic playback, without claiming
      // the current-document freshness guarantee of versioned probe replies.
      if (data.probeVersion === undefined) {
        if (document.capable) return;
        document.id = data.id;
      }
      if (!Number.isFinite(data.time) || !Number.isFinite(data.duration) || data.duration <= 0 || data.time < 0 || data.time > data.duration || typeof data.playing !== 'boolean' || typeof data.muted !== 'boolean' || typeof data.hasAudio !== 'boolean') return;
      if (current?.frame !== frame || current.id !== data.id) {
        withdraw();
        current = { frame, id: data.id, controllerId: crypto.randomUUID() };
      }
      window.parent.postMessage({ type: 'studio:motion-state', projectId, controllerId: current.controllerId, time: data.time, duration: data.duration, playing: data.playing, muted: data.muted, hasAudio: data.hasAudio }, window.location.origin);
    };
    const observer = new MutationObserver(() => {
      if (current && !active(current.frame)) withdraw();
      for (const [frame, document] of documents) if (!surface.current?.contains(frame)) {
        frame.removeEventListener('load', document.loaded); documents.delete(frame);
      }
    });
    if (surface.current) observer.observe(surface.current, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-od-motion-active'] });
    window.addEventListener('message', receive);
    return () => {
      observer.disconnect(); window.removeEventListener('message', receive); withdraw();
      for (const [frame, document] of documents) frame.removeEventListener('load', document.loaded);
      documents.clear();
    };
  }, [projectId, surface]);
}
