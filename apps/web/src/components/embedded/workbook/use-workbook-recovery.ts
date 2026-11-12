import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkbookDraftScope } from './workbook-checkpoint';
import { listWorkbookDrafts, readWorkbookDraft, saveWorkbookDraft, type WorkbookDraftHead } from './draft-store';
import { acquireWorkbookDraftLease, type WorkbookDraftLease } from './draft-lease';
import type { WorkbookJournal } from './workbook-writer';
import { downloadWorkbookDraft } from './download-draft';
import { awaitRetiredWorkbookDrafts, retireWorkbookDraft } from './draft-retirement';

type Scope = Omit<WorkbookDraftScope, 'draftId'>;
interface Session { scope: WorkbookDraftScope; lease: WorkbookDraftLease; journal: WorkbookJournal }
interface RecoveryState { drafts: WorkbookDraftHead[]; busy: boolean; error: string | null; session: Session | null }
const initial: RecoveryState = { drafts: [], busy: true, error: null, session: null };

/** The caller enables this only after a fresh authorized workbook preview.
 * A branch is locked before reading or deleting it and until its writer drains. */
export function useWorkbookRecovery(scope: Scope, enabled: boolean, drain: () => Promise<void>) {
  const [state, setState] = useState<RecoveryState>(initial);
  const lifetime = useRef<AbortController | null>(null), owned = useRef<Session | null>(null);
  const drainRef = useRef(drain); drainRef.current = drain;
  const scopeKey = JSON.stringify(scope);
  const busy = useRef<AbortSignal | null>(null);
  const releaseTemporary = useCallback(async (target: WorkbookDraftScope, lease: WorkbookDraftLease, signal: AbortSignal) => {
    try { await lease.release(async () => {}); }
    catch {
      retireWorkbookDraft(target, lease, Promise.resolve());
      if (!signal.aborted) setState(current => ({ ...current, busy: false, error: 'This draft could not be released safely. Reopen the workbook, or reload this tab before trying again.' }));
    }
  }, []);
  const start = useCallback(async (draftId?: string) => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy.current === signal || owned.current) return;
    busy.current = signal; setState(current => ({ ...current, busy: true, error: null }));
    let lease: WorkbookDraftLease | null = null;
    const target = { ...scope, draftId: draftId ?? crypto.randomUUID() };
    try {
      await awaitRetiredWorkbookDrafts(scope);
      if (signal.aborted) return;
      lease = await acquireWorkbookDraftLease(target, signal);
      if (!lease) throw Error('This draft is open in another tab, or this browser cannot protect it.');
      if (signal.aborted) return;
      const restored = draftId ? await readWorkbookDraft(target) : null;
      if (draftId && !restored) throw Error('This draft is no longer available. Reopen the workbook to refresh the list.');
      if (signal.aborted) return;
      const session: Session = { scope: target, lease, journal: { save: checkpoint => saveWorkbookDraft(target, checkpoint), ...(restored ? { restored } : {}) } };
      owned.current = session; lease = null;
      setState(current => ({ ...current, busy: false, error: null, session }));
    } catch (error) {
      if (!signal.aborted) setState(current => ({ ...current, busy: false, error: error instanceof Error ? error.message : 'Workbook recovery is unavailable.' }));
    } finally { if (lease) await releaseTemporary(target, lease, signal); if (busy.current === signal) busy.current = null; }
  }, [scopeKey, releaseTemporary]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(); lifetime.current = controller;
    setState(initial);
    void awaitRetiredWorkbookDrafts(scope).then(() => controller.signal.aborted ? null : listWorkbookDrafts(scope)).then(drafts => {
      if (controller.signal.aborted) return;
      if (!drafts) return;
      setState({ drafts, busy: false, error: null, session: null });
      if (!drafts.length) void start();
    }).catch(error => { if (!controller.signal.aborted) setState({ drafts: [], busy: false, error: error instanceof Error ? error.message : 'Workbook recovery storage is unavailable. Try reopening the workbook.', session: null }); });
    return () => {
      controller.abort();
      const session = owned.current; owned.current = null;
      if (session) {
        // Detach the current writer synchronously, before a later mount can
        // replace the caller's ref while Web Locks schedules its release.
        const drained = drainRef.current();
        retireWorkbookDraft(session.scope, session.lease, drained);
      }
    };
  }, [scopeKey, enabled, start]);
  const discard = useCallback(async (draftId: string) => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy.current === signal || owned.current) return;
    busy.current = signal; setState(current => ({ ...current, busy: true, error: null }));
    let lease: WorkbookDraftLease | null = null;
    let openCurrent = false;
    const target = { ...scope, draftId };
    try {
      await awaitRetiredWorkbookDrafts(scope);
      if (signal.aborted) return;
      lease = await acquireWorkbookDraftLease(target, signal);
      if (!lease) throw Error('Close the tab editing this draft before discarding it.');
      if (signal.aborted) return;
      const checkpoint = await readWorkbookDraft(target);
      if (signal.aborted) return;
      if (checkpoint?.pending) throw Error('Restore this draft and check its save status before discarding it.');
      await saveWorkbookDraft(target, null);
      const drafts = await listWorkbookDrafts(scope);
      if (!signal.aborted) setState(current => ({ ...current, drafts, busy: false }));
      openCurrent = drafts.length === 0;
    } catch (error) {
      if (!signal.aborted) setState(current => ({ ...current, busy: false, error: error instanceof Error ? error.message : 'The draft could not be discarded.' }));
    } finally {
      if (lease) await releaseTemporary(target, lease, signal);
      if (busy.current === signal) busy.current = null;
      if (openCurrent && !signal.aborted) void start();
    }
  }, [scopeKey, releaseTemporary, start]);
  const download = useCallback(async (draftId: string) => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy.current === signal || owned.current) return;
    busy.current = signal; setState(current => ({ ...current, busy: true, error: null }));
    let lease: WorkbookDraftLease | null = null;
    const target = { ...scope, draftId };
    try {
      await awaitRetiredWorkbookDrafts(scope);
      if (signal.aborted) return;
      lease = await acquireWorkbookDraftLease(target, signal);
      if (!lease) throw Error('Close the tab editing this draft before downloading its recovery copy.');
      if (signal.aborted) return;
      const checkpoint = await readWorkbookDraft(target);
      if (!checkpoint) throw Error('This draft is no longer available.');
      if (!signal.aborted) downloadWorkbookDraft(target, checkpoint);
      if (!signal.aborted) setState(current => ({ ...current, busy: false }));
    } catch (error) {
      if (!signal.aborted) setState(current => ({ ...current, busy: false, error: error instanceof Error ? error.message : 'The recovery copy could not be downloaded.' }));
    } finally { if (lease) await releaseTemporary(target, lease, signal); if (busy.current === signal) busy.current = null; }
  }, [scopeKey, releaseTemporary]);
  return { ...state, session: enabled && owned.current === state.session ? state.session : null, restore: start, continueCurrent: () => start(), discard, download };
}
