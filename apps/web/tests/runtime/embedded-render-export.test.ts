// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { embeddedRenderExport } from '../../src/runtime/embedded-render-export';
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222';
const id = '4b0ec4bd-1693-4416-baa3-186f199ea8df';
const url = `/api/projects/${projectId}/export/image`;
const init = { method: 'POST', body: JSON.stringify({ fileName: 'dist/index.html', width: 800, height: 600 }) };
const job = (state: string) => ({ id, projectId, state, error: state === 'failed' ? 'Bundle remote fonts locally.' : null });
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_OD_STUDIO_BASE_PATH', '/studio'); sessionStorage.clear(); });
afterEach(() => vi.unstubAllEnvs());
describe('embedded durable export carrier', () => {
  it('creates one job, follows its state and returns the authenticated download', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(job('queued'), { status: 202 }))
      .mockResolvedValueOnce(Response.json(job('ready')))
      .mockResolvedValueOnce(new Response('fixture image bytes', { headers: { 'content-type': 'image/png', 'content-disposition': 'attachment; filename="artifact.png"' } }));
    const response = await embeddedRenderExport(url, init, fetcher);
    expect(response?.status).toBe(200); expect(await response?.text()).toBe('fixture image bytes');
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ sourceDirectory: 'dist', fileName: 'index.html', format: 'image', width: 800, height: 600 });
    expect(fetcher.mock.calls[1]![0]).toBe(`/api/studio/projects/${projectId}/renders/${id}`);
    expect(fetcher.mock.calls[2]![0]).toBe(`/api/studio/exports/${projectId}/${id}`);
    expect(sessionStorage.length).toBe(0);
  });
  it('reuses the creation identity after an uncertain transport failure', async () => {
    const first = vi.fn().mockRejectedValue(new Error('Connection lost'));
    expect((await embeddedRenderExport(url, init, first))?.status).toBe(422);
    const second = vi.fn().mockResolvedValueOnce(Response.json(job('ready'), { status: 202 })).mockResolvedValueOnce(new Response('image'));
    await embeddedRenderExport(url, init, second);
    expect(JSON.parse(second.mock.calls[0]![1].body).operationId).toBe(JSON.parse(first.mock.calls[0]![1].body).operationId);
  });
  it('reports worker failures without indicating a host-render fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(job('failed'), { status: 202 }));
    const response = await embeddedRenderExport(url, init, fetcher);
    expect(response?.status).toBe(422); expect(await response?.text()).toContain('Bundle remote fonts');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses malformed version identities and editable requests for non-PPTX formats', async () => {
    const fetcher = vi.fn();
    for (const extra of [{ versionId: '../escape' }, { versionId: 7 }, { editable: true }]) {
      const response = await embeddedRenderExport(url, { method: 'POST', body: JSON.stringify({ fileName: 'index.html', ...extra }) }, fetcher);
      expect(response?.status).toBe(422);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('exports a selected saved version through the durable carrier without restoring files', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(job('ready'), { status: 202 })).mockResolvedValueOnce(new Response('historical image'));
    const response = await embeddedRenderExport(url, { method: 'POST', body: JSON.stringify({ fileName: 'dist/index.html', versionId: 'old-version' }) }, fetcher);
    expect(response?.status).toBe(200);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ sourceDirectory: 'dist', fileName: 'index.html', versionId: 'old-version' });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([`/api/studio/projects/${projectId}/renders`, `/api/studio/exports/${projectId}/${id}`]);
  });
  it('preserves editable PPTX intent in the durable job', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(job('ready'), { status: 202 })).mockResolvedValueOnce(new Response('pptx bytes'));
    const response = await embeddedRenderExport(`/api/projects/${projectId}/export/pptx`, { method: 'POST', body: JSON.stringify({ fileName: 'deck.html', editable: true }) }, fetcher);
    expect(response?.status).toBe(200);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ format: 'pptx', editable: true, deck: true });
  });
  it('leaves ordinary upstream export behavior alone', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_STUDIO_BASE_PATH', ''); const fetcher = vi.fn();
    expect(await embeddedRenderExport(url, init, fetcher)).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
});
