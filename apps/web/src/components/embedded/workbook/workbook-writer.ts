import { prepareWorkbookSheetBirth, type WorkbookSheetBirthState, type WorkbookSheetBirthEntry } from './sheet-birth-context';
import { bindWorkbookSourceSnapshot, type WorkbookSourceSnapshotBinding } from './source-snapshot-binding';
import type { WorkbookDraftScope } from './workbook-draft-schema';
import { canonicalCommentJson } from '@open-design/contracts/runtime/workbook-sheet-baseline';
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
  sheetBirths?: WorkbookSheetBirthState;
  sheetActionConflict?: true;
  sourceSnapshotBinding?: WorkbookSourceSnapshotBinding;
}
export interface WorkbookJournal { scope?: WorkbookDraftScope; save(checkpoint: WorkbookCheckpoint | null): Promise<void>; validate?(checkpoint: WorkbookCheckpoint): void; isCurrent?(): boolean; restored?: WorkbookCheckpoint }
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
  private sheetBirths: WorkbookSheetBirthState | undefined;
  private sourceSnapshotBinding: WorkbookSourceSnapshotBinding | undefined;
  private sheetActionConflict = false;
  private executingProtectedCommand = false;
  private readonly sheetActionConflictMessage = 'The worksheet command needs recovery. Keep the workbook open and recover the protected pre-command draft before saving.';
  private protection: Promise<void> | null = null;
  private revision = 0;
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
      this.source = restored.source; this.acknowledged = restored.acknowledged; this.desired = restored.desired; this.pending = restored.pending; this.sourceAcknowledgement = restored.sourceAcknowledgement; this.sheetDeletions = restored.sheetDeletions ?? []; this.sheetBirths = restored.sheetBirths; this.sheetActionConflict = restored.sheetActionConflict === true; this.sourceSnapshotBinding = restored.sourceSnapshotBinding;
      if (source.sourceSha256 !== restored.source.sourceSha256) {
        this.recoveryConflict = !restored.pending;
        this.error = 'Recovered edits belong to an earlier workbook version. Keep this draft while checking the save status.';
      }
      if (this.sheetActionConflict) this.error = this.sheetActionConflictMessage;
    }
  }
  private sheetProjectionOwner() {
    return this.journal?.scope && this.sourceAcknowledgement && this.sourceSnapshotBinding
      ? { scope: this.journal.scope, acknowledgement: this.sourceAcknowledgement, binding: this.sourceSnapshotBinding } : undefined;
  }
  private plan() { return workbookGridPlan(this.source.model, this.source.sourceSha256, this.acknowledged, this.desired, { scope: this.journal?.scope, deletions: this.sheetDeletions, births: this.sheetBirths, sourceOwner: this.sheetProjectionOwner() }); }
  state(): WorkbookWriteState {
    let dirty = Boolean(this.pending || this.running || this.protection || this.sheetActionConflict);
    try { const plan = this.plan(); dirty ||= workbookPlanHasChanges(plan); } catch { dirty = true; }
    return { dirty, saving: this.running !== null || this.protection !== null, error: this.error };
  }
  update(snapshot: IWorkbookData) {
    if (!this.active || this.executingProtectedCommand) return;
    // Once a protected SDK command diverges, preserve the prior recovery branch.
    // Ordinary observer updates are not deliberate recovery/reset authority.
    if (this.sheetActionConflict) { this.error = this.sheetActionConflictMessage; this.publish(); return; }
    this.revision++; this.desired = structuredClone(snapshot);
    try { this.plan(); if (!this.pending && !this.recoveryConflict) this.error = null; }
    catch (error) { this.error = error instanceof Error ? error.message : 'The workbook changes could not be validated.'; }
    this.publish();
    void this.persist().catch(error => { if (this.active) { this.error = this.persistenceError(error); this.publish(); } });
  }
  checkpoint(): WorkbookCheckpoint { return structuredClone({ version: 1, source: this.source, acknowledged: this.acknowledged, desired: this.desired, pending: this.pending, ...(this.sourceAcknowledgement ? { sourceAcknowledgement: this.sourceAcknowledgement } : {}), ...(this.sheetDeletions.length ? { sheetDeletions: this.sheetDeletions } : {}), ...(this.sheetBirths ? { sheetBirths: this.sheetBirths } : {}), ...(this.sheetActionConflict ? { sheetActionConflict: true as const } : {}), ...(this.sourceSnapshotBinding ? { sourceSnapshotBinding: this.sourceSnapshotBinding } : {}) }); }
  /** Synchronous context-pool admission through the real draft encoder.
   * A command owner must separately validate its post-command snapshot before
   * executing. This retains data, not Delete/Undo or historical authority. */
  private prospectiveDeletionContexts(raw: WorkbookSourceDeleteContext): WorkbookSourceDeleteContext[] {
    if (!this.active || this.sheetActionConflict || this.protection || !this.journal?.validate) throw Error('Protected worksheet deletion is not ready.');
    const context = workbookSourceDeleteContextSchema.parse(raw);
    if (context.sourceSha256 !== this.source.sourceSha256) throw Error('The deletion source changed.');
    const previous = this.sheetDeletions.find(value => value.descriptor.token === context.descriptor.token);
    if (previous) { if (JSON.stringify(previous) !== JSON.stringify(context)) throw Error('The deletion context cannot be replaced.'); return this.sheetDeletions; }
    if (this.sheetDeletions.length >= 4096) throw Error('The worksheet deletion recovery limit was reached.');
    const candidate = [...this.sheetDeletions, structuredClone(context)];
    this.journal.validate({ ...this.checkpoint(), sheetDeletions: candidate });
    return candidate;
  }
  retainSheetDeletion(raw: WorkbookSourceDeleteContext): void {
    this.sheetDeletions = this.prospectiveDeletionContexts(raw);
    void this.persist().catch(error => { if (this.active) { this.error = this.persistenceError(error); this.publish(); } });
  }
  /** Current-source Delete only. The future controller supplies the exact
   * post-command snapshot, then runs the real synchronous SDK command here.
   * No remote save intent is reserved and no authority comes from metadata. */
  protectSheetDeletion(raw: WorkbookSourceDeleteContext, prospective: IWorkbookData, execute: () => IWorkbookData): Promise<void> {
    if (this.protection) return Promise.reject(Error('Worksheet protection is already pending.'));
    const run = async () => {
      if (this.sheetActionConflict) throw Error(this.sheetActionConflictMessage);
      if (this.recoveryConflict) throw Error('The recovered workbook source is not ready for worksheet actions.');
      if (!this.journal?.validate || !this.journal.isCurrent?.()) throw Error('The workbook recovery lease is no longer current.');
      const candidate = this.prospectiveDeletionContexts(raw), source = this.source, revision = this.revision, pending = this.pending;
      const snapshot = structuredClone(prospective);
      if (snapshot.sheets[raw.descriptor.sheetId] || snapshot.sheetOrder.includes(raw.descriptor.sheetId)) throw Error('The prospective worksheet deletion changed.');
      const plan = workbookGridPlan(source.model, source.sourceSha256, this.acknowledged, snapshot, { scope: this.journal?.scope, deletions: candidate, births: this.sheetBirths, sourceOwner: this.sheetProjectionOwner() });
      const checkpoint = { ...this.checkpoint(), sheetDeletions: candidate };
      this.journal.validate({ ...checkpoint, desired: snapshot });
      // Same decoder and exact byte limit as real pending storage. These local
      // identities validate the prospective shape, not a future save reservation.
      this.journal.validate({ ...checkpoint, desired: snapshot, pending: { snapshot, intent: { id: crypto.randomUUID(), preparationId: crypto.randomUUID(), previewId: crypto.randomUUID(), renderId: crypto.randomUUID(), plan } } });
      const durable = this.persistence.catch(() => {}).then(() => this.journal!.save(checkpoint));
      this.persistence = durable;
      await durable;
      if (!this.active || this.source !== source || this.revision !== revision || this.pending !== pending || !this.journal.isCurrent()) throw Error('The workbook changed while protecting its worksheet action.');
      // Old roots remain untouched on all pre-command refusals. After invoking
      // SDK, retain the durably protected candidate even if SDK itself throws.
      this.sheetDeletions = candidate;
      await this.completeProtectedSheetCommand(checkpoint, snapshot, execute);
    };
    const promise = run(); this.protection = promise; this.publish();
    void promise.finally(() => { if (this.protection === promise) this.protection = null; this.publish(); }).catch(() => {});
    return promise;
  }
  /** Development source birth owner. Pending birth/history transfer remains
   * explicitly uninstalled until its checked target association is connected. */
  protectSheetBirth(name: string, index: number, execute: (entry: WorkbookSheetBirthEntry) => IWorkbookData): Promise<WorkbookSheetBirthEntry> {
    if (this.protection) return Promise.reject(Error('Worksheet protection is already pending.'));
    const run = async () => {
      if (!this.active || this.sheetActionConflict || this.recoveryConflict) throw Error('Protected worksheet birth is not ready.');
      if (!this.journal?.scope || !this.journal.validate || !this.journal.isCurrent?.()) throw Error('The workbook recovery lease is no longer current.');
      const source = this.source, revision = this.revision, pending = this.pending;
      const prepared = prepareWorkbookSheetBirth(this.journal.scope, this.checkpoint(), name, index, this.sheetBirths);
      const checkpoint = { ...this.checkpoint(), sheetBirths: prepared.state };
      this.journal.validate(checkpoint);
      this.journal.validate({ ...checkpoint, desired: prepared.snapshot });
      const plan = workbookGridPlan(source.model, source.sourceSha256, this.acknowledged, prepared.snapshot, { scope: this.journal?.scope, deletions: this.sheetDeletions, births: prepared.state, sourceOwner: this.sheetProjectionOwner() });
      this.journal.validate({ ...checkpoint, desired: prepared.snapshot, pending: { snapshot: prepared.snapshot, intent: { id: crypto.randomUUID(), preparationId: crypto.randomUUID(), previewId: crypto.randomUUID(), plan } } });
      const durable = this.persistence.catch(() => {}).then(() => this.journal!.save(checkpoint));
      this.persistence = durable;
      await durable;
      if (!this.active || this.source !== source || this.revision !== revision || this.pending !== pending || !this.journal.isCurrent()) throw Error('The workbook changed while protecting its worksheet action.');
      this.sheetBirths = prepared.state;
      await this.completeProtectedSheetCommand(checkpoint, prepared.snapshot, () => execute(prepared.entry));
      return structuredClone(prepared.entry);
    };
    const promise = run();
    this.protection = promise.then(() => {});
    const barrier = this.protection;
    this.publish();
    void promise.finally(() => { if (this.protection === barrier) this.protection = null; this.publish(); }).catch(() => {});
    void barrier.catch(() => {});
    return promise;
  }

  private async completeProtectedSheetCommand(checkpoint: WorkbookCheckpoint, snapshot: IWorkbookData, execute: () => IWorkbookData): Promise<void> {
    let actual: IWorkbookData;
    this.executingProtectedCommand = true;
    try {
      actual = execute();
      if (canonicalCommentJson(actual) !== canonicalCommentJson(snapshot)) throw Error('The worksheet command changed its protected snapshot.');
    } catch {
      this.executingProtectedCommand = false;
      this.sheetActionConflict = true;
      this.desired = checkpoint.desired;
      this.error = this.sheetActionConflictMessage;
      // Keep the same durable pre-command branch even if quarantine storage
      // fails. Unexpected live SDK state must never become a save intent.
      try { await this.persist(); } catch { /* Keep the in-memory fence. */ }
      this.publish();
      throw Error(this.sheetActionConflictMessage);
    } finally { this.executingProtectedCommand = false; }
    this.update(actual);
  }

  recoveredSnapshot(): IWorkbookData { return structuredClone(this.desired); }
  private persistenceError(_error: unknown) { return 'This draft could not be protected on this device. Keep the workbook open and try saving again.'; }
  private async persist() {
    if (!this.journal) return;
    let dirty = Boolean(this.pending);
    try { const plan = this.plan(); dirty ||= workbookPlanHasChanges(plan); } catch { dirty = true; }
    const checkpoint = dirty || this.sheetActionConflict || this.sheetDeletions.length || this.sourceAcknowledgement?.kind === 'history' ? this.checkpoint() : null;
    const next = this.persistence.catch(() => {}).then(() => this.journal!.save(checkpoint));
    this.persistence = next;
    try { await next; }
    catch (error) { throw new Error(this.persistenceError(error)); }
  }
  flush(): Promise<void> {
    if (!this.active || this.protection) return Promise.resolve();
    if (this.sheetActionConflict) { this.error = this.sheetActionConflictMessage; this.publish(); return Promise.resolve(); }
    if (this.running) return this.running;
    // Defer work until running is assigned, including synchronous failures.
    this.running = Promise.resolve().then(() => this.drain()).finally(() => { this.running = null; this.publish(); });
    this.publish(); return this.running;
  }
  private async drain() {
    let replacedCancelledPreparation = false;
    while (this.active) {
      try {
        if (this.sheetActionConflict) throw Error(this.sheetActionConflictMessage);
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
        // A protected command never awaits this transport. Repeat if another
        // command starts during receipt storage, so no protected context can
        // cross source retirement without its original history association.
        while (true) {
          await this.protection?.catch(() => {});
          if (!this.active) return;
          if (this.pending !== pending) throw Error('The pending workbook save changed while protecting its receipt.');
          if (pending.acknowledgement && JSON.stringify(pending.acknowledgement) !== JSON.stringify(acknowledgement)) throw Error('The workbook acknowledgement changed while protecting its save.');
          const births = this.sheetBirths;
          const bound = this.sheetDeletions.map(context => context.sourceSha256 === this.source.sourceSha256 && !context.receiptAssociation
            ? associateWorkbookSourceDeletion(context, acknowledgement) : context);
          pending.acknowledgement = structuredClone(acknowledgement);
          this.sheetDeletions = bound;
          await this.persist();
          if (!this.active) return;
          if (this.sheetActionConflict) throw Error(this.sheetActionConflictMessage);
          if (!this.protection && this.sheetDeletions === bound && this.sheetBirths === births) break;
        }
        const previous = { source: this.source, acknowledged: this.acknowledged, sourceAcknowledgement: this.sourceAcknowledgement, sourceSnapshotBinding: this.sourceSnapshotBinding };
        let binding: WorkbookSourceSnapshotBinding | undefined;
        // Only the live checked transfer may establish this current continuity
        // metadata. Unsupported JSON domains remain conservative recovery.
        if (this.journal?.scope) { try { binding = bindWorkbookSourceSnapshot(this.journal.scope, source, pending.snapshot, acknowledgement); } catch { /* No clean proof. */ } }
        this.source = source; this.acknowledged = pending.snapshot; this.pending = null; this.sourceAcknowledgement = acknowledgement; this.sourceSnapshotBinding = binding;
        try { await this.persist(); }
        catch (error) {
          // A failed ownership transfer must retry the same retained receipt,
          // never derive a second write against a prematurely advanced source.
          this.source = previous.source; this.acknowledged = previous.acknowledged; this.sourceAcknowledgement = previous.sourceAcknowledgement; this.sourceSnapshotBinding = previous.sourceSnapshotBinding; this.pending = pending;
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
    await this.protection?.catch(() => {});
    await this.running?.catch(() => {});
    await this.persistence.catch(() => {});
  }
}
