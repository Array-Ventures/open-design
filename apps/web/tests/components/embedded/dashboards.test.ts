import { describe, expect, it, vi } from 'vitest';
import { checkedDashboard, dashboardDetail, dashboardSummary, fetchEmbeddedDashboards, type NativeDashboard } from '../../../src/components/embedded/dashboards';
const projectId = '18a8301a-b6e1-4001-8000-c967b1eab222';
const row: NativeDashboard = {
  id: '18a8301a-b6e1-4001-8000-c967b1eab223', projectId,
  input: { title: 'Revenue', sourceDirectory: 'finance', templateFile: 'dashboard.html', dataFile: 'metrics.json' },
  pinned: false, archived: false, createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z',
  latest: null, ready: null, data: { revenue: 250 }, sourceChanged: true, sourceError: null,
};
describe('native dashboard presentation', () => {
  it('keeps current source data separate from the last ready snapshot', () => {
    const detail = dashboardDetail(row);
    expect(detail.document.dataJson).toEqual({ revenue: 250 });
    expect(detail.hostSourceState).toEqual({ sourceChanged: true, sourceError: null, dataAvailable: true, paths: row.input });
    expect(detail.document.sourceJson).toMatchObject({ type: 'local_file', input: { path: 'metrics.json', sourceDirectory: 'finance' } });
    expect(detail.refreshStatus).toBe('never');
  });
  it('changes the collection revision when a render completes without a metadata edit', () => {
    const job = { id: row.id, projectId, state: 'ready' as const, createdAt: row.createdAt, updatedAt: '2026-11-09T00:00:00Z', error: null };
    expect(dashboardSummary({ ...row, latest: job, ready: job })).toMatchObject({ refreshStatus: 'succeeded', updatedAt: job.updatedAt, lastRefreshedAt: job.updatedAt });
  });
  it('does not present unavailable data as a successfully loaded empty document', () => {
    expect(dashboardDetail({ ...row, data: null, sourceError: 'Unavailable' }).hostSourceState).toMatchObject({ dataAvailable: false, sourceError: 'Unavailable' });
  });
  it('rejects cross-project records and renders', () => {
    expect(() => checkedDashboard({ ...row, projectId: row.id }, projectId)).toThrow('invalid record');
    expect(() => checkedDashboard({ ...row, latest: { id: row.id, projectId: row.id, state: 'ready' } }, projectId)).toThrow('invalid render');
  });
  it('surfaces list failures rather than quietly hiding registered dashboards', async () => {
    await expect(fetchEmbeddedDashboards(projectId, undefined, vi.fn().mockResolvedValue(new Response('', { status: 403 })))).rejects.toThrow('unavailable');
    const fetcher = vi.fn().mockResolvedValue(Response.json([row]));
    expect(await fetchEmbeddedDashboards(projectId, undefined, fetcher)).toEqual([dashboardSummary(row)]);
    expect(fetcher).toHaveBeenCalledWith(`/api/studio/projects/${projectId}/dashboards`, { signal: undefined });
  });
});
