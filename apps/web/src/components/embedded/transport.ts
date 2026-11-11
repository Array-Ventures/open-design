import { embeddedDashboardRequest } from './dashboard-transport';
/** URL adapter for the host-mounted application. Never sends credentials to another origin. */
export function embeddedResourceUrl(input: string, location?: Pick<Location, 'origin' | 'pathname'>): string {
  const at = location ?? (typeof window === 'undefined' ? undefined : window.location);
  if (!at) return input;
  const base = process.env.NEXT_PUBLIC_OD_STUDIO_BASE_PATH ?? '';
  if (!base) return input;
  const match = new RegExp(`^${base}/projects/([0-9a-f-]+)(?:/|$)`, 'i').exec(at.pathname);
  if (!match) return input;
  const url = new URL(input, at.origin);
  if (url.origin !== at.origin || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/studio/')) return input;
  return `/api/studio/bridge/${encodeURIComponent(match[1]!)}/${url.pathname.slice(5)}${url.search}${url.hash}`;
}

let installed = false;
export function installEmbeddedTransport(): void {
  if (installed || typeof window === 'undefined' || !process.env.NEXT_PUBLIC_OD_STUDIO_BASE_PATH) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const current = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const at = window.location;
    const selected = new RegExp(`^${process.env.NEXT_PUBLIC_OD_STUDIO_BASE_PATH}/projects/([0-9a-f-]+)(?:/|$)`, 'i').exec(at.pathname)?.[1];
    const parsed = new URL(current, at.origin);
    if (selected && parsed.origin === at.origin) {
      const requestInit = input instanceof Request ? { method: input.method, signal: input.signal, ...init } : init ?? {};
      const response = await embeddedDashboardRequest(parsed, selected, requestInit, original);
      if (response) return response;
    }
    const mapped = embeddedResourceUrl(current);
    if (mapped === current) return original(input, init);
    return original(input instanceof Request ? new Request(new URL(mapped, window.location.origin), input) : mapped, init);
  };
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
    constructor(url: string | URL, options?: EventSourceInit) {
      super(embeddedResourceUrl(String(url)), options);
    }
  };
}

/** Server-issued read capability for subresources in an opaque preview frame. */
export function embeddedPreviewBaseScope(response: Response, projectId: string): { href: string; expiresAt: number } | null {
  const raw = response.headers.get('x-od-host-preview-url');
  const expiresAt = Number(response.headers.get('x-od-host-preview-expires-at'));
  if (!raw || !/^[0-9a-f-]{36}$/i.test(projectId) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  try {
    const url = new URL(raw, window.location.origin);
    const parts = url.pathname.split('/');
    if (url.origin !== window.location.origin || url.search || url.hash || parts[1] !== 'api' || parts[2] !== 'studio' || parts[3] !== 'preview'
      || !parts[4] || parts[5] !== projectId || parts[6] !== 'projects' || parts[7] !== projectId || parts[8] !== 'preview' || !parts[9] || !parts[10]) return null;
    url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
    return { href: url.href, expiresAt };
  } catch { return null; }
}
