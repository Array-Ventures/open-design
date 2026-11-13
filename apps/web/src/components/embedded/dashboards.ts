import type { LiveArtifact, LiveArtifactSummary } from '@open-design/contracts';

export type DashboardJob = { id: string; projectId: string; state: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'deleted'; createdAt: string; updatedAt: string; error: string | null };
export type NativeDashboard = {
  id: string; projectId: string;
  input: { title: string; sourceDirectory: string; templateFile: string; dataFile: string };
  pinned: boolean; archived: boolean; createdAt: string; updatedAt: string;
  latest: DashboardJob | null; ready: DashboardJob | null;
  data: LiveArtifact['document']['dataJson'] | null;
  sourceChanged: boolean | null; sourceError: string | null;
};
export type EmbeddedDashboard = LiveArtifact & {
  hostSourceState: Pick<NativeDashboard, 'sourceChanged' | 'sourceError'> & { dataAvailable: boolean; paths: NativeDashboard['input'] };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function checkedDashboard(value: unknown, projectId: string): NativeDashboard {
  const row = value as NativeDashboard | null;
  if (!row || !uuid.test(row.id) || row.projectId !== projectId || typeof row.input?.title !== 'string'
    || typeof row.input.templateFile !== 'string' || typeof row.input.dataFile !== 'string'
    || typeof row.input.sourceDirectory !== 'string' || typeof row.archived !== 'boolean'
    || typeof row.pinned !== 'boolean' || typeof row.updatedAt !== 'string' || typeof row.createdAt !== 'string') {
    throw new Error('The dashboard service returned an invalid record.');
  }
  for (const job of [row.latest, row.ready]) {
    if (job && (!uuid.test(job.id) || job.projectId !== projectId || !['queued', 'running', 'ready', 'failed', 'cancelled', 'deleted'].includes(job.state))) {
      throw new Error('The dashboard service returned an invalid render.');
    }
  }
  return row;
}
export type EmbeddedDashboardSummary = LiveArtifactSummary & { hostTemplatePath: string };
export function dashboardSummary(row: NativeDashboard): EmbeddedDashboardSummary {
  return {
    hostTemplatePath: `${row.input.sourceDirectory === '.' ? '' : row.input.sourceDirectory + '/'}${row.input.templateFile}`,
    schemaVersion: 1, id: row.id, projectId: row.projectId, title: row.input.title, slug: row.id,
    status: row.archived ? 'archived' : 'active', pinned: row.pinned,
    preview: { type: 'html', entry: 'index.html' }, hasDocument: true,
    refreshStatus: row.latest?.state === 'queued' || row.latest?.state === 'running' ? 'running'
      : row.latest?.state === 'ready' ? 'succeeded' : row.latest ? 'failed' : 'never',
    createdAt: row.createdAt,
    // A completed refresh changes the visual snapshot even when metadata is unchanged.
    updatedAt: [row.updatedAt, row.latest?.updatedAt ?? ''].sort().at(-1)!,
    ...(row.ready ? { lastRefreshedAt: row.ready.updatedAt } : {}),
  };
}
export function dashboardDetail(row: NativeDashboard): EmbeddedDashboard {
  const { hasDocument: _, ...summary } = dashboardSummary(row);
  return { ...summary,
    document: { format: 'html_template_v1', templatePath: 'template.html', generatedPreviewPath: 'index.html', dataPath: 'data.json',
      dataJson: row.data ?? {}, sourceJson: { type: 'local_file', input: { sourceDirectory: row.input.sourceDirectory, path: row.input.dataFile }, refreshPermission: 'manual_refresh_granted_for_read_only' } },
    hostSourceState: { sourceChanged: row.sourceChanged, sourceError: row.sourceError, dataAvailable: row.data !== null, paths: row.input },
  };
}
export async function fetchEmbeddedDashboards(projectId: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<EmbeddedDashboardSummary[]> {
  const response = await fetcher(`/api/studio/projects/${projectId}/dashboards`, { signal });
  if (!response.ok) throw new Error('Dashboards unavailable.');
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error('The dashboard service returned an invalid list.');
  return rows.map((row) => dashboardSummary(checkedDashboard(row, projectId)));
}
