import { useEffect, useLayoutEffect, useRef } from 'react';
import { z } from 'zod';

const Request = z.object({
  type: z.literal('studio:edit-control'), projectId: z.string(), controllerId: z.string().uuid(),
  requestId: z.string().uuid(), action: z.enum(['enter', 'exit']),
}).strict();

/** The parent owns the button/navigation; only this source-owning canvas may
 * acknowledge that editing has finished saving. No discard command exists. */
export function ArtifactEditControls({ projectId, active, busy, onEnter, onExit }: {
  projectId: string; active: boolean; busy: boolean;
  onEnter(): Promise<boolean | "cancelled">; onExit(): Promise<boolean>;
}) {
  const controllerId = useRef(crypto.randomUUID()).current;
  const current = useRef({ active, busy, onEnter, onExit });
  const publishRef = useRef<() => void>(() => {});
  useLayoutEffect(() => { current.current = { active, busy, onEnter, onExit }; });
  useEffect(() => {
    if (window.parent === window) return;
    const host = window.parent;
    const origin = window.location.origin;
    let alive = true;
    let pending = false;
    let quietCancellation = false;
    const post = (data: object) => { if (alive) host.postMessage({ projectId, controllerId, ...data }, origin); };
    const publish = () => post({ type: 'studio:edit-state', active: current.current.active, busy: current.current.busy || pending, ...(quietCancellation ? { quietCancellation: true } : {}) });
    publishRef.current = publish;
    const receive = (event: MessageEvent) => {
      if (event.source !== host || event.origin !== origin || event.data?.projectId !== projectId) return;
      if (event.data.type === 'studio:edit-request') { quietCancellation = event.data.quietCancellation === true; publish(); return; }
      const parsed = Request.safeParse(event.data);
      if (!parsed.success || parsed.data.controllerId !== controllerId) return;
      const { action, requestId } = parsed.data;
      const reply = (outcome: boolean | 'cancelled') => post({ type: 'studio:edit-result', requestId, accepted: outcome === true,
        ...(outcome === 'cancelled' && quietCancellation ? { cancelled: true } : outcome !== true ? { error: 'Your changes remain open. Finish saving in the artifact, then try again.' } : {}) });
      if (pending) { reply(false); return; }
      pending = true; publish();
      void (async () => {
        try {
          const handler = action === 'enter' ? current.current.onEnter : current.current.onExit;
          const accepted = action === 'enter' && current.current.active || action === 'exit' && !current.current.active
            ? true : await handler();
          reply(accepted);
        } catch { reply(false); }
        finally { pending = false; publish(); }
      })();
    };
    window.addEventListener('message', receive);
    publish();
    return () => {
      post({ type: 'studio:edit-unavailable' });
      alive = false;
      publishRef.current = () => {};
      window.removeEventListener('message', receive);
    };
  }, [projectId, controllerId]);
  useEffect(() => { publishRef.current(); }, [active, busy]);
  return null;
}
