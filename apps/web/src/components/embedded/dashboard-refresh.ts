import type { DashboardJob } from './dashboards';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fallbackReceipts = new Map<string, string>();
function receipt(key: string): string {
  // A retry after losing the HTTP response must replay the persisted intent.
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && uuid.test(existing)) return existing;
    const id = fallbackReceipts.get(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, id);
    fallbackReceipts.set(key, id);
    return id;
  } catch {
    const id = fallbackReceipts.get(key) ?? crypto.randomUUID();
    fallbackReceipts.set(key, id);
    return id;
  }
}
function forget(key: string) {
  fallbackReceipts.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* Memory still covers this page. */ }
}
function checkJob(value: unknown, projectId: string): DashboardJob {
  const job = value as DashboardJob | null;
  if (!job || !uuid.test(job.id) || job.projectId !== projectId || !['queued', 'running', 'ready', 'failed', 'cancelled', 'deleted'].includes(job.state)) throw new Error('Invalid dashboard refresh response.');
  return job;
}
const pause = (signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
  const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(finish, 1000);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Refresh wait cancelled. The saved refresh remains in History.')); };
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
});
export async function refreshEmbeddedDashboard(projectId: string, id: string, signal: AbortSignal | null | undefined, fetcher: typeof fetch): Promise<DashboardJob> {
  const key = `studio-dashboard-refresh:${projectId}:${id}`;
  const base = `/api/studio/projects/${projectId}`;
  const response = await fetcher(`${base}/dashboards/${id}/refresh`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: receipt(key) }), signal,
  });
  if (!response.ok) {
    // The request may already have committed. Preserve its receipt even on an HTTP failure.
    throw new Error(`Dashboard refresh unavailable (${response.status}). Retry to resume the same request.`);
  }
  let job = checkJob(await response.json(), projectId);
  const deadline = Date.now() + 10 * 60_000;
  while (job.state === 'queued' || job.state === 'running') {
    if (Date.now() >= deadline) throw new Error('Refresh is still pending. Check History; retry resumes the same request.');
    const status = await fetcher(`${base}/renders/${job.id}`, { signal, cache: 'no-store' });
    if (!status.ok) throw new Error(`Refresh status unavailable (${status.status}). Retry to resume the same request.`);
    const next = checkJob(await status.json(), projectId);
    if (next.id !== job.id) throw new Error('The refresh service returned a different render.');
    job = next;
    if (job.state === 'queued' || job.state === 'running') await pause(signal);
  }
  if (job.state !== 'ready') forget(key);
  if (job.state !== 'ready') throw new Error(job.error ?? 'Refresh did not complete. The last successful preview is preserved.');
  return job;
}

export function acknowledgeDashboardRefresh(projectId: string, id: string): void {
  forget(`studio-dashboard-refresh:${projectId}:${id}`);
}
