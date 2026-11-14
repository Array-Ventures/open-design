// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMotionTransport } from '../../../src/components/embedded/useMotionTransport';
const projectId = 'owned-motion';
const state = { type: 'od:motion-state', probeVersion: 1, id: 'document-a', time: 1, duration: 10, playing: false, muted: true, hasAudio: true };
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function fixture() {
  const parent = { postMessage: vi.fn() };
  vi.stubGlobal('parent', parent);
  const surface = document.createElement('div');
  const frame = document.createElement('iframe');
  frame.dataset.odMotionActive = 'true'; surface.append(frame); document.body.append(surface);
  const send = vi.spyOn(frame.contentWindow!, 'postMessage');
  const hook = renderHook(() => useMotionTransport(projectId, { current: surface }));
  const rawEmit = (data: unknown = state, source: Window = frame.contentWindow!) => act(() => {
    window.dispatchEvent(new MessageEvent('message', { source, origin: 'null', data }));
  });
  const emit = (data = state) => {
    rawEmit(data);
    const probe = send.mock.calls.slice().reverse().find(call => call[0]?.type === 'od:motion-preview-probe')?.[0].probe;
    rawEmit({ type: 'od:motion-preview-request', probeVersion: 1, id: data.id, probe });
    rawEmit(data); send.mockClear(); return probe;
  };
  const control = (controllerId?: string) => act(() => window.dispatchEvent(new MessageEvent('message', {
    source: parent as unknown as Window, origin: window.location.origin,
    data: { type: 'studio:motion-control', projectId, action: 'play', ...(controllerId ? { controllerId } : {}) },
  })));
  return { parent, surface, frame, hook, send, emit, rawEmit, control };
}
it.each(['removed', 'inactive'] as const)('withdraws the exact media owner when its frame becomes %s', async reason => {
  const f = fixture(); f.emit();
  const published = f.parent.postMessage.mock.calls.at(-1)![0];
  expect(published.controllerId).toEqual(expect.any(String));
  await act(async () => { if (reason === 'removed') f.frame.remove(); else f.frame.dataset.odMotionActive = 'false'; });
  expect(f.parent.postMessage).toHaveBeenLastCalledWith({ type: 'studio:motion-unavailable', projectId, controllerId: published.controllerId }, window.location.origin);
  f.control(published.controllerId); expect(f.send).not.toHaveBeenCalled();
});
it('does not retarget an old owner command to a replacement document', () => {
  const f = fixture(); f.emit(); const old = f.parent.postMessage.mock.calls.at(-1)![0].controllerId;
  act(() => f.frame.dispatchEvent(new Event('load')));
  f.emit({ ...state, id: 'document-b' }); const next = f.parent.postMessage.mock.calls.at(-1)![0].controllerId;
  expect(next).not.toBe(old); f.send.mockClear();
  f.control(old); expect(f.send).not.toHaveBeenCalled();
  f.control(next); expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'od:motion-control', id: 'document-b' }), '*');
});
it('rejects old document state after load while accepting a new document without replacing its WindowProxy', () => {
  const f = fixture(); f.emit(); const old = f.parent.postMessage.mock.calls.at(-1)![0].controllerId;
  act(() => f.frame.dispatchEvent(new Event('load')));
  const calls = f.parent.postMessage.mock.calls.length;
  f.rawEmit(); expect(f.parent.postMessage).toHaveBeenCalledTimes(calls);
  f.emit({ ...state, id: 'document-b' }); expect(f.parent.postMessage.mock.calls.at(-1)![0].controllerId).not.toBe(old);
});

it('keeps old-host basic controls while rejecting forged hosts and inactive frames before observer delivery', () => {
  const f = fixture(); f.rawEmit({ ...state, probeVersion: undefined }); f.send.mockClear(); f.control();
  expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'od:motion-control', id: 'document-a' }), '*');
  f.send.mockClear();
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { type: 'studio:motion-control', projectId, action: 'play' } })));
  expect(f.send).not.toHaveBeenCalled();
  act(() => { f.frame.dataset.odMotionActive = 'false'; f.control(); });
  expect(f.send).not.toHaveBeenCalled();
});
it('reactivates the same retained document under a new lease and withdraws on cleanup', async () => {
  const f = fixture(); f.emit(); const old = f.parent.postMessage.mock.calls.at(-1)![0].controllerId;
  await act(async () => { f.frame.dataset.odMotionActive = 'false'; });
  await act(async () => { f.frame.dataset.odMotionActive = 'true'; });
  f.emit(); const next = f.parent.postMessage.mock.calls.at(-1)![0].controllerId;
  expect(next).not.toBe(old); f.control(old); expect(f.send).not.toHaveBeenCalled();
  f.hook.unmount(); expect(f.parent.postMessage).toHaveBeenLastCalledWith({ type: 'studio:motion-unavailable', projectId, controllerId: next }, window.location.origin);
});

it('reprobes a genuine current document that reported before its first load', () => {
  const f = fixture(); f.emit(); const before = f.parent.postMessage.mock.calls.at(-1)![0].controllerId;
  act(() => f.frame.dispatchEvent(new Event('load')));
  f.emit(); expect(f.parent.postMessage.mock.calls.at(-1)![0]).toMatchObject({ type: 'studio:motion-state', time: 1 });
  expect(f.parent.postMessage.mock.calls.at(-1)![0].controllerId).not.toBe(before);
});

it('never downgrades an advertised capable frame through a queued unversioned state or stale probe', () => {
  const f = fixture(); const oldProbe = f.emit();
  act(() => f.frame.dispatchEvent(new Event('load')));
  const count = f.parent.postMessage.mock.calls.length;
  f.rawEmit({ type: 'od:motion-preview-request', probeVersion: 1, id: 'document-a' });
  f.rawEmit({ type: 'od:motion-preview-request', probeVersion: 1, id: 'document-a', probe: oldProbe });
  f.rawEmit({ ...state, probeVersion: undefined }); f.rawEmit();
  expect(f.parent.postMessage).toHaveBeenCalledTimes(count);
});

it('does not forget capable ownership when the same iframe parks outside the artifact surface', async () => {
  const f = fixture(); f.emit();
  await act(async () => { f.frame.remove(); });
  await act(async () => { f.surface.append(f.frame); });
  const count = f.parent.postMessage.mock.calls.length;
  // jsdom creates a fresh WindowProxy on reinsertion; qualify the current one.
  const post = vi.spyOn(f.frame.contentWindow!, 'postMessage');
  f.rawEmit({ ...state, probeVersion: undefined });
  expect(f.parent.postMessage).toHaveBeenCalledTimes(count);
  const probe = post.mock.calls.at(-1)![0].probe;
  f.rawEmit({ type: 'od:motion-preview-request', probeVersion: 1, id: state.id, probe });
  f.rawEmit();
  expect(f.parent.postMessage.mock.calls.at(-1)![0].type).toBe('studio:motion-state');
});
