import type { WorkbookCheckpoint } from './workbook-writer';
import { decodeWorkbookDraft, encodeWorkbookDraft, workbookDraftArtifactKey, workbookDraftKey, workbookDraftScopeSchema, type WorkbookDraftScope } from './workbook-checkpoint';

export const WORKBOOK_DRAFT_DATABASE = 'od-embedded-artifact-drafts';
const STORE = 'workbooks', HEADS = 'heads';
export const MAX_WORKBOOK_DRAFT_BYTES = 128 * 1024 * 1024;
export interface WorkbookDraftHead { id: string; draftId: string; artifactKey: string; updatedAt: number }
function bounded(text: string) {
  if (new Blob([text]).size > MAX_WORKBOOK_DRAFT_BYTES) throw new Error('The workbook draft exceeds this device’s recovery limit.');
  return text;
}
async function openDrafts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(WORKBOOK_DRAFT_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains(HEADS)) request.result.createObjectStore(HEADS, { keyPath: 'id' }).createIndex('artifact', 'artifactKey');
    };
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
    request.onerror = () => { settled = true; reject(new Error('Workbook recovery storage is unavailable.')); };
    request.onblocked = () => { settled = true; reject(new Error('Close another artifact tab before upgrading workbook recovery storage.')); };
  });
}
async function access<T>(stores: string[], mode: IDBTransactionMode, action: (transaction: IDBTransaction) => IDBRequest<T>): Promise<T> {
  const database = await openDrafts();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(stores, mode, { durability: 'strict' });
      let request: IDBRequest<T>;
      try { request = action(transaction); }
      catch { transaction.abort(); reject(new Error('The workbook recovery transaction did not commit.')); return; }
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(new Error('The workbook recovery transaction did not commit.'));
    });
  } finally { database.close(); }
}
/** Call only after current project access has been verified. Each editor has
 * its own draft identity so another tab cannot silently overwrite its work. */
export async function readWorkbookDraft(scope: WorkbookDraftScope): Promise<WorkbookCheckpoint | null> {
  const raw: unknown = await access([STORE], 'readonly', tx => tx.objectStore(STORE).get(workbookDraftKey(scope)));
  if (raw === undefined) return null;
  if (typeof raw !== 'string') throw new Error('The protected workbook draft could not be read.');
  return decodeWorkbookDraft(JSON.parse(bounded(raw)), scope);
}
export async function listWorkbookDrafts(scope: Omit<WorkbookDraftScope, 'draftId'>): Promise<WorkbookDraftHead[]> {
  const artifactKey = workbookDraftArtifactKey(scope);
  const raw: unknown = await access([HEADS], 'readonly', tx => tx.objectStore(HEADS).index('artifact').getAll(artifactKey));
  if (!Array.isArray(raw) || raw.some(head => {
    const checked = workbookDraftScopeSchema.safeParse({ ...scope, draftId: head?.draftId });
    return !checked.success || head.id !== workbookDraftKey(checked.data) || head.artifactKey !== artifactKey || !Number.isSafeInteger(head.updatedAt) || head.updatedAt < 0;
  })) throw new Error('The workbook recovery index could not be read.');
  return raw.sort((a: WorkbookDraftHead, b: WorkbookDraftHead) => b.updatedAt - a.updatedAt);
}
/** Shared exact encoder and byte bound used by storage and synchronous
 * prospective destructive-command admission. No IndexedDB side effect. */
export function serializeWorkbookDraft(scope: WorkbookDraftScope, state: WorkbookCheckpoint): string {
  return bounded(JSON.stringify(encodeWorkbookDraft(scope, state)));
}
export async function saveWorkbookDraft(scope: WorkbookDraftScope, state: WorkbookCheckpoint | null): Promise<void> {
  const key = workbookDraftKey(scope);
  const serialized = state ? serializeWorkbookDraft(scope, state) : null;
  if (serialized === null) await access([STORE, HEADS], 'readwrite', tx => { tx.objectStore(HEADS).delete(key); return tx.objectStore(STORE).delete(key); });
  else await access([STORE, HEADS], 'readwrite', tx => {
    tx.objectStore(HEADS).put({ id: key, draftId: scope.draftId, artifactKey: workbookDraftArtifactKey(scope), updatedAt: Date.now() } satisfies WorkbookDraftHead);
    return tx.objectStore(STORE).put(serialized, key);
  });
}

/** A restore stores only immutable identities, separately from editable drafts.
 * Compare-and-set prevents another tab replacing an unresolved operation. */
export async function accessWorkbookRestore(scope: import('./restore-intent').WorkbookRestoreScope,
  change?: { expected: string | null; value: import('./restore-intent').WorkbookRestoreIntent | null }): Promise<import('./restore-intent').WorkbookRestoreIntent | null> {
  const { workbookRestoreIntentSchema } = await import('./restore-intent');
  const key = `restore:${workbookDraftArtifactKey(scope)}`;
  const database = await openDrafts();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, change ? 'readwrite' : 'readonly', { durability: 'strict' });
      const store = tx.objectStore(STORE), request = store.get(key);
      let result: import('./restore-intent').WorkbookRestoreIntent | null = null, failure: unknown;
      request.onsuccess = () => {
        try {
          if (request.result !== undefined) {
            if (typeof request.result !== 'string' || request.result.length > 16000) throw Error('The restore record could not be read.');
            result = workbookRestoreIntentSchema.parse(JSON.parse(request.result));
            if (workbookDraftArtifactKey(result) !== workbookDraftArtifactKey(scope)) throw Error('This restore belongs to another account or workbook.');
          }
          if (change) {
            if ((result?.operationId ?? null) !== change.expected) throw Error('Another restore is unresolved. Check its status before starting another.');
            const next = change.value && workbookRestoreIntentSchema.parse(change.value);
            if (next && workbookDraftArtifactKey(next) !== workbookDraftArtifactKey(scope)) throw Error('This restore belongs to another account or workbook.');
            if (next) store.put(JSON.stringify(next), key); else store.delete(key);
            result = next;
          }
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(failure ?? Error('The restore identity could not be protected on this device.'));
    });
  } finally { database.close(); }
}

/** Key-only discovery: never reads a draft or restore payload. Filenames are
 * private candidates, not authority; authorize passive history before exposing
 * them or calling accessWorkbookRestore. Range excludes other people/projects. */
export async function listWorkbookRestoreFileNames(scope: { viewerId: string; projectId: string }, page: { cursor?: string; limit?: number } = {}): Promise<{ fileNames: string[]; cursor: string | null }> {
  const checked = workbookDraftScopeSchema.pick({ viewerId: true, projectId: true }).parse(scope);
  const prefix = `restore:${JSON.stringify([checked.viewerId, checked.projectId]).slice(0, -1)},`;
  const limit = page.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || page.cursor && (!page.cursor.startsWith(prefix) || page.cursor.length > 4096)) throw Error('Invalid restore discovery page.');
  if (typeof indexedDB === 'undefined') return { fileNames: [], cursor: null };
  const database = await openDrafts();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readonly'), range = IDBKeyRange.bound(page.cursor ?? prefix, prefix + '\uffff', Boolean(page.cursor));
      const request = tx.objectStore(STORE).openKeyCursor(range);
      const fileNames: string[] = []; let seen = 0, lastKey: string | null = null, cursor: string | null = null;
      request.onsuccess = () => {
        const entry = request.result; if (!entry) return;
        if (seen++ === limit) { cursor = lastKey; return; }
        lastKey = String(entry.key);
        try {
          const key: unknown = lastKey.length <= 4096 ? JSON.parse(lastKey.slice('restore:'.length)) : null;
          if (Array.isArray(key) && key.length === 3 && key[0] === checked.viewerId && key[1] === checked.projectId && typeof key[2] === 'string'
            && key[2].length <= 500 && /\.(xlsx|csv)$/i.test(key[2]) && key[2].split('/').every(part => part && !part.startsWith('.') && !/[\\\u0000]/.test(part))) fileNames.push(key[2]);
        } catch { /* A malformed key is never authority to read its payload. */ }
        entry.continue();
      };
      tx.oncomplete = () => resolve({ fileNames: [...new Set(fileNames)], cursor });
      tx.onerror = tx.onabort = () => reject(Error('Restore discovery is unavailable on this device.'));
    });
  } finally { database.close(); }
}
