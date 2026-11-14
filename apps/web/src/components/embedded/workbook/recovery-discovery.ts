import type { WorkbookCheckpoint } from './workbook-writer';
import { acquireWorkbookDraftLease, type WorkbookDraftLease } from './draft-lease';
import { listWorkbookDrafts, readWorkbookDraft, saveWorkbookDraft, type WorkbookDraftHead } from './draft-store';
import { workbookCheckpointNeedsRecovery, type WorkbookDraftScope } from './workbook-checkpoint';
import { retireWorkbookDraft } from './draft-retirement';

/** Called only after fresh artifact authorization, like ordinary recovery.
 * Unknown/legacy heads retain the existing explicit-restore prompt. Only a
 * known-clean candidate may be inspected automatically, never trusted to delete. */
export async function discoverWorkbookRecovery(scope: Omit<WorkbookDraftScope, 'draftId'>, source: () => WorkbookCheckpoint['source'] | null | undefined, signal?: AbortSignal): Promise<WorkbookDraftHead[]> {
  const result: WorkbookDraftHead[] = [];
  for (const head of await listWorkbookDrafts(scope)) {
    if (signal?.aborted) break;
    if (head.needsRecovery !== false) { result.push(head); continue; }
    const target = { ...scope, draftId: head.draftId };
    let lease: WorkbookDraftLease | null = null;
    try {
      // Acquisition cancellation applies only to this new, exact branch lease.
      // A busy/unavailable lease never hands us another editor's release handle.
      try { lease = await acquireWorkbookDraftLease(target, signal); } catch { /* Read-only classification can still succeed. */ }
      if (signal?.aborted) break;
      const checkpoint = await readWorkbookDraft(target);
      if (!checkpoint || workbookCheckpointNeedsRecovery(checkpoint, target, source())) { result.push(head); continue; }
      // No persisted native Undo stack survives editor close. Clean live metadata
      // stays intact while its exact lease is busy; an independent tab may open.
      if (lease && !signal?.aborted) {
        try { await saveWorkbookDraft(target, null); } catch { /* Keep known-clean bytes for a later cleanup; they are not unsaved edits. */ }
      }
    } catch { result.push(head); } // Corrupt/unclassifiable data stays visible.
    finally {
      if (lease) {
        try { await lease.release(async () => {}); }
        catch {
          retireWorkbookDraft(target, lease, Promise.resolve());
          throw Error('Workbook recovery cleanup could not release its branch safely. Try reopening the workbook.');
        }
      }
    }
  }
  return result;
}
