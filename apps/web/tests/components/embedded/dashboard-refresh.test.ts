import { afterEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeDashboardRefresh, refreshEmbeddedDashboard } from '../../../src/components/embedded/dashboard-refresh';
const project = '18a8301a-b6e1-4001-8000-c967b1eab222';
const id = '18a8301a-b6e1-4001-8000-c967b1eab223';
const job = { id, projectId: project, state: 'ready', error: null };
afterEach(() => { acknowledgeDashboardRefresh(project, id); vi.unstubAllGlobals(); });
describe('persisted dashboard refresh wait', () => {
  it('reuses the operation after a lost admission response and until detail is acknowledged', async () => {
    const receipts = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => receipts.get(key), setItem: (key: string, value: string) => receipts.set(key, value), removeItem: (key: string) => receipts.delete(key) });
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(Response.json(job)).mockResolvedValueOnce(Response.json(job));
    await expect(refreshEmbeddedDashboard(project, id, undefined, fetcher)).rejects.toThrow('lost response');
    await refreshEmbeddedDashboard(project, id, undefined, fetcher);
    await refreshEmbeddedDashboard(project, id, undefined, fetcher);
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(call[1].body).operationId);
    expect(new Set(bodies).size).toBe(1);
    expect(receipts.size).toBe(1);
    acknowledgeDashboardRefresh(project, id);
    expect(receipts.size).toBe(0);
  });
  it('polls the same persisted render and refuses a different job identity', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...job, state: 'queued' })).mockResolvedValueOnce(Response.json({ ...job, id: project }));
    await expect(refreshEmbeddedDashboard(project, id, undefined, fetcher)).rejects.toThrow('different render');
    expect(fetcher.mock.calls[1]![0]).toBe(`/api/studio/projects/${project}/renders/${id}`);
  });
  it('reports failure while leaving the previous snapshot to the registry', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...job, state: 'failed', error: 'Template rejected.' }));
    await expect(refreshEmbeddedDashboard(project, id, undefined, fetcher)).rejects.toThrow('Template rejected.');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
