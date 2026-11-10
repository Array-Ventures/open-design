import { acknowledgeDashboardRefresh, refreshEmbeddedDashboard } from './dashboard-refresh';
import { checkedDashboard, dashboardDetail, fetchEmbeddedDashboards, type DashboardJob } from './dashboards';

/** Translate visual workspace reads to the host registry; never invoke upstream agents/connectors. */
export async function embeddedDashboardRequest(url: URL, selectedProject: string, init: RequestInit, fetcher: typeof fetch): Promise<Response | null> {
  const prefix = `/api/studio/bridge/${selectedProject}`;
  const path = url.pathname.startsWith(`${prefix}/`) ? `/api${url.pathname.slice(prefix.length)}` : url.pathname;
  const match = /^\/api\/live-artifacts(?:\/([0-9a-f-]+)(?:\/(preview|refreshes|refresh))?)?$/.exec(path);
  if (!match) return null;
  const fail = (message: string, status = 422) => Response.json({ error: { code: 'DASHBOARD_UNAVAILABLE', message } }, { status });
  if (url.searchParams.get('projectId') !== selectedProject) return fail('Dashboard project does not match the open workspace.', 403);
  const id = match[1];
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return fail('Invalid dashboard.');
  const method = (init.method ?? 'GET').toUpperCase();
  const base = `/api/studio/projects/${selectedProject}/dashboards`;
  try {
    if (id && match[2] === 'refresh' && method === 'POST') {
      const job = await refreshEmbeddedDashboard(selectedProject, id, init.signal, fetcher);
      const response = await fetcher(`${base}/${id}`, { signal: init.signal, cache: 'no-store' });
      if (!response.ok) return fail('Refresh completed, but the dashboard is unavailable.', response.status);
      const result = Response.json({ artifact: dashboardDetail(checkedDashboard(await response.json(), selectedProject)), refresh: { id: job.id, status: 'succeeded', refreshedSourceCount: 1 } });
      acknowledgeDashboardRefresh(selectedProject, id);
      return result;
    }
    if (id && !match[2] && method === 'PATCH') {
      const input = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['title', 'pinned', 'status', 'preview'].includes(key))) return fail('Edit dashboard source files in the project editor. This control changes only title, pin and archive state.');
      if (input.preview !== undefined) {
        const preview = input.preview as Record<string, unknown> | null;
        if (!preview || Array.isArray(preview) || preview.type !== 'html' || preview.entry !== 'index.html' || Object.keys(preview).some((key) => !['type', 'entry'].includes(key))) return fail('Dashboard preview is produced by its registered local template.');
      }
      if (input.status !== undefined && !['active', 'archived'].includes(String(input.status))) return fail('Choose active or archived.');
      const change = { ...(input.title === undefined ? {} : { title: input.title }), ...(input.pinned === undefined ? {} : { pinned: input.pinned }), ...(input.status === undefined ? {} : { archived: input.status === 'archived' }) };
      const response = await fetcher(`${base}/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change), signal: init.signal });
      if (!response.ok) return fail('Dashboard update unavailable.', response.status);
      return Response.json({ artifact: dashboardDetail(checkedDashboard(await response.json(), selectedProject)) });
    }
    if (method !== 'GET') return fail('This action is unavailable. Archive the dashboard to retain its files and history.');
    if (match[2] === 'refresh') return fail('Refresh requires POST.', 405);
    if (!id) return Response.json({ artifacts: await fetchEmbeddedDashboards(selectedProject, init.signal ?? undefined, fetcher) });
    if (match[2] === 'refreshes') {
      const response = await fetcher(`${base}/${id}/refreshes`, { signal: init.signal });
      if (!response.ok) return fail('Dashboard history unavailable.', response.status);
      const jobs = await response.json() as DashboardJob[];
      if (!Array.isArray(jobs) || jobs.some((job) => job.projectId !== selectedProject)) return fail('Invalid dashboard history.', 502);
      return Response.json({ refreshes: jobs.slice().reverse().map((job, index) => ({ schemaVersion: 1, projectId: selectedProject, artifactId: id, refreshId: job.id, sequence: index + 1,
        step: 'Render local template and JSON', status: job.state === 'ready' ? 'succeeded' : job.state === 'queued' || job.state === 'running' ? 'running' : job.state === 'deleted' ? 'skipped' : job.state,
        startedAt: job.createdAt, createdAt: job.createdAt, ...(['queued', 'running'].includes(job.state) ? {} : { finishedAt: job.updatedAt }),
        source: { sourceType: 'document', toolName: 'local_file' }, ...(job.error ? { error: { message: job.error } } : {}) })) });
    }
    if (match[2] === 'preview' && url.searchParams.get('variant') !== 'template') {
      return fetcher(`/api/studio/dashboards/${selectedProject}/${id}/preview`, { signal: init.signal });
    }
    const response = await fetcher(`${base}/${id}`, { signal: init.signal });
    if (!response.ok) return fail('Dashboard unavailable.', response.status);
    const row = checkedDashboard(await response.json(), selectedProject);
    if (match[2] === 'preview') {
      const parts = [row.input.sourceDirectory === '.' ? '' : row.input.sourceDirectory, row.input.templateFile].filter(Boolean).join('/').split('/');
      if (parts.some((part) => !part || part === '.' || part === '..' || /[\\\0]/.test(part))) return fail('Invalid dashboard source.');
      return fetcher(`/api/studio/bridge/${selectedProject}/projects/${selectedProject}/files/${parts.map(encodeURIComponent).join('/')}`, { signal: init.signal });
    }
    return Response.json({ artifact: dashboardDetail(row) });
  } catch {
    return fail('Dashboard unavailable. Retry from the project workspace.', 503);
  }
}
