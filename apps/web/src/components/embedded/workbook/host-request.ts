export class WorkbookHostError extends Error {
  constructor(message: string, readonly status = 0, readonly code = 'WORKBOOK_UNAVAILABLE') { super(message); }
}
type Request = { action: 'prepare'; body: { operationId: string; fileName: string; format: 'workbook' | 'xlsx'; workbookEditPlan?: string } }
  | { action: 'read-render' | 'read-preview' | 'remove-render' | 'cancel-render'; renderId: string }
  | { action: 'save'; body: { operationId: string; renderId: string } }
  | { action: 'read-save'; saveId: string }
  | { action: 'list-history'; fileName: string };

/** The trusted parent owns the native API client and authentication. Authored
 * content lives in a different opaque frame and cannot answer this channel. */
export function workbookHostRequest(projectId: string, request: Request, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  if (window.parent === window) return Promise.reject(new WorkbookHostError('Open this workbook inside Evebot.'));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID(); let done = false;
    const finish = (error?: Error, result?: unknown) => {
      if (done) return; done = true; clearTimeout(timeout);
      window.removeEventListener('message', receive); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const cancel = () => { try { window.parent.postMessage({ type: 'studio:workbook-cancel', projectId, requestId }, window.location.origin); } catch { /* A closed parent cannot receive cancellation. */ } };
    const abort = () => { cancel(); finish(new DOMException('Aborted', 'AbortError')); };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window.parent || event.origin !== window.location.origin || data?.type !== 'studio:workbook-result' || data.projectId !== projectId || data.requestId !== requestId) return;
      if (data.error && typeof data.error.message === 'string') finish(new WorkbookHostError(data.error.message.slice(0, 2000), typeof data.error.status === 'number' ? data.error.status : 0, typeof data.error.code === 'string' ? data.error.code.slice(0, 200) : undefined));
      else if (Object.hasOwn(data, 'result')) finish(undefined, data.result);
    };
    const timeout = setTimeout(() => { cancel(); finish(new WorkbookHostError('The workbook request has not settled. Retry the same operation.')); }, 30_000);
    window.addEventListener('message', receive); signal?.addEventListener('abort', abort, { once: true });
    try { window.parent.postMessage({ type: 'studio:workbook-request', projectId, requestId, ...request }, window.location.origin); }
    catch { finish(new WorkbookHostError('The workbook request could not be sent.')); }
  });
}
