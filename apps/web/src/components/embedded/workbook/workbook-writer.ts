import { associateWorkbookSourceDeletion, workbookSourceDeleteContextSchema, type WorkbookSourceDeleteContext } from './sheet-delete-context';
import { workbookSaveAcknowledgementSchema, type WorkbookSaveAcknowledgement } from './save-provenance';
import { workbookGridPlan, workbookPlanHasChanges } from './grid-plan';
import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument, workbookEditPlanSchema } from '@open-design/contracts/runtime/workbook';
import type { z } from 'zod';
import { isWorkbookSaveRejection, WorkbookSaveTerminalError, WorkbookSavePreparationCancelledError } from './save-terminal';

type Preview = { sourceSha256: string; model: WorkbookDocument };
export interface WorkbookWriteResult { preview: Preview; acknowledgement: WorkbookSaveAcknowledgement }
type Plan = z.infer<typeof workbookEditPlanSchema>;
export interface WorkbookWriteState { dirty: boolean; saving: boolean; error: string | null }
export interface WorkbookWriteIntent { id: string; preparationId: string; previewId: string; renderId?: string; plan: Plan }
export interface WorkbookCheckpoint {
  version: 1; source: Preview; acknowledged: IWorkbookData; desired: IWorkbookData;
  pending: { intent: WorkbookWriteIntent; snapshot: IWorkbookData; acknowledgement?: WorkbookSaveAcknowledgement } | null;
  sourceAcknowledgement?: WorkbookSaveAcknowledgement;
  sheetDeletions?: WorkbookSourceDeleteContext[];
}
export interface WorkbookJournal { save(checkpoint: WorkbookCheckpoint | null): Promise<void>; validate?(checkpoint: WorkbookCheckpoint): void; restored?: WorkbookCheckpoint }
/** Serializes edits against acknowledged bytes. A failed/uncertain intent keeps
 * its exact plan and identity; edits made during it are rebased only after its
 * receipt and refreshed model agree. This class never owns or remounts a grid. */
export class WorkbookWriter {
  private acknowledged: IWorkbookData;
  private desired: IWorkbookData;
  private source: Preview;
  private pending: WorkbookCheckpoint['pending'] = null;
  private sourceAcknowledgement: WorkbookSaveAcknowledgement | undefined;
  private sheetDeletions: WorkbookSourceDeleteContext[] = [];
  private running: Promise<void> | null = null;
  private active = true;
  private persistence = Promise.resolve();
  private recoveryConflict = false;
  private error: string | null = null;
  constructor(source: Preview, initial: IWorkbookData,
    private write: (intent: WorkbookWriteIntent, checkpoint: () => Promise<void>) => Promise<WorkbookWriteResult>,
    private changed: (state: WorkbookWriteState) => void,
    private accepted?: (source: Preview, snapshot: IWorkbookData, acknowledgement: WorkbookSaveAcknowledgement) => void, private journal?: WorkbookJournal) {
    this.source = source; this.acknowledged = structuredClone(initial); this.desired = structuredClone(initial);
    if (journal?.restored) {
      const restored = structuredClone(journal.restored);
      this.source = restored.source; this.acknowledged = restored.acknowledged; this.desired = restored.desired; this.pending = restored.pending; this.sourceAcknowledgement = restored.sourceAcknowledgement; this.sheetDeletions = restored.sheetDeletions ?? [];
      if (source.sourceSha256 !== restored.source.sourceSha256) {
        this.recoveryConflict = !restored.pending;
        this.error = 'Recovered edits belong to an earlier workbook version. Keep this draft while checking the save status.';
      }
    }
  }
  private plan() { return workbookGridPlan(this.source.model, this.source.sourceSha256, this.acknowledged, this.desired, this.sheetDeletions); }
  state(): WorkbookWriteState {
    let dirty = Boolean(this.pending || this.running);
    try { const plan = this.plan(); dirty ||= workbookPlanHasChanges(plan); } catch { dirty = true; }
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
  checkpoint(): WorkbookCheckpoint { return structuredClone({ version: 1, source: this.source, acknowledged: this.acknowledged, desired: this.desired, pending: this.pending, ...(this.sourceAcknowledgement ? { sourceAcknowledgement: this.sourceAcknowledgement } : {}), ...(this.sheetDeletions.length ? { sheetDeletions: this.sheetDeletions } : {}) }); }
  /** Synchronous context-pool admission through the real draft encoder.
   * A command owner must separately validate its post-command snapshot before
   * executing. This retains data, not Delete/Undo or historical authority. */
  retainSheetDeletion(raw: WorkbookSourceDeleteContext): void {
    if (!this.active || this.pending || this.running || !this.journal?.validate) throw Error('Protected worksheet deletion is not ready.');
    const context = workbookSourceDeleteContextSchema.parse(raw);
    if (context.sourceSha256 !== this.source.sourceSha256) throw Error('The deletion source changed.');
    const previous = this.sheetDeletions.find(value => value.descriptor.token === context.descriptor.token);
    if (previous) { if (JSON.stringify(previous) !== JSON.stringify(context)) throw Error('The deletion context cannot be replaced.'); return; }
    if (this.sheetDeletions.length >= 4096) throw Error('The worksheet deletion recovery limit was reached.');
    const candidate = [...this.sheetDeletions, structuredClone(context)];
    this.journal.validate({ ...this.checkpoint(), sheetDeletions: candidate });
    this.sheetDeletions = candidate;
    void this.persist().catch(error => { if (this.active) { this.error = this.persistenceError(error); this.publish(); } });
  }
  recoveredSnapshot(): IWorkbookData { return structuredClone(this.desired); }
  private persistenceError(_error: unknown) { return 'This draft could not be protected on this device. Keep the workbook open and try saving again.'; }
  private async persist() {
    if (!this.journal) return;
    let dirty = Boolean(this.pending);
    try { const plan = this.plan(); dirty ||= workbookPlanHasChanges(plan); } catch { dirty = true; }
    const checkpoint = dirty || this.sheetDeletions.length || this.sourceAcknowledgement?.kind === 'history' ? this.checkpoint() : null;
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
    let replacedCancelledPreparation = false;
    while (this.active) {
      try {
        if (!this.pending) {
          if (this.recoveryConflict) throw new Error('This recovered draft is based on an older workbook. Keep a copy before reloading the current file.');
          const plan = this.plan(); if (!workbookPlanHasChanges(plan)) { this.error = null; return; }
          this.pending = { intent: { id: crypto.randomUUID(), preparationId: crypto.randomUUID(), previewId: crypto.randomUUID(), plan }, snapshot: structuredClone(this.desired) };
        }
        // Persist identity before any side effect. A crash after admission can
        // then recover the same receipt instead of inventing another write.
        await this.persist(); if (!this.active) return;
        const pending = this.pending, written = await this.write(pending.intent, () => this.persist());
        if (!this.active) return;
        const source = written.preview;
        const acknowledgement = workbookSaveAcknowledgementSchema.parse(written.acknowledgement);
        if (acknowledgement.kind === 'history') {
          const proof = acknowledgement.provenance;
          if (proof.operationId !== pending.intent.id || proof.renderId !== pending.intent.renderId || proof.sourceSha256 !== this.source.sourceSha256 || proof.targetSha256 !== source.sourceSha256) throw Error('The workbook acknowledgement does not match its owned save.');
        }
        if (pending.acknowledgement && JSON.stringify(pending.acknowledgement) !== JSON.stringify(acknowledgement)) throw Error('The workbook acknowledgement changed while protecting its save.');
        // Protect the checked pre-save history association together with the
        // original intent before retiring any source or SDK baseline.
        const bound = this.sheetDeletions.map(context => context.sourceSha256 === this.source.sourceSha256 && !pending.snapshot.sheets[context.descriptor.sheetId]
          ? associateWorkbookSourceDeletion(context, acknowledgement) : context);
        pending.acknowledgement = structuredClone(acknowledgement);
        this.sheetDeletions = bound;
        await this.persist(); if (!this.active) return;
        const previous = { source: this.source, acknowledged: this.acknowledged, sourceAcknowledgement: this.sourceAcknowledgement };
        this.source = source; this.acknowledged = pending.snapshot; this.pending = null; this.sourceAcknowledgement = acknowledgement;
        try { await this.persist(); }
        catch (error) {
          // A failed ownership transfer must retry the same retained receipt,
          // never derive a second write against a prematurely advanced source.
          this.source = previous.source; this.acknowledged = previous.acknowledged; this.sourceAcknowledgement = previous.sourceAcknowledgement; this.pending = pending;
          throw error;
        }
        if (!this.active) return;
        this.error = null; this.recoveryConflict = false;
        this.accepted?.(source, structuredClone(this.acknowledged), structuredClone(acknowledgement)); this.publish();
      } catch (error) {
        if (this.active && this.pending && isWorkbookSaveRejection(error, this.pending.intent)) {
          // Only a checked receipt or permanent candidate-removal fence rules
          // out a later write.
          // Generic transport errors retain the pending identity for recovery.
          this.pending = null; this.recoveryConflict ||= error instanceof WorkbookSaveTerminalError && error.state === 'conflict';
          try {
            await this.persist();
            // One explicit Save may finish reconciliation and its replacement.
            // This branded, identity-checked proof fences late admission; a
            // transport failure or conflict never authorizes a new operation.
            if (this.active && error instanceof WorkbookSavePreparationCancelledError && !replacedCancelledPreparation) {
              replacedCancelledPreparation = true; this.error = null; continue;
            }
          } catch (failure) { error = new Error(this.persistenceError(failure)); }
        }
        if (this.active) { this.error = error instanceof Error ? error.message : 'The workbook could not be saved.'; this.publish(); }
        return;
      }
    }
  }
  private publish() { if (this.active) this.changed(this.state()); }
  dispose() { this.active = false; }
  /** Abort the transport first. Ownership may be released only after every
   * possible checkpoint callback and queued transaction has settled. */
  async close(): Promise<void> {
    this.dispose();
    await this.running?.catch(() => {});
    await this.persistence.catch(() => {});
  }
}
