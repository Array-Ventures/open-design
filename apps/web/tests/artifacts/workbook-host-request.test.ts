import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { workbookHostRequest } from '../../src/components/embedded/workbook/host-request';
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', origin = 'http://localhost:6261';
const request = { action: 'read-render' as const, renderId: '18a8301a-b6e1-4001-8000-c967b1eab223' };
let parent: { postMessage: ReturnType<typeof vi.fn> };
let listeners: Set<(event: MessageEvent) => void>;
beforeEach(() => {
  vi.useFakeTimers(); parent = { postMessage: vi.fn() }; listeners = new Set();
  vi.stubGlobal('window', { parent, location: { origin }, addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener), removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function response(source: unknown = parent, at = origin, project = projectId) {
  const sent = parent.postMessage.mock.calls[0]![0];
  for (const receive of listeners) receive({ source, origin: at, data: { type: 'studio:workbook-result', projectId: project, requestId: sent.requestId, result: { state: 'ready' } } } as MessageEvent);
}
it('accepts only its exact parent/origin/project and releases listeners and timers after a result', async () => {
  const pending = workbookHostRequest(projectId, request);
  response({}); response(parent, 'null'); response(parent, origin, 'different-project'); expect(listeners.size).toBe(1);
  response(); expect(await pending).toEqual({ state: 'ready' }); expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it('cancels on abort even when the parent closes before receiving cancellation', async () => {
  const controller = new AbortController(), pending = workbookHostRequest(projectId, request, controller.signal);
  parent.postMessage.mockImplementationOnce(() => { throw new Error('Closed frame'); }); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it('preserves uncertainty on timeout and cancels its outstanding native request', async () => {
  const pending = workbookHostRequest(projectId, request), failed = expect(pending).rejects.toMatchObject({ status: 0 });
  await vi.advanceTimersByTimeAsync(30_000); await failed;
  expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'studio:workbook-cancel' }), origin);
  expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it('cleans up immediately if the initial message cannot be sent', async () => {
  parent.postMessage.mockImplementationOnce(() => { throw new Error('Closed frame'); });
  await expect(workbookHostRequest(projectId, request)).rejects.toThrow('could not be sent'); expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
