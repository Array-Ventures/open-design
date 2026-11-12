// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useArtifactHostState } from '../../../src/components/embedded/useArtifactHostState';
import type { ArtifactEntry } from '../../../src/components/embedded/artifact-entry';
let restoreParent: (() => void) | undefined;
afterEach(() => { cleanup(); vi.restoreAllMocks(); restoreParent?.(); restoreParent = undefined; });
it.each([false, true])('sends backward-compatible state and separate availability for entry-null snapshot=%s', snapshot => {
  const iframe = document.createElement('iframe'); document.body.append(iframe);
  const parent = iframe.contentWindow!, original = Object.getOwnPropertyDescriptor(window, 'parent')!;
  Object.defineProperty(window, 'parent', { configurable: true, value: parent });
  restoreParent = () => { Object.defineProperty(window, 'parent', original); iframe.remove(); };
  const post = vi.spyOn(parent, 'postMessage');
  const view = renderHook(() => useArtifactHostState('project-a', null, snapshot));
  expect(post).toHaveBeenCalledWith({ type: 'studio:artifact-state', projectId: 'project-a', entry: null }, window.location.origin);
  expect(post).toHaveBeenCalledWith({ type: 'studio:artifact-availability', projectId: 'project-a', available: snapshot }, window.location.origin);
  view.unmount(); expect(post).toHaveBeenLastCalledWith({ type: 'studio:artifact-availability', projectId: 'project-a', available: false }, window.location.origin);
});
it('keeps real file export metadata while reporting availability separately', () => {
  const iframe = document.createElement('iframe'); document.body.append(iframe);
  const parent = iframe.contentWindow!, original = Object.getOwnPropertyDescriptor(window, 'parent')!;
  Object.defineProperty(window, 'parent', { configurable: true, value: parent }); restoreParent = () => { Object.defineProperty(window, 'parent', original); iframe.remove(); };
  const post = vi.spyOn(parent, 'postMessage');
  renderHook(() => useArtifactHostState('project-a', { file: { name: 'book.xlsx' }, kind: 'workbook', title: 'Forecast' } as ArtifactEntry, false));
  expect(post).toHaveBeenCalledWith({ type: 'studio:artifact-availability', projectId: 'project-a', available: true }, window.location.origin);
  const state = post.mock.calls.map(([value]) => value).find(value => value.type === 'studio:artifact-state');
  expect(state.entry.formats).toEqual(['xlsx']); expect(state).not.toHaveProperty('available');
});
