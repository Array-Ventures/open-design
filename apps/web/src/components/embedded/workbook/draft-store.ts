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
export async function saveWorkbookDraft(scope: WorkbookDraftScope, state: WorkbookCheckpoint | null): Promise<void> {
  const key = workbookDraftKey(scope);
  const serialized = state ? bounded(JSON.stringify(encodeWorkbookDraft(scope, state))) : null;
  if (serialized === null) await access([STORE, HEADS], 'readwrite', tx => { tx.objectStore(HEADS).delete(key); return tx.objectStore(STORE).delete(key); });
  else await access([STORE, HEADS], 'readwrite', tx => {
    tx.objectStore(HEADS).put({ id: key, draftId: scope.draftId, artifactKey: workbookDraftArtifactKey(scope), updatedAt: Date.now() } satisfies WorkbookDraftHead);
    return tx.objectStore(STORE).put(serialized, key);
  });
}
