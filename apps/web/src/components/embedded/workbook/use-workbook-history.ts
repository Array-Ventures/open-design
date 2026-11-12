import { useCallback, useEffect, useRef, useState } from 'react';
import { listWorkbookHistory, type WorkbookHistoryVersion } from './history-transport';
import { accessWorkbookRestore } from './draft-store';
import { restoreWorkbookVersion, WorkbookRestoreFinishedError } from './restore-transport';
import { acquireWorkbookDraftLease } from './draft-lease';
import { loadWorkbookPreview } from './preview-transport';
import type { WorkbookRestoreIntent, WorkbookRestoreScope } from './restore-intent';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';

type Preview = { sourceSha256: string; model: WorkbookDocument };
interface Options { scope: WorkbookRestoreScope; source: Preview | null; ready: boolean; dirty(): boolean; pause(): Promise<boolean>; resume(accepted?: boolean): Promise<void>; accepted(source: Preview): void; focusOnClose?(): void }
export function useWorkbookHistory(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [open, setOpen] = useState(false), [versions, setVersions] = useState<WorkbookHistoryVersion[]>([]);
  const [selected, setSelected] = useState<WorkbookHistoryVersion | null>(null), [cursor, setCursor] = useState<string | null>(null);
  const [sha, setSha] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [working, setWorking] = useState(false), [checking, setChecking] = useState(true);
  const [intent, setIntent] = useState<WorkbookRestoreIntent | null>(null);
  const generation = useRef(0);
  const life = useRef<AbortController | null>(null), busy = useRef(false), paging = useRef(false);
  const selection = useRef<WorkbookHistoryVersion | null>(null); selection.current = selected;
  const scopeKey = JSON.stringify(options.scope);
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    setChecking(true);
    void accessWorkbookRestore(options.scope).then(saved => { if (!controller.signal.aborted) { setIntent(saved); if (saved) setOpen(true); } })
      .catch(cause => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Restore recovery is unavailable.'); setOpen(true); } })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => { controller.abort(); life.current = null; };
  }, [scopeKey]);
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
    } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'History could not be loaded.'); }
    finally { if (!signal.aborted) { paging.current = false; setLoading(false); } }
  }, [scopeKey, cursor, sha]);
  const show = useCallback(() => { setOpen(true); }, []);
  const close = useCallback(() => { setOpen(false); latest.current.focusOnClose?.(); }, []);
  const toggle = useCallback(() => setOpen(value => !value), []);
  useEffect(() => { if (open && !versions.length && !loading) void page(); }, [open]);
  const restore = useCallback(async () => {
    const current = latest.current, signal = life.current?.signal, chosen = selection.current;
    if (!signal || signal.aborted || busy.current || checking || !current.ready || current.dirty()) {
      setError('Save or discard your unsaved changes before restoring a revision.'); return;
    }
    if (!intent && (!chosen || !sha || sha !== current.source?.sourceSha256 || chosen.contentDigest === sha)) {
      setError('The current workbook changed. Refresh the workbook and history before restoring.'); return;
    }
    generation.current += 1; busy.current = true; setWorking(true); setError(null);
    let accepted = false;
    let attempt: WorkbookRestoreIntent | null = null;
    let lease: Awaited<ReturnType<typeof acquireWorkbookDraftLease>> = null;
    try {
      if (!await current.pause()) throw Error('Save or discard your unsaved changes before restoring a revision.');
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
      // Keep the operation protected until refreshed bytes exactly match its receipt.
      const refreshed = await loadWorkbookPreview(current.scope.projectId, current.scope.fileName, crypto.randomUUID(), signal);
      if (signal.aborted) return;
      const changedAfterRestore = refreshed.sourceSha256 !== receipt.targetSha256;
      await accessWorkbookRestore(current.scope, { expected: attempt.operationId, value: null });
      if (signal.aborted) return;
      setIntent(null); accepted = true; current.accepted(refreshed); setSelected(null); setVersions([]); setCursor(null); setSha(refreshed.sourceSha256); setOpen(changedAfterRestore);
      if (changedAfterRestore) setError('The revision was restored, then changed elsewhere. Showing the current workbook.');
    } catch (cause) {
      let failure = cause;
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
  }, [checking, intent, sha]);
  return { generation: () => generation.current, isRestoring: () => busy.current || Boolean(intent), open, show, toggle, close, versions, selected, select: setSelected, cursor, sha, error, loading, working, checking, intent,
    blocked: checking || Boolean(intent) || working, refresh: () => page(), more: () => page(true), restore };
}
