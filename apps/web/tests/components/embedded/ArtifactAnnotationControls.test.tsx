// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtifactAnnotationControls } from '../../../src/components/embedded/ArtifactAnnotationControls';
const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
afterEach(() => { cleanup(); if (originalParent) Object.defineProperty(window, 'parent', originalParent); });
it('advertises and invokes only a trusted controller-bound comments-list action', () => {
  const host = { postMessage: vi.fn() }; const open = vi.fn();
  Object.defineProperty(window, 'parent', { configurable: true, value: host });
  render(<ArtifactAnnotationControls projectId="project-a" commenting={false} marking={false} onComment={vi.fn()} onMark={vi.fn()} onComments={open} />);
  const state = host.postMessage.mock.calls[0]![0]; expect(state.commentsAvailable).toBe(true);
  const data = { type: 'studio:feedback-control', projectId: 'project-a', controllerId: state.controllerId, action: 'comments' };
  const message = (source: unknown, origin: string, body = data) => act(() => { window.dispatchEvent(new MessageEvent('message', { source: source as Window, origin, data: body })); });
  message({}, window.location.origin); message(host, 'https://foreign.test'); message(host, window.location.origin, { ...data, controllerId: 'stale' });
  expect(open).not.toHaveBeenCalled();
  message(host, window.location.origin); expect(open).toHaveBeenCalledOnce();
  const returnFocus = open.mock.calls[0]![0] as () => void; returnFocus();
  expect(host.postMessage).toHaveBeenLastCalledWith({ type: 'studio:feedback-focus', projectId: 'project-a', controllerId: state.controllerId }, window.location.origin);
});
it('does not offer the comments-list capability without a handler', () => {
  const host = { postMessage: vi.fn() }; Object.defineProperty(window, 'parent', { configurable: true, value: host });
  render(<ArtifactAnnotationControls projectId="project-a" commenting={false} marking={false} onComment={vi.fn()} onMark={vi.fn()} />);
  expect(host.postMessage.mock.calls[0]![0].commentsAvailable).toBe(false);
});
