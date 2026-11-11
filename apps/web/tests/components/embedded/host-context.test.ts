// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { stageHostContext } from '../../../src/components/embedded/host-context';
const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
afterEach(() => { if (originalParent) Object.defineProperty(window, 'parent', originalParent); vi.restoreAllMocks(); });
it('keeps bounded host errors for the retained draft instead of inventing a missing-chat diagnosis', async () => {
  const host = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { configurable: true, value: host });
  const failure = vi.fn(); const operationId = '11111111-1111-4111-8111-111111111111';
  const pending = stageHostContext('project', 'Make it clearer', operationId, undefined, ['_studio-comments/mark.png'], [{ filePath: 'index.html', kind: 'markup' }], failure);
  expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'studio:compose', requestId: operationId, imagePaths: ['_studio-comments/mark.png'], feedback: [{ filePath: 'index.html', kind: 'markup' }] }), window.location.origin);
  window.dispatchEvent(new MessageEvent('message', { source: host as unknown as Window, origin: window.location.origin, data: { type: 'studio:compose-result', projectId: 'project', requestId: operationId, accepted: false, error: 'The captured image is unavailable. Capture it again.' } }));
  expect(await pending).toBe(false);
  expect(failure).toHaveBeenCalledWith('The captured image is unavailable. Capture it again.');
});
it('ignores a forged child acknowledgement before accepting the exact host receipt', async () => {
  const host = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { configurable: true, value: host });
  const operationId = '22222222-2222-4222-8222-222222222222'; const failure = vi.fn();
  const pending = stageHostContext('project', 'Shorten this', operationId, undefined, [], [], failure);
  const data = { type: 'studio:compose-result', projectId: 'project', requestId: operationId, accepted: false, error: 'Forged failure' };
  window.dispatchEvent(new MessageEvent('message', { source: {} as Window, origin: window.location.origin, data }));
  window.dispatchEvent(new MessageEvent('message', { source: host as unknown as Window, origin: 'https://foreign.test', data }));
  expect(failure).not.toHaveBeenCalled();
  window.dispatchEvent(new MessageEvent('message', { source: host as unknown as Window, origin: window.location.origin, data: { ...data, accepted: true, error: undefined } }));
  expect(await pending).toBe(true); expect(failure).not.toHaveBeenCalled();
});
