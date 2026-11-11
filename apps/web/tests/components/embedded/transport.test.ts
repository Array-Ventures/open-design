// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { embeddedPreviewBaseScope, embeddedResourceUrl } from '../../../src/components/embedded/transport';
const id = '18a8301a-b6e1-4001-8000-c967b1eab222';
const location = { origin: 'http://127.0.0.1:6261', pathname: `/studio/projects/${id}/files/index.html` };
afterEach(() => vi.unstubAllEnvs());
describe('embedded host URL transport', () => {
  it('routes same-origin API resources through the selected project gateway', () => {
    vi.stubEnv('NEXT_PUBLIC_OD_STUDIO_BASE_PATH', '/studio');
    expect(embeddedResourceUrl(`/api/projects/${id}/raw/index.html?v=1`, location)).toBe(`/api/studio/bridge/${id}/projects/${id}/raw/index.html?v=1`);
  });
  it('never remaps a gateway URL twice', () => {
    vi.stubEnv('NEXT_PUBLIC_OD_STUDIO_BASE_PATH', '/studio');
    const url = `/api/studio/bridge/${id}/projects/${id}/events`;
    expect(embeddedResourceUrl(url, location)).toBe(url);
    expect(embeddedResourceUrl(`/api/studio/projects/${id}/renders`, location)).toBe(`/api/studio/projects/${id}/renders`);
    expect(embeddedResourceUrl(`/api/studio/exports/${id}/result`, location)).toBe(`/api/studio/exports/${id}/result`);
  });
  it('does not change external services, static resources or normal upstream mode', () => {
    vi.stubEnv('NEXT_PUBLIC_OD_STUDIO_BASE_PATH', '/studio');
    expect(embeddedResourceUrl('https://external.example/api/data', location)).toBe('https://external.example/api/data');
    expect(embeddedResourceUrl('/studio/_next/chunk.js', location)).toBe('/studio/_next/chunk.js');
    vi.stubEnv('NEXT_PUBLIC_OD_STUDIO_BASE_PATH', '');
    expect(embeddedResourceUrl('/api/projects', location)).toBe('/api/projects');
  });
});

describe('opaque embedded preview asset base', () => {
  const scope = `/api/studio/preview/signed-fixture/${id}/projects/${id}/preview/daemon-scope/nested/index.html`;
  const response = (url = scope, expiresAt = Date.now() + 60000) => new Response('', { headers: { 'x-od-host-preview-url': url, 'x-od-host-preview-expires-at': String(expiresAt) } });
  it('uses the host-issued project read capability as the relative asset directory', () => {
    const base = embeddedPreviewBaseScope(response(), id);
    expect(base?.href).toBe(`${window.location.origin}${scope.slice(0, scope.lastIndexOf('/') + 1)}`);
    expect(base?.expiresAt).toBeGreaterThan(Date.now());
  });
  it('rejects external, unsigned, wrong-project and expired bases', () => {
    expect(embeddedPreviewBaseScope(response(`https://outside.invalid${scope}`), id)).toBeNull();
    expect(embeddedPreviewBaseScope(response(`/api/projects/${id}/raw/index.html`), id)).toBeNull();
    expect(embeddedPreviewBaseScope(response(scope.replaceAll(id, '18a8301a-b6e1-4001-8000-c967b1eab999')), id)).toBeNull();
    expect(embeddedPreviewBaseScope(response(scope, Date.now() - 1), id)).toBeNull();
  });
});
