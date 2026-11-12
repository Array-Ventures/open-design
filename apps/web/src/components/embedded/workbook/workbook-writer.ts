import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument, workbookEditPlanSchema } from '@open-design/contracts/runtime/workbook';
import type { z } from 'zod';
import { workbookGridEdits } from './grid-edits';

type Preview = { sourceSha256: string; model: WorkbookDocument };
type Plan = z.infer<typeof workbookEditPlanSchema>;
export interface WorkbookWriteState { dirty: boolean; saving: boolean; error: string | null }
export interface WorkbookWriteIntent { id: string; preparationId: string; previewId: string; renderId?: string; plan: Plan }
export interface WorkbookCheckpoint {
  version: 1; source: Preview; acknowledged: IWorkbookData; desired: IWorkbookData;
  pending: { intent: WorkbookWriteIntent; snapshot: IWorkbookData } | null;
}
export interface WorkbookJournal { save(checkpoint: WorkbookCheckpoint | null): Promise<void>; restored?: WorkbookCheckpoint }
/** Serializes edits against acknowledged bytes. A failed/uncertain intent keeps
 * its exact plan and identity; edits made during it are rebased only after its
 * receipt and refreshed model agree. This class never owns or remounts a grid. */
export class WorkbookWriter {
  private acknowledged: IWorkbookData;
  private desired: IWorkbookData;
  private source: Preview;
  private pending: { intent: WorkbookWriteIntent; snapshot: IWorkbookData } | null = null;
  private running: Promise<void> | null = null;
  private active = true;
  private persistence = Promise.resolve();
  private recoveryConflict = false;
  private error: string | null = null;
  constructor(source: Preview, initial: IWorkbookData,
    private write: (intent: WorkbookWriteIntent, checkpoint: () => Promise<void>) => Promise<Preview>,
    private changed: (state: WorkbookWriteState) => void,
    private accepted?: (source: Preview, snapshot: IWorkbookData) => void, private journal?: WorkbookJournal) {
    this.source = source; this.acknowledged = structuredClone(initial); this.desired = structuredClone(initial);
    if (journal?.restored) {
      const restored = structuredClone(journal.restored);
      this.source = restored.source; this.acknowledged = restored.acknowledged; this.desired = restored.desired; this.pending = restored.pending;
      if (source.sourceSha256 !== restored.source.sourceSha256) {
        this.recoveryConflict = !restored.pending;
        this.error = 'Recovered edits belong to an earlier workbook version. Keep this draft while checking the save status.';
      }
    }
  }
  private plan() { return workbookGridEdits(this.source.model, this.source.sourceSha256, this.acknowledged, this.desired); }
  state(): WorkbookWriteState {
    let dirty = Boolean(this.pending || this.running);
    try { const plan = this.plan(); dirty ||= plan.edits.length > 0 || Boolean(plan.dimensions?.length); } catch { dirty = true; }
    return { dirty, saving: this.running !== null, error: this.error };
  }
  update(snapshot: IWorkbookData) {
    if (!this.active) return;
    this.desired = structuredClone(snapshot);
    try { this.plan(); if (!this.pending && !this.recoveryConflict) this.error = null; }
    catch (error) { this.error = error instanceof Error ? error.message : 'The workbook changes could not be validated.'; }
    this.publish();
    void this.persist().catch(error => { if (this.active) { this.error = this.persistenceError(error); this.publish(); } });
  }
  checkpoint(): WorkbookCheckpoint { return structuredClone({ version: 1, source: this.source, acknowledged: this.acknowledged, desired: this.desired, pending: this.pending }); }
  recoveredSnapshot(): IWorkbookData { return structuredClone(this.desired); }
  private persistenceError(_error: unknown) { return 'This draft could not be protected on this device. Keep the workbook open and try saving again.'; }
  private async persist() {
    if (!this.journal) return;
    let dirty = Boolean(this.pending);
    try { const plan = this.plan(); dirty ||= plan.edits.length > 0 || Boolean(plan.dimensions?.length); } catch { dirty = true; }
    const checkpoint = dirty ? this.checkpoint() : null;
    const next = this.persistence.catch(() => {}).then(() => this.journal!.save(checkpoint));
    this.persistence = next;
    try { await next; }
    catch (error) { throw new Error(this.persistenceError(error)); }
  }
  flush(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.running) return this.running;
    // Defer work until running is assigned, including synchronous failures.
    this.running = Promise.resolve().then(() => this.drain()).finally(() => { this.running = null; this.publish(); });
    this.publish(); return this.running;
  }
  private async drain() {
    while (this.active) {
      try {
        if (!this.pending) {
          if (this.recoveryConflict) throw new Error('This recovered draft is based on an older workbook. Keep a copy before reloading the current file.');
          const plan = this.plan(); if (!plan.edits.length && !plan.dimensions?.length) { this.error = null; return; }
          this.pending = { intent: { id: crypto.randomUUID(), preparationId: crypto.randomUUID(), previewId: crypto.randomUUID(), plan }, snapshot: structuredClone(this.desired) };
        }
        // Persist identity before any side effect. A crash after admission can
        // then recover the same receipt instead of inventing another write.
        await this.persist(); if (!this.active) return;
        const pending = this.pending, source = await this.write(pending.intent, () => this.persist());
        if (!this.active) return;
        this.source = source; this.acknowledged = pending.snapshot; this.pending = null; this.error = null; this.recoveryConflict = false;
        await this.persist(); if (!this.active) return;
        this.accepted?.(source, structuredClone(this.acknowledged)); this.publish();
      } catch (error) {
        if (this.active) { this.error = error instanceof Error ? error.message : 'The workbook could not be saved.'; this.publish(); }
        return;
      }
    }
  }
  private publish() { if (this.active) this.changed(this.state()); }
  dispose() { this.active = false; }
}
