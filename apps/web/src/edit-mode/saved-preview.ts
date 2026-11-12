import type { ManualEditPatch } from './types';

/** A source save is not proof that the opaque live document painted it. Only
 * the challenged current frame may authorize retaining that document on exit. */
export function verifySavedManualEditPreview(frame: HTMLIFrameElement | null, patch: ManualEditPatch): Promise<boolean> {
  if (!frame?.contentWindow || !['set-text', 'set-style'].includes(patch.kind)) return Promise.resolve(false);
  const target = frame.contentWindow, requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const finish = (ok: boolean) => { window.clearTimeout(timeout); window.removeEventListener('message', receive); resolve(ok && frame.isConnected && frame.contentWindow === target); };
    const receive = (event: MessageEvent) => {
      const reply = event.data;
      if (event.source === target && reply?.type === 'od-edit-saved-preview-result' && reply.requestId === requestId) finish(reply.ok === true);
    };
    const timeout = window.setTimeout(() => finish(false), 1000);
    window.addEventListener('message', receive);
    try { target.postMessage({ type: 'od-edit-verify-saved-preview', requestId, patch }, '*'); }
    catch { finish(false); }
  });
}
