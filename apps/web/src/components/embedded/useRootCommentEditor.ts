import { useLayoutEffect, useRef, useState } from 'react';
import type { PreviewComment } from '../../types';
import { RootCommentWriteError } from '../../providers/comment-write-error';

/** A refreshed root must not silently become the baseline of an unsaved edit. */
export function useRootCommentEditor({ existing, retained, draft, hasExtras, selectionKey, onDraft }: {
  existing: PreviewComment | null; retained: PreviewComment | null; draft: string; hasExtras: boolean;
  selectionKey: string; onDraft(value: string): void;
}) {
  const observation = JSON.stringify([existing?.id, existing?.editToken, existing?.note]);
  const scope = useRef<{ key: string; baseline: PreviewComment | null; observed: string; awaitingProps: boolean } | null>(null);
  if (scope.current?.key !== selectionKey) scope.current = { key: selectionKey, baseline: existing ?? retained, observed: observation, awaitingProps: false };
  const lifetime = scope.current;
  const [, redraw] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [blockedDeletion, setBlockedDeletion] = useState(false);
  const baseline = scope.current.baseline;
  const newObservation = scope.current.observed !== observation;
  const untouchedExternalUpdate = Boolean(newObservation && existing && baseline?.id === existing.id && draft === baseline.note && !hasExtras && (baseline.note !== existing.note || baseline.editToken !== existing.editToken));
  useLayoutEffect(() => { setFailure(null); setBlockedDeletion(false); }, [selectionKey]);
  useLayoutEffect(() => {
    const current = scope.current;
    if (!current || current.observed === observation) return;
    current.observed = observation; current.awaitingProps = false;
    if (existing && current?.baseline?.id === existing.id && draft === current.baseline.note && !hasExtras) {
      current.baseline = existing;
      if (draft !== existing.note) onDraft(existing.note);
    }
  }, [existing, draft, hasExtras, onDraft, observation]);
  useLayoutEffect(() => {
    scope.current = lifetime;
    return () => { if (scope.current === lifetime) scope.current = null; };
  }, [lifetime]);
  const stale = Boolean(existing && baseline?.id === existing.id && baseline.editToken && baseline.editToken !== existing.editToken && !untouchedExternalUpdate && !(scope.current.awaitingProps && !newObservation));
  const deleted = blockedDeletion || Boolean(retained && !existing);
  async function save(submit: (baseline: PreviewComment | undefined) => void | PreviewComment | null | Promise<void | PreviewComment | null>) {
    const current = scope.current;
    if (!current || deleted) return;
    try {
      const saved = await submit(current.baseline ?? undefined);
      if (scope.current !== current) return;
      if (saved === null) { setFailure('The comment could not be saved. Your draft is preserved.'); return; }
      if (saved) { current.baseline = saved; current.awaitingProps = true; redraw(value => value + 1); }
      setFailure(null);
    } catch (error) {
      if (scope.current === current) {
        setFailure(error instanceof RootCommentWriteError ? error.message : 'The comment could not be saved. Your draft is preserved.');
        if (error instanceof RootCommentWriteError && (error.status === 404 || error.status === 410)) setBlockedDeletion(true);
      }
    }
  }
  function rebase() {
    if (!existing || !scope.current) return;
    scope.current.baseline = existing;
    scope.current.observed = observation; scope.current.awaitingProps = false;
    setFailure(null); redraw(value => value + 1);
  }
  return { untouchedExternalUpdate, stale, deleted, failure, save, rebase };
}
