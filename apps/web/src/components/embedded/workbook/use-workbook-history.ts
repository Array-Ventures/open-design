import { useCallback, useEffect, useRef, useState } from 'react';
import { listWorkbookHistory, type WorkbookHistoryVersion } from './history-transport';
import { accessWorkbookRestore } from './draft-store';
import { restoreWorkbookVersion, WorkbookRestoreFinishedError } from './restore-transport';
import { acquireWorkbookDraftLease } from './draft-lease';
import { loadWorkbookPreview } from './preview-transport';
import type { WorkbookRestoreIntent, WorkbookRestoreScope } from './restore-intent';
import { WorkbookHostError } from './host-request';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';

type Preview = { sourceSha256: string; model: WorkbookDocument };
function accessDenied(cause: unknown) { return cause instanceof WorkbookHostError && [401, 403, 404].includes(cause.status); }
interface Options { scope: WorkbookRestoreScope; source: Preview | null; ready: boolean; dirty(): boolean; pause(): Promise<boolean>; resume(accepted?: boolean): Promise<void>; accepted(source: Preview): void; unreadable?(): void; focusOnClose?(): void; onAccessLost?(): void }
export function useWorkbookHistory(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [open, setOpen] = useState(false), [versions, setVersions] = useState<WorkbookHistoryVersion[]>([]);
  const [selected, setSelected] = useState<WorkbookHistoryVersion | null>(null), [cursor, setCursor] = useState<string | null>(null);
  const [sha, setSha] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [working, setWorking] = useState(false), [checking, setChecking] = useState(true);
  const [available, setAvailable] = useState(false), [denied, setDenied] = useState(false), [accessAttempt, setAccessAttempt] = useState(0);
  const [intent, setIntent] = useState<WorkbookRestoreIntent | null>(null);
  const generation = useRef(0);
  const life = useRef<AbortController | null>(null), busy = useRef(false), paging = useRef(false);
  const selection = useRef<WorkbookHistoryVersion | null>(null); selection.current = selected;
  const scopeKey = JSON.stringify(options.scope);
  const revoke = useCallback(() => {
    life.current?.abort(); life.current = null; generation.current += 1;
    setAvailable(false); setDenied(true); setChecking(false); setWorking(false); setLoading(false); setIntent(null); setVersions([]); setSelected(null); setCursor(null); setSha(null); setOpen(false);
    latest.current.onAccessLost?.();
  }, []);
  // Only fresh server-authorized passive history may unlock restore identity
  // metadata. Editable draft bytes remain separately gated by a valid preview
  // in useWorkbookRecovery; a corrupt current XLSX never grants draft access.
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    busy.current = false; paging.current = false; setWorking(false); setLoading(false); setChecking(true); setAvailable(false); setError(null);
    void (async () => {
      try {
        const result = await listWorkbookHistory(options.scope.projectId, options.scope.fileName, controller.signal, { limit: 20 });
        if (controller.signal.aborted) return;
        setVersions(result.versions); setCursor(result.nextCursor); setSha(result.currentSha256); setDenied(false);
        const saved = await accessWorkbookRestore(options.scope);
        if (controller.signal.aborted) return;
        setAvailable(true); setIntent(saved); if (saved) setOpen(true);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (accessDenied(cause)) revoke();
        else setOpen(true);
        setError(cause instanceof Error ? cause.message : 'Restore recovery is unavailable.');
      } finally { if (!controller.signal.aborted) setChecking(false); }
    })();
    return () => { controller.abort(); if (life.current === controller) life.current = null; };
  }, [scopeKey, accessAttempt, revoke]);
  const page = useCallback(async (next = false) => {
    const signal = life.current?.signal; if (!signal || signal.aborted || paging.current || busy.current) return;
    paging.current = true; setLoading(true); setError(null);
    try {
      const result = await listWorkbookHistory(options.scope.projectId, options.scope.fileName, signal, { limit: 20, ...(next && cursor ? { cursor } : {}) });
      if (signal.aborted) return;
      if (next && result.currentSha256 !== sha) throw Error('The workbook changed while loading history. Refresh history to see its current revision.');
      setVersions(current => next ? [...current, ...result.versions.filter(item => !current.some(previous => previous.id === item.id))] : result.versions);
      setCursor(result.nextCursor); setSha(result.currentSha256);
      if (!next) setSelected(null);
    } catch (cause) { if (!signal.aborted) { if (accessDenied(cause)) revoke(); setError(cause instanceof Error ? cause.message : 'History could not be loaded.'); } }
    finally { if (!signal.aborted) { paging.current = false; setLoading(false); } }
  }, [scopeKey, cursor, sha, revoke]);
  const show = useCallback(() => { setOpen(true); }, []);
  const close = useCallback(() => { setOpen(false); latest.current.focusOnClose?.(); }, []);
  const toggle = useCallback(() => setOpen(value => !value), []);
  useEffect(() => { if (available && open && !versions.length && !loading) void page(); }, [open, available]);
  const restore = useCallback(async () => {
    const current = latest.current, signal = life.current?.signal, chosen = selection.current;
    if (available && !sha) { setError('The current workbook is missing. History restore will not recreate it.'); return; }
    if (!signal || signal.aborted || busy.current || checking || !available || !sha || current.source !== null && !current.ready || current.dirty()) {
      setError('Save or discard your unsaved changes before restoring a revision.'); return;
    }
    if (!intent && (!chosen || !sha || current.source !== null && sha !== current.source.sourceSha256 || chosen.contentDigest === sha)) {
      setError('The current workbook changed. Refresh the workbook and history before restoring.'); return;
    }
    generation.current += 1; busy.current = true; setWorking(true); setError(null);
    let accepted = false;
    let attempt: WorkbookRestoreIntent | null = null;
    let lease: Awaited<ReturnType<typeof acquireWorkbookDraftLease>> = null;
    try {
      if (!await current.pause()) throw Error('Save or discard your unsaved changes before restoring a revision.');
      const fresh = await listWorkbookHistory(current.scope.projectId, current.scope.fileName, signal, { limit: 1 });
      if (signal.aborted) return;
      if (!fresh.currentSha256 || fresh.currentSha256 !== sha) {
        setSha(fresh.currentSha256); setSelected(null);
        throw Error(fresh.currentSha256 ? 'The current workbook changed. Refresh history before choosing a revision again.' : 'The current workbook is missing. History restore will not recreate it.');
      }
      attempt = intent ?? { version: 1, ...current.scope, operationId: crypto.randomUUID(), preparationId: crypto.randomUUID(), versionId: chosen!.id, versionNumber: chosen!.version, versionSha256: chosen!.contentDigest, sourceSha256: sha! };
      lease = await acquireWorkbookDraftLease({ ...current.scope, draftId: attempt.operationId }, signal);
      if (!lease) throw Error('This restore is being checked in another tab. Try again there.');
      if (!intent) await accessWorkbookRestore(current.scope, { expected: null, value: attempt });
      if (signal.aborted) return;
      setIntent(attempt);
      const owned = attempt;
      const protect = async () => { await accessWorkbookRestore(current.scope, { expected: owned.operationId, value: owned }); };
      const receipt = await restoreWorkbookVersion(attempt, protect, signal);
      if (signal.aborted) return;
      // A valid receipt proves the exact restore completed. If those bytes
      // cannot render, fresh passive history can still confirm current bytes
      // without reading/editing local drafts or trapping the person in retry.
      let refreshed: Preview | null = null;
      let unreadable: Awaited<ReturnType<typeof listWorkbookHistory>> | null = null;
      try { refreshed = await loadWorkbookPreview(current.scope.projectId, current.scope.fileName, crypto.randomUUID(), signal); }
      catch (cause) {
        if (!(cause instanceof WorkbookHostError) || cause.status !== 422) throw cause;
        unreadable = await listWorkbookHistory(current.scope.projectId, current.scope.fileName, signal, { limit: 20 });
      }
      if (signal.aborted) return;
      const actualSha = refreshed?.sourceSha256 ?? unreadable!.currentSha256;
      const changedAfterRestore = actualSha !== receipt.targetSha256;
      await accessWorkbookRestore(current.scope, { expected: attempt.operationId, value: null });
      if (signal.aborted) return;
      setIntent(null); accepted = true;
      if (refreshed) current.accepted(refreshed); else current.unreadable?.();
      setSelected(null); setVersions(unreadable?.versions ?? []); setCursor(unreadable?.nextCursor ?? null); setSha(actualSha); setOpen(changedAfterRestore || !refreshed);
      if (changedAfterRestore) setError('The revision was restored, then changed elsewhere. Refresh history before another restore.');
      else if (!refreshed) setError('The saved version was restored but cannot be previewed. Choose another version; local drafts are kept.');
    } catch (cause) {
      let failure = cause;
      if (!signal.aborted && accessDenied(cause)) revoke();
      if (cause instanceof WorkbookRestoreFinishedError && attempt) {
        try {
          await accessWorkbookRestore(current.scope, { expected: attempt.operationId, value: null });
          if (!signal.aborted) { setIntent(null); setVersions([]); setSelected(null); }
        } catch (storageError) { failure = storageError; }
      }
      if (!signal.aborted) setError(failure instanceof Error ? failure.message : 'The restore could not be confirmed. Check its status again.');
    } finally {
      try { if (lease) await lease.release(async () => {}); }
      catch { if (!signal.aborted) setError('The restore could not be released safely. Reopen this workbook to check its status.'); }
      try { if (!signal.aborted) await current.resume(accepted); }
      catch { if (!signal.aborted) setError('Reopen this workbook to resume editing. Your restore identity is protected.'); }
      finally { if (!signal.aborted) { busy.current = false; setWorking(false); } }
    }
  }, [checking, intent, sha, available, revoke]);
  return { generation: () => generation.current, isRestoring: () => busy.current || Boolean(intent), available, canOpen: !denied, missing: available && sha === null, denyAccess: revoke, open, show, toggle, close, versions, selected, select: setSelected, cursor, sha, error, loading, working, checking, intent,
    blocked: checking || !available || Boolean(intent) || working, refresh: () => available ? page() : Promise.resolve(setAccessAttempt(value => value + 1)), more: () => page(true), restore };
}
