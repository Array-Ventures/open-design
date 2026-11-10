type Job = { id: string; projectId: string; state: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'deleted'; error: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const embeddedStudioEnabled = () => Boolean(process.env.NEXT_PUBLIC_OD_STUDIO_BASE_PATH);
const errorResponse = (message: string, status = 422) => Response.json({ error: { code: 'EXPORT_FAILED', message } }, { status });
function checkedJob(value: unknown, projectId: string): Job {
  const job = value as Partial<Job> | null;
  if (!job || typeof job.id !== 'string' || !uuid.test(job.id) || job.projectId !== projectId || !['queued', 'running', 'ready', 'failed', 'cancelled', 'deleted'].includes(job.state ?? '')) throw new Error('The export service returned an invalid job.');
  return job as Job;
}
const pause = (signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
  const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(finish, 1000);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Export wait cancelled. The persisted job can be resumed from Exports.')); };
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
});

/** Keeps upstream export controls, replacing only their rendering carrier. */
export async function embeddedRenderExport(url: string, init: RequestInit, fetcher: typeof fetch = fetch): Promise<Response | null> {
  if (!embeddedStudioEnabled()) return null;
  const match = /^\/api\/projects\/([0-9a-f-]+)\/export\/(html|pdf|pdf-image|image|pptx)$/.exec(url);
  if (!match || !uuid.test(match[1]!) || init.method !== 'POST') return null;
  try {
    const projectId = match[1]!;
    const input = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    if (input.versionId !== undefined && (typeof input.versionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(input.versionId))) return errorResponse('Choose a valid saved HTML version.');
    if (input.editable === true && match[2] !== 'pptx') return errorResponse('Editable output is available only for PPTX.');
    const parts = typeof input.fileName === 'string' ? input.fileName.split('/') : [];
    if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || /[\\\0]/.test(part))) return errorResponse('Choose an existing project file.');
    const builtRoot = parts.length > 1 && ['dist', 'out', 'build'].includes(parts[0]!) ? parts.shift()! : '.';
    const body = { ...(input.versionId ? { versionId: input.versionId } : {}), ...(input.editable === true ? { editable: true } : {}), sourceDirectory: builtRoot, fileName: parts.join('/'), format: match[2] === 'pdf-image' ? 'pdf' : match[2], imageFormat: input.imageFormat ?? 'png', deck: match[2] === 'pptx' || input.deck === true, ...(input.title ? { title: input.title } : {}), ...(input.width ? { width: input.width } : {}), ...(input.height ? { height: input.height } : {}), ...(input.index === undefined ? {} : { index: input.index }) };
    const cacheKey = `studio-export:${projectId}:${JSON.stringify(body)}`;
    let operationId: string;
    try { const cached = JSON.parse(sessionStorage.getItem(cacheKey) ?? 'null') as { id?: string; at?: number } | null; operationId = cached?.id && uuid.test(cached.id) && Date.now() - (cached.at ?? 0) < 30 * 60_000 ? cached.id : crypto.randomUUID(); sessionStorage.setItem(cacheKey, JSON.stringify({ id: operationId, at: Date.now() })); }
    catch { operationId = crypto.randomUUID(); }
    const base = `/api/studio/projects/${projectId}/renders`;
    const response = await fetcher(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, operationId }), signal: init.signal ?? null });
    if (!response.ok) return response;
    let job = checkedJob(await response.json(), projectId);
    const deadline = Date.now() + 10 * 60_000;
    while (job.state === 'queued' || job.state === 'running') {
      if (Date.now() >= deadline) return errorResponse('This export is still pending. Open the project’s Exports to check or cancel it.', 408);
      const status = await fetcher(`${base}/${job.id}`, { signal: init.signal ?? null, cache: 'no-store' });
      if (!status.ok) return status;
      job = checkedJob(await status.json(), projectId);
      if (job.state === 'queued' || job.state === 'running') await pause(init.signal);
    }
    if (job.state !== 'ready') { try { sessionStorage.removeItem(cacheKey); } catch { /* Storage may be unavailable. */ } return errorResponse(job.error ?? 'The export did not complete.'); }
    const download = await fetcher(`/api/studio/exports/${projectId}/${job.id}`, { signal: init.signal ?? null, cache: 'no-store' });
    if (!download.ok) return download;
    // Keep the retry receipt until all bytes arrived, not just the headers.
    const bytes = await download.arrayBuffer();
    try { sessionStorage.removeItem(cacheKey); } catch { /* Storage may be unavailable. */ }
    return new Response(bytes, { status: 200, headers: download.headers });
  } catch (error) {
    // A non-501 response prevents upstream fallback to host browser rendering.
    return errorResponse(error instanceof Error ? error.message : 'Export unavailable. Check the project’s Exports before retrying.');
  }
}
