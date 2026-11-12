import { z } from 'zod';
const identity = { projectId: z.string().uuid(), controllerId: z.string().uuid(), requestId: z.string().uuid() };
const message = z.object({ ...identity, type: z.enum(['studio:discard-workbook', 'studio:commit-workbook-discard', 'studio:cancel-workbook-discard', 'studio:finish-workbook-discard']) }).strict();
export class WorkbookDiscardNotCommittedError extends Error {}
export interface PreparedWorkbookDiscard { commit(): Promise<void>; cancel(): Promise<void> }
interface Events { origin: string; parent: Window; listen(receive: (event: Pick<MessageEvent, 'source' | 'origin' | 'data'>) => void): () => void }
type Entry = { id: string; phase: 'preparing' | 'ready' | 'committing' | 'done' | 'cancelled' | 'failed'; controller: AbortController; prepared?: PreparedWorkbookDiscard; task?: Promise<void>; error?: string; granted?: boolean };
/** A commit grant is irreversible. Completed grants are retained briefly for
 * lost-ack retries, but never execute again against a newer writer/branch. */
export function connectWorkbookDiscard(projectId: string, controllerId: string, prepare: (signal: AbortSignal) => Promise<PreparedWorkbookDiscard>,
  events: Events = { origin: window.location.origin, parent: window.parent, listen: receive => { window.addEventListener('message', receive); return () => window.removeEventListener('message', receive); } }, retentionMs = 5 * 60_000) {
  let active = true, disconnect = () => {}, expiry: ReturnType<typeof setTimeout> | undefined;
  const entries = new Map<string, Entry>();
  const post = (entry: Entry, type: string, extra = {}) => { try { events.parent.postMessage({ type, projectId, controllerId, requestId: entry.id, ...extra }, events.origin); } catch { /* Exact-ID retry can recover a lost acknowledgement. */ } };
  const reply = (entry: Entry) => {
    if (entry.phase === 'ready') post(entry, 'studio:workbook-discard-ready');
    if (['done', 'cancelled', 'failed'].includes(entry.phase)) post(entry, 'studio:workbook-discarded', { accepted: entry.phase === 'done', ...(entry.phase === 'cancelled' ? { uncommitted: true } : {}), ...(entry.error ? { error: entry.error.slice(0, 500) } : {}) });
  };
  const expire = () => {
    if (active || [...entries.values()].some(entry => entry.phase === 'committing' || entry.phase === 'preparing' || entry.granted)) return;
    clearTimeout(expiry); expiry = setTimeout(() => { entries.clear(); disconnect(); }, retentionMs);
  };
  const cancel = (entry: Entry) => {
    if (entry.granted || entry.phase === 'committing' || entry.phase === 'done' || entry.phase === 'cancelled') return;
    entry.phase = 'cancelled'; entry.controller.abort();
    entry.task = Promise.resolve().then(() => entry.prepared?.cancel()).catch(() => {}).then(() => { delete entry.prepared; reply(entry); expire(); });
  };
  disconnect = events.listen(event => {
    if (event.source !== events.parent || event.origin !== events.origin) return;
    const parsed = message.safeParse(event.data);
    if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.controllerId !== controllerId) return;
    const request = parsed.data;
    let entry = entries.get(request.requestId);
    if (request.type === 'studio:finish-workbook-discard') { if (entry?.phase === 'done') { entries.delete(entry.id); if (!active && !entries.size) disconnect(); else expire(); } return; }
    if (request.type === 'studio:cancel-workbook-discard') { if (entry) cancel(entry); return; }
    if (entry) {
      if (request.type === 'studio:commit-workbook-discard' && entry.phase === 'ready' && (active || entry.granted)) {
        entry.phase = 'committing'; entry.granted = true;
        const owned = entry;
        owned.task = Promise.resolve().then(() => owned.prepared!.commit()).then(() => { owned.phase = 'done'; delete owned.prepared; delete owned.task; reply(owned); }, error => {
          // A failed commit is retryable only for this exact frozen transaction;
          // no new prepare or current writer may be substituted.
          if (error instanceof WorkbookDiscardNotCommittedError) { owned.phase = 'cancelled'; owned.granted = false; owned.error = error.message; reply(owned); return; }
          owned.phase = 'ready'; owned.error = error instanceof Error ? error.message : 'The draft could not be discarded.';
          post(owned, 'studio:workbook-discarded', { accepted: false, error: owned.error.slice(0, 500) });
        }).finally(expire);
      } else reply(entry);
      return;
    }
    if (!active || request.type !== 'studio:discard-workbook') return;
    const busy = [...entries.values()].some(entry => entry.granted || ['preparing', 'ready', 'committing'].includes(entry.phase));
    if (busy) { post({ id: request.requestId } as Entry, 'studio:workbook-discarded', { accepted: false, error: 'A workbook discard is already being checked.' }); return; }
    // Only settled outcomes may expire. Never evict an uncertain commit.
    for (const [key, old] of entries) if (entries.size >= 32 && !old.granted && ['cancelled', 'failed'].includes(old.phase)) entries.delete(key);
    entry = { id: request.requestId, phase: 'preparing', controller: new AbortController() }; entries.set(entry.id, entry);
    const owned = entry;
    owned.task = Promise.resolve().then(() => prepare(owned.controller.signal)).then(async prepared => {
      owned.prepared = prepared;
      if (!active || owned.controller.signal.aborted || owned.phase === 'cancelled') { await prepared.cancel(); return; }
      owned.phase = 'ready'; reply(owned);
    }).catch(error => {
      if (owned.phase !== 'cancelled') { owned.phase = 'failed'; owned.error = error instanceof Error ? error.message : 'The draft could not be checked.'; reply(owned); }
    }).finally(expire);
  });
  return () => {
    active = false;
    for (const entry of entries.values()) if (entry.phase !== 'committing' && entry.phase !== 'done') cancel(entry);
    expire();
  };
}
