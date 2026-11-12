import { workbookDraftArtifactKey, workbookDraftKey, type WorkbookDraftScope } from './workbook-checkpoint';
import type { WorkbookDraftLease } from './draft-lease';

type ArtifactScope = Omit<WorkbookDraftScope, 'draftId'>;
interface Retirement {
  lease: WorkbookDraftLease;
  artifact: string;
  attempt?: Promise<void>;
  retry(): Promise<void>;
}
// Module lifetime survives React unmount/remount. Keep each exact ownership
// handle until release succeeds; a failed drain never grants new edit authority.
const retired = new Map<string, Set<Retirement>>();
const recoveryError = () => new Error('The previous workbook draft could not be released safely. Keep a recovery copy and reload this tab before reopening the workbook.');

/** The caller must synchronously detach its exact writer before supplying its
 * drain promise. This helper owns rejection handling and retained lease retry. */
export function retireWorkbookDraft(scope: WorkbookDraftScope, lease: WorkbookDraftLease, drained: Promise<void>): void {
  const key = workbookDraftKey(scope), artifact = workbookDraftArtifactKey(scope);
  const entries = retired.get(key) ?? new Set<Retirement>();
  if (!retired.has(key)) retired.set(key, entries);
  // Observe the supplied promise immediately, including an already failed drain.
  void drained.catch(() => {});
  if ([...entries].some(entry => entry.lease === lease)) return;
  const entry: Retirement = { lease, artifact, retry() {
    if (!entry.attempt) {
      const attempt = Promise.resolve().then(() => lease.release(() => drained)).then(() => {
        entries.delete(entry);
        if (!entries.size && retired.get(key) === entries) retired.delete(key);
      }).catch(() => {
        if (entry.attempt === attempt) entry.attempt = undefined;
        throw recoveryError();
      });
      entry.attempt = attempt;
      // Retirement starts from effect cleanup, where nobody can await it yet.
      void attempt.catch(() => {});
    }
    return entry.attempt;
  } };
  entries.add(entry);
  void entry.retry();
}

/** Block same-artifact reopening until every old journal and lease retires.
 * Retrying a rejected release reuses the original drain; a genuinely failed
 * drain remains failed and requires an explicit keep-copy/reload decision. */
export async function awaitRetiredWorkbookDrafts(scope: ArtifactScope): Promise<void> {
  const artifact = workbookDraftArtifactKey(scope);
  while (true) {
    const pending = [...retired.values()].flatMap(entries => [...entries]).filter(entry => entry.artifact === artifact);
    if (!pending.length) return;
    await Promise.all(pending.map(entry => entry.retry()));
  }
}
