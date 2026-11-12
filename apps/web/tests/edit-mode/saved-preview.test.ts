// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { verifySavedManualEditPreview } from '../../src/edit-mode/saved-preview';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });
const patch = { kind: 'set-text' as const, id: 'hero', value: 'Saved heading' };
function fixture() {
  const frame = document.createElement('iframe'); document.body.append(frame);
  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  const receive = (requestId: string, ok: boolean, source: Window | null = frame.contentWindow) => window.dispatchEvent(new MessageEvent('message', { source, data: { type: 'od-edit-saved-preview-result', requestId, ok } }));
  return { frame, post, receive };
}
it('accepts only the challenged current frame and nonce', async () => {
  vi.useFakeTimers(); const f = fixture(), other = fixture();
  const proof = verifySavedManualEditPreview(f.frame, patch);
  const request = f.post.mock.calls.at(-1)![0];
  f.receive(request.requestId, true, other.frame.contentWindow); f.receive('old-request', true);
  let settled = false; void proof.then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
  f.receive(request.requestId, true); expect(await proof).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('rejects missing acknowledgements, explicit mismatches and retired frames', async () => {
  vi.useFakeTimers(); const f = fixture();
  const missing = verifySavedManualEditPreview(f.frame, patch); await vi.advanceTimersByTimeAsync(1000); expect(await missing).toBe(false);
  const mismatch = verifySavedManualEditPreview(f.frame, patch); f.receive(f.post.mock.calls.at(-1)![0].requestId, false); expect(await mismatch).toBe(false);
  const retired = verifySavedManualEditPreview(f.frame, patch), request = f.post.mock.calls.at(-1)![0];
  f.frame.remove(); f.receive(request.requestId, true); expect(await retired).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
it('does not retain unsupported content replacements or a missing frame', async () => {
  const f = fixture(); expect(await verifySavedManualEditPreview(null, patch)).toBe(false);
  expect(await verifySavedManualEditPreview(f.frame, { id: 'hero', kind: 'set-outer-html', html: '<p>Replacement</p>' })).toBe(false);
  expect(f.post).not.toHaveBeenCalled();
});
