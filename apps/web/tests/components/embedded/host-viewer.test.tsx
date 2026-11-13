// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedViewerProvider, useEmbeddedViewer } from '../../../src/components/embedded/host-viewer';
function Identity() { const viewer = useEmbeddedViewer(); return <span>{viewer ? `${viewer.memberId}: ${viewer.displayName}` : 'Identity unavailable'}</span>; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('style'); delete document.documentElement.dataset.theme; delete document.documentElement.dataset.hostTheme; });
describe('embedded host display identity', () => {
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
