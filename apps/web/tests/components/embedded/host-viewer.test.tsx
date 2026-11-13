// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedViewerProvider, useEmbeddedViewer } from '../../../src/components/embedded/host-viewer';
function Identity() { const viewer = useEmbeddedViewer(); return <span>{viewer ? `${viewer.memberId}: ${viewer.displayName}` : 'Identity unavailable'}</span>; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('style'); delete document.documentElement.dataset.theme; delete document.documentElement.dataset.hostTheme; });
describe('embedded host display identity', () => {
  it('answers a matching reconnect request without remounting or clearing identity', () => {
    const parent = { postMessage: vi.fn() };
    vi.stubGlobal('parent', parent);
    const mounted = vi.fn();
    function RetainedIdentity() { mounted(); return <Identity />; }
    const { unmount } = render(<EmbeddedViewerProvider projectId="project-a"><RetainedIdentity /></EmbeddedViewerProvider>);
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'studio:ready', projectId: 'project-a' }, window.location.origin);
    act(() => window.dispatchEvent(new MessageEvent('message', { source: parent as unknown as Window, origin: window.location.origin,
      data: { type: 'studio:host-context', projectId: 'project-a', viewer: { id: 'alice', name: 'Alice' } } })));
    const identity = screen.getByText('evebot:alice: Alice');
    const renders = mounted.mock.calls.length;
    parent.postMessage.mockClear();
    const data = { type: 'studio:ready-request', projectId: 'project-a' };
    for (const invalid of [
      { data, origin: 'null', source: parent },
      { data, origin: window.location.origin, source: window },
      { data: { ...data, projectId: 'project-b' }, origin: window.location.origin, source: parent },
    ]) act(() => window.dispatchEvent(new MessageEvent('message', invalid as MessageEventInit)));
    expect(parent.postMessage).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: parent as unknown as Window })));
    expect(parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'studio:ready', projectId: 'project-a' }, window.location.origin);
    expect(screen.getByText('evebot:alice: Alice')).toBe(identity);
    expect(mounted).toHaveBeenCalledTimes(renders);
    unmount();
    parent.postMessage.mockClear();
    act(() => window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: parent as unknown as Window })));
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('applies themes only from the exact host window, origin and project', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    render(<EmbeddedViewerProvider projectId="project-a"><Identity /></EmbeddedViewerProvider>);
    const keys = ['background-full', 'background-primary-default', 'background-primary-hover', 'background-secondary-default', 'background-secondary-hover', 'background-tertiary-default', 'text-primary', 'text-secondary', 'text-tertiary', 'text-placeholder', 'text-on-accent', 'border-button-default', 'border-button-hover', 'separator-border', 'border-focus-ring', 'accent-50', 'accent-100', 'accent-500', 'accent-600', 'accent-700'];
    const data = { type: 'studio:host-context', projectId: 'project-a', viewer: { id: 'alice', name: 'Alice' }, theme: { mode: 'dark', colors: Object.fromEntries(keys.map(key => [key, '#123456'])) } };
    for (const invalid of [
      { data, origin: 'null', source: window.parent },
      { data, origin: window.location.origin, source: null },
      { data: { ...data, projectId: 'project-b' }, origin: window.location.origin, source: window.parent },
    ]) act(() => window.dispatchEvent(new MessageEvent('message', invalid)));
    expect(document.documentElement.dataset.hostTheme).toBeUndefined();
    act(() => window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window.parent })));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--bg-panel')).toBe('#123456');
  });

  it('accepts only the matching parent project and origin', () => {
    render(<EmbeddedViewerProvider projectId="project-a"><Identity /></EmbeddedViewerProvider>);
    const data = { type: 'studio:host-context', projectId: 'project-a', viewer: { id: 'alice', name: 'Alice' } };
    for (const invalid of [
      { data, origin: 'null', source: window.parent },
      { data, origin: window.location.origin, source: null },
      { data: { ...data, projectId: 'project-b' }, origin: window.location.origin, source: window.parent },
    ]) act(() => window.dispatchEvent(new MessageEvent('message', invalid)));
    expect(screen.getByText('Identity unavailable')).toBeInTheDocument();
    act(() => window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window.parent })));
    expect(screen.getByText('evebot:alice: Alice')).toBeInTheDocument();
  });
});
