import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument, workbookEditPlanSchema } from '@open-design/contracts/runtime/workbook';
import type { z } from 'zod';
import { workbookGridEdits } from './grid-edits';

type Preview = { sourceSha256: string; model: WorkbookDocument };
type Plan = z.infer<typeof workbookEditPlanSchema>;
export interface WorkbookWriteState { dirty: boolean; saving: boolean; error: string | null }
export interface WorkbookWriteIntent { id: string; plan: Plan }
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
  private error: string | null = null;
  constructor(source: Preview, initial: IWorkbookData,
    private write: (intent: WorkbookWriteIntent) => Promise<Preview>,
    private changed: (state: WorkbookWriteState) => void,
    private accepted?: (source: Preview, snapshot: IWorkbookData) => void) {
    this.source = source; this.acknowledged = structuredClone(initial); this.desired = structuredClone(initial);
  }
  private plan() { return workbookGridEdits(this.source.model, this.source.sourceSha256, this.acknowledged, this.desired); }
  state(): WorkbookWriteState {
    let dirty = Boolean(this.pending || this.running);
    try { dirty ||= this.plan().edits.length > 0; } catch { dirty = true; }
    return { dirty, saving: this.running !== null, error: this.error };
  }
  update(snapshot: IWorkbookData) {
    if (!this.active) return;
    this.desired = structuredClone(snapshot);
    try { this.plan(); if (!this.pending) this.error = null; }
    catch (error) { this.error = error instanceof Error ? error.message : 'The workbook changes could not be validated.'; }
    this.publish();
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
          const plan = this.plan(); if (!plan.edits.length) { this.error = null; return; }
          this.pending = { intent: { id: crypto.randomUUID(), plan }, snapshot: structuredClone(this.desired) };
        }
        const pending = this.pending, source = await this.write(pending.intent);
        if (!this.active) return;
        this.source = source; this.acknowledged = pending.snapshot; this.pending = null; this.error = null;
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
