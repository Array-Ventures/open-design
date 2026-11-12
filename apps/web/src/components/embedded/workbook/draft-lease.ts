import { workbookDraftKey, type WorkbookDraftScope } from './workbook-checkpoint';

export interface WorkbookDraftLease {
  /** Keep ownership until every queued journal write has settled successfully.
   * A failed drain retains ownership and may be retried. */
  release(drain: () => Promise<void>): Promise<void>;
}

/** Nonblocking browser-wide ownership of one account/artifact/editor branch.
 * Cancellation covers acquisition only; a delivered lease must be drained by
 * its owner. Web Locks disallows native signal together with ifAvailable. */
export function acquireWorkbookDraftLease(scope: WorkbookDraftScope, signal?: AbortSignal): Promise<WorkbookDraftLease | null> {
  const key = `od-workbook-draft:${workbookDraftKey(scope)}`;
  const locks = globalThis.navigator?.locks;
  if (!locks || signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (lease: WorkbookDraftLease | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      resolve(lease);
    };
    const abort = () => finish(null);
    signal?.addEventListener('abort', abort, { once: true });
    let request: Promise<unknown>;
    try {
      request = locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock || settled || signal?.aborted) { finish(null); return; }
        let unlock!: () => void;
        const held = new Promise<void>(done => { unlock = done; });
        let release: Promise<void> | undefined;
        let released = false;
        finish({ release(drain) {
          if (released) return Promise.resolve();
          if (!release) {
            release = Promise.resolve().then(drain).then(() => {
              released = true;
              unlock();
              // request resolves only after the browser has relinquished it.
              return request.then(() => undefined);
            }).catch(error => { release = undefined; throw error; });
          }
          return release;
        } });
        await held;
      });
    } catch (error) {
      signal?.removeEventListener('abort', abort);
      if (!settled) { settled = true; reject(error); }
      return;
    }
    void request.catch(error => {
      signal?.removeEventListener('abort', abort);
      if (!settled) { settled = true; reject(error); }
    });
  });
}
