import { describe, expect, it, vi } from 'vitest';
import { embeddedDashboardRequest } from '../../../src/components/embedded/dashboard-transport';
const project = '18a8301a-b6e1-4001-8000-c967b1eab222';
const dashboard = '18a8301a-b6e1-4001-8000-c967b1eab223';
const url = (path: string) => new URL(path, 'http://localhost:6261');
describe('embedded dashboard request boundary', () => {
  it('leaves unrelated APIs alone and refuses a different project without fetching', async () => {
    const fetcher = vi.fn();
    expect(await embeddedDashboardRequest(url('/api/projects'), project, {}, fetcher)).toBeNull();
    const response = await embeddedDashboardRequest(url(`/api/live-artifacts?projectId=${dashboard}`), project, {}, fetcher);
    expect(response?.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('translates already mapped URLs without forwarding to the upstream runner', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([]));
    const response = await embeddedDashboardRequest(url(`/api/studio/bridge/${project}/live-artifacts?projectId=${project}`), project, {}, fetcher);
    expect(await response?.json()).toEqual({ artifacts: [] });
    expect(fetcher).toHaveBeenCalledWith(`/api/studio/projects/${project}/dashboards`, { signal: undefined });
  });
  it('does not forward unsupported mutations to upstream tools', async () => {
    const fetcher = vi.fn();
    const response = await embeddedDashboardRequest(url(`/api/live-artifacts/${dashboard}?projectId=${project}`), project, { method: 'DELETE' }, fetcher);
    expect(response?.status).toBe(422);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reads rendered source through the protected native preview', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<h1>Snapshot</h1>'));
    const response = await embeddedDashboardRequest(url(`/api/live-artifacts/${dashboard}/preview?projectId=${project}&variant=rendered-source`), project, {}, fetcher);
    expect(await response?.text()).toBe('<h1>Snapshot</h1>');
    expect(fetcher).toHaveBeenCalledWith(`/api/studio/dashboards/${project}/${dashboard}/preview`, { signal: undefined });
  });
  it('rejects a cross-project render history instead of exposing it', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([{ projectId: dashboard }]));
    expect((await embeddedDashboardRequest(url(`/api/live-artifacts/${dashboard}/refreshes?projectId=${project}`), project, {}, fetcher))?.status).toBe(502);
  });
  it('updates only host-owned metadata and accepts unchanged preview fields in either order', async () => {
    const row = { id: dashboard, projectId: project, input: { title: 'Updated', sourceDirectory: '.', templateFile: 'template.html', dataFile: 'data.json' }, pinned: true, archived: false, createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z', latest: null, ready: null, data: {}, sourceChanged: true, sourceError: null };
    const fetcher = vi.fn().mockResolvedValue(Response.json(row));
    const response = await embeddedDashboardRequest(url(`/api/live-artifacts/${dashboard}?projectId=${project}`), project,
      { method: 'PATCH', body: JSON.stringify({ title: 'Updated', pinned: true, status: 'active', preview: { entry: 'index.html', type: 'html' } }) }, fetcher);
    expect(response?.status).toBe(200);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ title: 'Updated', pinned: true, archived: false });
  });
  it('rejects injected provider or source settings without making a request', async () => {
    const fetcher = vi.fn();
    const response = await embeddedDashboardRequest(url(`/api/live-artifacts/${dashboard}?projectId=${project}`), project,
      { method: 'PATCH', body: JSON.stringify({ document: { sourceJson: { type: 'connector_tool' } } }) }, fetcher);
    expect(response?.status).toBe(422);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('supplies chronological history for the upstream viewer to reverse', async () => {
    const newest = { id: dashboard, projectId: project, state: 'ready', createdAt: '2026-11-09T00:00:00Z', updatedAt: '2026-11-09T00:01:00Z', error: null };
    const oldest = { ...newest, id: project, createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:01:00Z' };
    const fetcher = vi.fn().mockResolvedValue(Response.json([newest, oldest]));
    const response = await embeddedDashboardRequest(url(`/api/live-artifacts/${dashboard}/refreshes?projectId=${project}`), project, {}, fetcher);
    expect((await response!.json()).refreshes.map((entry: { refreshId: string; sequence: number }) => [entry.refreshId, entry.sequence])).toEqual([[project, 1], [dashboard, 2]]);
  });

});
