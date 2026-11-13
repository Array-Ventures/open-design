import { useCallback, useEffect, useRef, useState } from 'react';
import { listWorkbookHistory, type WorkbookHistoryVersion } from './history-transport';
import { accessWorkbookRestore } from './draft-store';
import { restoreWorkbookVersion, WorkbookRestoreFinishedError, WorkbookRestoreReceiptUnavailableError } from './restore-transport';
import { acquireWorkbookDraftLease } from './draft-lease';
import { loadWorkbookPreview } from './preview-transport';
import type { WorkbookRestoreIntent, WorkbookRestoreScope } from './restore-intent';
import { WorkbookHostError } from './host-request';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';

type Preview = { sourceSha256: string; model: WorkbookDocument };
function accessDenied(cause: unknown) { return cause instanceof WorkbookHostError && [401, 403, 404].includes(cause.status); }
interface Options { scope: WorkbookRestoreScope; statusOnly?: boolean; source: Preview | null; ready: boolean; dirty(): boolean; pause(): Promise<boolean>; resume(accepted?: boolean): Promise<void>; accepted(source: Preview): void; unreadable?(message?: string, refresh?: boolean): void; focusOnClose?(): void; onAccessLost?(): void }
export function useWorkbookHistory(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [open, setOpen] = useState(false), [versions, setVersions] = useState<WorkbookHistoryVersion[]>([]);
  const [selected, setSelected] = useState<WorkbookHistoryVersion | null>(null), [cursor, setCursor] = useState<string | null>(null);
  const [sha, setSha] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [working, setWorking] = useState(false), [checking, setChecking] = useState(true);
  const [available, setAvailable] = useState(false), [denied, setDenied] = useState(false), [accessAttempt, setAccessAttempt] = useState(0);
  const [fresh, setFresh] = useState(false), [opening, setOpening] = useState(0);
  const freshFor = useRef<string | null>(null), refreshedOpening = useRef(0);
  const listing = useRef<AbortController | null>(null);
  const [intent, setIntent] = useState<WorkbookRestoreIntent | null>(null);
  const generation = useRef(0);
  const life = useRef<AbortController | null>(null), busy = useRef(false), paging = useRef(false);
  const selection = useRef<WorkbookHistoryVersion | null>(null); selection.current = selected;
  const scopeKey = JSON.stringify(options.scope);
  const headKey = JSON.stringify([scopeKey, options.source?.sourceSha256 ?? null]);
  const readKey = useRef({ headKey, opening }); readKey.current = { headKey, opening };
  const headFresh = fresh && freshFor.current === headKey && refreshedOpening.current === opening;
  const revoke = useCallback(() => {
    life.current?.abort(); life.current = null; listing.current?.abort(); listing.current = null; setFresh(false); generation.current += 1;
    setNotice(null); setAvailable(false); setDenied(true); setChecking(false); setWorking(false); setLoading(false); setIntent(null); setVersions([]); setSelected(null); setCursor(null); setSha(null); setOpen(false);
    latest.current.onAccessLost?.();
  }, []);
  // Only fresh server-authorized passive history may unlock restore identity
  // metadata. Editable draft bytes remain separately gated by a valid preview
  // in useWorkbookRecovery; a corrupt current XLSX never grants draft access.
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    const initialRead = readKey.current; setFresh(false);
    busy.current = false; paging.current = false; setWorking(false); setLoading(false); setChecking(true); setAvailable(false); setError(null); setNotice(null);
    void (async () => {
      try {
        const result = await listWorkbookHistory(options.scope.projectId, options.scope.fileName, controller.signal, { limit: 20 });
        if (controller.signal.aborted) return;
        setVersions(result.versions); setCursor(result.nextCursor); setSha(result.currentSha256); setDenied(false);
        const saved = await accessWorkbookRestore(options.scope);
        if (controller.signal.aborted) return;
        freshFor.current = initialRead.headKey; refreshedOpening.current = initialRead.opening; setFresh(true);
        setAvailable(true); setIntent(saved); if (saved) setOpen(true);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (accessDenied(cause)) revoke();
        else setOpen(true);
        setError(cause instanceof Error ? cause.message : 'Restore recovery is unavailable.');
      } finally { if (!controller.signal.aborted) setChecking(false); }
    })();
    return () => { controller.abort(); listing.current?.abort(); if (life.current === controller) life.current = null; };
  }, [scopeKey, accessAttempt, revoke]);
  const page = useCallback(async (next = false) => {
    const lifetime = life.current?.signal;
    if (!lifetime || lifetime.aborted || busy.current || next && paging.current) return;
    if (!next) listing.current?.abort();
    const controller = new AbortController(); listing.current = controller;
    const abort = () => controller.abort(); lifetime.addEventListener('abort', abort, { once: true });
    const signal = controller.signal, requested = readKey.current;
    paging.current = true; setLoading(true); setError(null); if (!next) setFresh(false);
    try {
      const result = await listWorkbookHistory(options.scope.projectId, options.scope.fileName, signal, { limit: 20, ...(next && cursor ? { cursor } : {}) });
      if (signal.aborted || requested.headKey !== readKey.current.headKey || requested.opening !== readKey.current.opening) return;
      if (next && result.currentSha256 !== sha) throw Error('The workbook changed while loading history. Refresh history to see its current revision.');
      setVersions(current => next ? [...current, ...result.versions.filter(item => !current.some(previous => previous.id === item.id))] : result.versions);
      setCursor(result.nextCursor); setSha(result.currentSha256);
      if (!next) { setSelected(null); freshFor.current = requested.headKey; refreshedOpening.current = requested.opening; setFresh(true); }
    } catch (cause) { if (!signal.aborted) { if (accessDenied(cause)) revoke(); setError(cause instanceof Error ? cause.message : 'History could not be loaded.'); } }
    finally { lifetime.removeEventListener('abort', abort); if (listing.current === controller) { listing.current = null; paging.current = false; if (!lifetime.aborted) setLoading(false); } }
  }, [scopeKey, cursor, sha, revoke]);
  const openRef = useRef(open); openRef.current = open;
  const invalidate = useCallback(() => { listing.current?.abort(); setFresh(false); }, []);
  const show = useCallback(() => { invalidate(); setOpening(value => value + 1); setOpen(true); }, [invalidate]);
  const close = useCallback(() => { invalidate(); setOpen(false); latest.current.focusOnClose?.(); }, [invalidate]);
  const toggle = useCallback(() => { if (openRef.current) close(); else show(); }, [close, show]);
  const pageRef = useRef(page); pageRef.current = page;
  // One bounded refresh for an opening or acknowledged source-head change.
  // The read marker is not an effect dependency: completing a page cannot loop.
  useEffect(() => {
    if (available && open && !working && (freshFor.current !== headKey || refreshedOpening.current !== opening)) void pageRef.current(false);
  }, [open, opening, headKey, available, working]);
  const restore = useCallback(async () => {
    const current = latest.current, signal = life.current?.signal, chosen = selection.current;
    if (!signal || signal.aborted || busy.current || paging.current || checking || !available || !headFresh) return;
    // A retained operation is reconciled by receipt even if its source was
    // changed/deleted or a local draft is open. Only a new write needs a clean
    // editor and a non-null unchanged source.
    if (current.statusOnly && !intent) { setError('No unresolved restore remains for this file.'); return; }
    if (!intent && (!sha || current.source !== null && !current.ready || current.dirty())) {
      setError(!sha ? 'The current workbook is missing. History restore will not recreate it.' : 'Save or discard your unsaved changes before restoring a revision.'); return;
    }
    if (!intent && (!chosen || current.source !== null && sha !== current.source.sourceSha256 || chosen.contentDigest === sha)) {
      setError('The current workbook changed. Refresh the workbook and history before restoring.'); return;
    }
    generation.current += 1; setNotice(null); busy.current = true; setWorking(true); setError(null);
    let accepted = false, paused = false;
    const attempt: WorkbookRestoreIntent = intent ?? { version: 1, ...current.scope, operationId: crypto.randomUUID(), preparationId: crypto.randomUUID(), versionId: chosen!.id, versionNumber: chosen!.version, versionSha256: chosen!.contentDigest, sourceSha256: sha! };
    let lease: Awaited<ReturnType<typeof acquireWorkbookDraftLease>> = null;
    const observe = async (limit = 20) => listWorkbookHistory(current.scope.projectId, current.scope.fileName, signal, { limit });
    const showCurrent = (fresh: Awaited<ReturnType<typeof listWorkbookHistory>>) => {
      setVersions(fresh.versions); setCursor(fresh.nextCursor); setSha(fresh.currentSha256); setSelected(null);
    };
    const clean = () => !current.dirty() && (current.source === null || current.ready);
    const pauseClean = async () => {
      if (paused) return true;
      if (!clean() || !await current.pause()) return false;
      paused = true; return true;
    };
    const protect = async () => { await accessWorkbookRestore(current.scope, { expected: attempt.operationId, value: attempt }); };
    try {
      lease = await acquireWorkbookDraftLease({ ...current.scope, draftId: attempt.operationId }, signal);
      if (!lease) throw Error('This restore is being checked in another tab. Try again there.');
      let receipt;
      if (intent) {
        // Status first: neither a stale nor missing working file may hide an
        // already applied/rejected exact receipt. This path cannot prepare/save.
        try { receipt = await restoreWorkbookVersion(attempt, protect, signal, { allowPrepare: false }); }
        catch (cause) {
          if (!(cause instanceof WorkbookRestoreReceiptUnavailableError)) throw cause;
          const fresh = await observe(current.statusOnly ? 20 : 1); if (signal.aborted) return;
          if (current.statusOnly) { showCurrent(fresh); throw cause; }
          if (!fresh.currentSha256 || fresh.currentSha256 !== attempt.sourceSha256) {
            setSha(fresh.currentSha256); setSelected(null);
            throw new WorkbookRestoreReceiptUnavailableError(fresh.currentSha256
              ? 'The original workbook changed and this restore has no receipt yet. No new write was submitted; keep checking this same operation.'
              : 'The current workbook is missing and this restore has no receipt yet. It was not recreated; keep checking this same operation.');
          }
          if (!await pauseClean()) throw Error('The restore has no receipt yet. Keep your local draft before resuming this operation.');
          receipt = await restoreWorkbookVersion(attempt, protect, signal, { allowPrepare: true });
        }
      } else {
        if (!await pauseClean()) throw Error('Save or discard your unsaved changes before restoring a revision.');
        const fresh = await observe(1); if (signal.aborted) return;
        if (!fresh.currentSha256 || fresh.currentSha256 !== sha) {
          setSha(fresh.currentSha256); setSelected(null);
          throw Error(fresh.currentSha256 ? 'The current workbook changed. Refresh history before choosing a revision again.' : 'The current workbook is missing. History restore will not recreate it.');
        }
        await accessWorkbookRestore(current.scope, { expected: null, value: attempt });
        if (signal.aborted) return;
        setIntent(attempt);
        receipt = await restoreWorkbookVersion(attempt, protect, signal, { allowPrepare: true });
      }
      if (signal.aborted) return;
      // A fresh passive history read proves project access independently of the
      // current file's existence. A missing file after an applied receipt is a
      // later deletion, not permission denial and never permission to recreate.
      let fresh = await observe(); if (signal.aborted) return;
      let refreshed: Preview | null = null;
      const mayReplace = !current.statusOnly && fresh.currentSha256 !== null && await pauseClean();
      if (mayReplace) {
        try { refreshed = await loadWorkbookPreview(current.scope.projectId, current.scope.fileName, crypto.randomUUID(), signal); }
        catch (cause) {
          if (!(cause instanceof WorkbookHostError) || ![404, 422].includes(cause.status)) throw cause;
          // A file-level 404 can race deletion. Recheck the authorized history
          // boundary before classifying it as access loss or unreadable bytes.
          fresh = await observe();
        }
      }
      if (signal.aborted) return;
      const actualSha = refreshed?.sourceSha256 ?? fresh.currentSha256;
      await accessWorkbookRestore(current.scope, { expected: attempt.operationId, value: null });
      if (signal.aborted) return;
      setIntent(null); showCurrent(fresh); setSha(actualSha); setOpen(true);
      if (current.dirty()) {
        setNotice(actualSha === null ? 'The restore completed, but the current file is now missing. Your local draft was kept.' : 'The restore completed. Your local draft was kept; reload only after keeping your edits.');
      } else if (actualSha === null) {
        const message = 'The restore completed, but the current file is now missing. It was not recreated.';
        accepted = true; current.unreadable?.(message, false); setNotice(message);
      } else if (refreshed) {
        accepted = true; current.accepted(refreshed);
        setOpen(actualSha !== receipt.targetSha256);
        if (actualSha !== receipt.targetSha256) setNotice('The revision was restored, then changed elsewhere. Refresh history before another restore.');
      } else if (mayReplace) {
        accepted = true; current.unreadable?.();
        setNotice('The saved version was restored but cannot be previewed. Choose another version; local drafts are kept.');
      } else {
        setNotice(current.statusOnly ? 'The restore was confirmed. Return to the artifact to view its current file.' : 'The restore was confirmed. Your drafts were kept; reload the current workbook when ready.');
      }
    } catch (cause) {
      let failure = cause;
      if (!signal.aborted && accessDenied(cause)) revoke();
      if (cause instanceof WorkbookRestoreFinishedError && !signal.aborted) {
        try {
          const fresh = await observe(); if (signal.aborted) return;
          await accessWorkbookRestore(current.scope, { expected: attempt.operationId, value: null });
          if (!signal.aborted) { setIntent(null); showCurrent(fresh); }
        } catch (confirmationError) { failure = confirmationError; if (accessDenied(confirmationError)) revoke(); }
      }
      if (!signal.aborted) setError(failure instanceof Error ? failure.message : 'The restore could not be confirmed. Check its status again.');
    } finally {
      try { if (lease) await lease.release(async () => {}); }
      catch { if (!signal.aborted) setError('The restore could not be released safely. Reopen this workbook to check its status.'); }
      try { if (paused && !signal.aborted) await current.resume(accepted); }
      catch { if (!signal.aborted) setError('Reopen this workbook to resume editing. Your restore identity is protected.'); }
      finally { if (!signal.aborted) { busy.current = false; setWorking(false); } }
    }
  }, [checking, intent, sha, available, revoke, headFresh]);
  return { generation: () => generation.current, isRestoring: () => busy.current || Boolean(intent), statusOnly: Boolean(options.statusOnly), available, canOpen: !denied, missing: available && sha === null, denyAccess: revoke, open, show, toggle, close, versions, selected, select: setSelected, cursor, sha, error, notice, fresh: headFresh, loading, working, checking, intent,
    blocked: checking || !available || Boolean(intent) || working, refresh: () => available ? page() : Promise.resolve(setAccessAttempt(value => value + 1)), more: () => page(true), restore };
}
