// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtifactEditControls } from '../../../src/components/embedded/ArtifactEditControls';
const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
afterEach(() => { cleanup(); if (originalParent) Object.defineProperty(window, 'parent', originalParent); });
function harness(active = true, onExit = vi.fn(async () => true)) {
  const host = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { configurable: true, value: host });
  const onEnter = vi.fn(async () => true);
  const view = render(<ArtifactEditControls projectId="project-a" active={active} busy={false} onEnter={onEnter} onExit={onExit} />);
  const controllerId = host.postMessage.mock.calls[0]![0].controllerId;
  const request = { type: 'studio:edit-control', projectId: 'project-a', controllerId, requestId: crypto.randomUUID(), action: 'exit' };
  const send = async (data = request, source: unknown = host, origin = window.location.origin) => {
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { source: source as Window, origin, data })); });
  };
  const results = () => host.postMessage.mock.calls.map(([message]) => message).filter(message => message.type === 'studio:edit-result');
  return { host, view, controllerId, onEnter, onExit, request, send, results };
}
it('accepts only parent-origin, controller-bound, well-formed requests', async () => {
  const h = harness();
  await h.send(h.request, {}); await h.send(h.request, h.host, 'https://foreign.test');
  await h.send({ ...h.request, controllerId: crypto.randomUUID() });
  await h.send({ ...h.request, requestId: 'invalid' });
  await h.send({ ...h.request, arbitrary: true } as typeof h.request);
  expect(h.onExit).not.toHaveBeenCalled();
  await h.send();
  expect(h.onExit).toHaveBeenCalledOnce();
  expect(h.results()).toEqual([expect.objectContaining({ requestId: h.request.requestId, accepted: true })]);
});
it('withholds success until the source writer settles and refuses overlapping exits', async () => {
  let finish!: (accepted: boolean) => void;
  const h = harness(true, vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })));
  await h.send(); expect(h.results()).toEqual([]);
  const second = { ...h.request, requestId: crypto.randomUUID() }; await h.send(second);
  expect(h.onExit).toHaveBeenCalledOnce();
  expect(h.results()).toEqual([expect.objectContaining({ requestId: second.requestId, accepted: false })]);
  await act(async () => { finish(true); });
  expect(h.results()).toContainEqual(expect.objectContaining({ requestId: h.request.requestId, accepted: true }));
});
it.each(['denied', 'rejected'] as const)('keeps %s saves from granting navigation', async outcome => {
  const h = harness(true, vi.fn(async () => { if (outcome === 'rejected') throw new Error('private failure'); return false; }));
  await h.send(); expect(h.results()).toEqual([expect.objectContaining({ accepted: false, error: expect.not.stringContaining('private failure') })]);
});
it('retires a controller without replying to a save after the surface has gone', async () => {
  let finish!: (accepted: boolean) => void;
  const h = harness(true, vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })));
  await h.send(); h.view.unmount();
  expect(h.host.postMessage).toHaveBeenLastCalledWith({ type: 'studio:edit-unavailable', projectId: 'project-a', controllerId: h.controllerId }, window.location.origin);
  await act(async () => { finish(true); });
  expect(h.results()).toEqual([]);
});
it('acknowledges entering through the actual handler, and an already closed exit without a write', async () => {
  const h = harness(false); await h.send(); expect(h.onExit).not.toHaveBeenCalled();
  await h.send({ ...h.request, requestId: crypto.randomUUID(), action: 'enter' }); expect(h.onEnter).toHaveBeenCalledOnce();
  expect(h.results().every(result => result.accepted)).toBe(true);
});
