import { matchesWorkbookSourceSnapshot, workbookSourceSnapshotBindingSchema } from './source-snapshot-binding';
import { workbookSourceDeleteContextSchema } from './sheet-delete-context';
import { workbookGridSnapshotSchema, workbookDraftScopeSchema, type WorkbookDraftScope } from './workbook-draft-schema';
export { workbookDraftScopeSchema, type WorkbookDraftScope } from './workbook-draft-schema';
import { workbookSaveAcknowledgementSchema } from './save-provenance';
import { z } from 'zod';
import { workbookEditPlanSchema, workbookPreviewSchema } from '@open-design/contracts/runtime/workbook';
import type { WorkbookCheckpoint } from './workbook-writer';
import { workbookGridPlan, workbookPlanHasChanges } from './grid-plan';

const snapshot = workbookGridSnapshotSchema;
const intent = z.object({ id: z.string().uuid(), preparationId: z.string().uuid(), previewId: z.string().uuid(), renderId: z.string().uuid().optional(), plan: workbookEditPlanSchema }).strict();
const checkpoint = z.object({ version: z.literal(1), source: workbookPreviewSchema, acknowledged: snapshot, desired: snapshot,
  pending: z.object({ intent, snapshot, acknowledgement: workbookSaveAcknowledgementSchema.optional() }).strict().nullable(),
  sourceAcknowledgement: workbookSaveAcknowledgementSchema.optional(),
  sheetDeletions: z.array(workbookSourceDeleteContextSchema).max(4096).optional(),
  sheetActionConflict: z.literal(true).optional(),
  sourceSnapshotBinding: workbookSourceSnapshotBindingSchema.optional(),
}).strict();
const record = z.object({ version: z.literal(1), scope: workbookDraftScopeSchema, checkpoint, updatedAt: z.number().int().nonnegative() }).strict();
export function workbookDraftArtifactKey(scope: Omit<WorkbookDraftScope, 'draftId'>): string {
  const checked = workbookDraftScopeSchema.omit({ draftId: true }).parse({ viewerId: scope.viewerId, projectId: scope.projectId, fileName: scope.fileName }); return JSON.stringify([checked.viewerId, checked.projectId, checked.fileName]);
}
export function workbookDraftKey(scope: WorkbookDraftScope): string {
  const checked = workbookDraftScopeSchema.parse(scope); return JSON.stringify([checked.viewerId, checked.projectId, checked.fileName, checked.draftId]);
}
export function decodeWorkbookDraft(value: unknown, scope: WorkbookDraftScope): WorkbookCheckpoint {
  const parsed = record.parse(value), expected = workbookDraftKey(scope);
  if (workbookDraftKey(parsed.scope) !== expected) throw new Error('This workbook draft belongs to another account or artifact.');
  // Univer snapshots contain extensible presentation fields. The bounded
  // structure is validated here; only a derived typed edit plan reaches OOXML.
  const state = parsed.checkpoint as unknown as WorkbookCheckpoint, gridId = `${scope.projectId}:${scope.fileName}`;
  if (/\.csv$/i.test(scope.fileName) !== (state.source.model.sourceFormat === 'csv')) throw new Error('The workbook draft source format is inconsistent.');
  if ([state.acknowledged, state.desired, ...(state.pending ? [state.pending.snapshot] : [])].some(sheet => sheet.id !== gridId)) throw new Error('The workbook draft identity is inconsistent.');
  for (const data of [state.acknowledged, state.desired, ...(state.pending ? [state.pending.snapshot] : [])]) {
    if (new Set(data.sheetOrder).size !== data.sheetOrder.length || JSON.stringify([...data.sheetOrder].sort()) !== JSON.stringify(Object.keys(data.sheets).sort())) throw new Error('The workbook draft sheet structure is inconsistent.');
    for (const [id, sheet] of Object.entries(data.sheets)) {
      if (sheet.id !== id) throw new Error('The workbook draft sheet identity is inconsistent.');
      for (const [row, cells] of Object.entries(sheet.cellData ?? {})) for (const column of Object.keys(cells)) if (Number(row) >= sheet.rowCount! || Number(column) >= sheet.columnCount!) throw new Error('The workbook draft contains out-of-bounds cells.');
    }
  }
  const tokens = new Set<string>();
  for (const context of state.sheetDeletions ?? []) {
    if (tokens.has(context.descriptor.token) || context.scope.viewerId !== scope.viewerId || context.scope.projectId !== scope.projectId || context.scope.fileName !== scope.fileName) throw Error('The protected deletion context scope or identity changed.');
    tokens.add(context.descriptor.token);
  }
  const sheetIds = state.source.model.sheets.map(sheet => sheet.id);
  if (JSON.stringify(state.acknowledged.sheetOrder) !== JSON.stringify(sheetIds)) throw new Error('The workbook draft baseline is inconsistent.');
  for (const [acknowledgement, pending] of [[state.sourceAcknowledgement, null], [state.pending?.acknowledgement, state.pending]] as const) {
    if (acknowledgement?.kind !== 'history') continue;
    const proof = acknowledgement.provenance;
    if (proof.projectId !== scope.projectId || proof.fileName !== scope.fileName || (pending
      ? proof.operationId !== pending.intent.id || proof.renderId !== pending.intent.renderId || proof.sourceSha256 !== state.source.sourceSha256
      : proof.targetSha256 !== state.source.sourceSha256)) throw Error('The protected workbook acknowledgement identity is inconsistent.');
  }
  if (state.pending) {
    const derived = workbookGridPlan(state.source.model, state.source.sourceSha256, state.acknowledged, state.pending.snapshot, state.sheetDeletions, state.sourceAcknowledgement && state.sourceSnapshotBinding ? { scope, acknowledgement: state.sourceAcknowledgement, binding: state.sourceSnapshotBinding } : undefined);
    if (JSON.stringify(derived) !== JSON.stringify(state.pending.intent.plan)) throw new Error('The pending workbook save does not match its protected snapshot.');
  }
  if (state.sourceSnapshotBinding && !matchesWorkbookSourceSnapshot(state, scope, state.source)) throw Error('The protected source snapshot binding is inconsistent.');
  return state;
}
export function encodeWorkbookDraft(scope: WorkbookDraftScope, checkpoint: WorkbookCheckpoint) {
  const value = { version: 1, scope, checkpoint, updatedAt: Date.now() };
  decodeWorkbookDraft(value, scope); return value;
}

/** Recovery means unsaved/uncertain ownership, not merely live history metadata.
 * Unsupported desired state stays recoverable rather than being discarded. */
export function workbookCheckpointNeedsRecovery(state: WorkbookCheckpoint, scope: WorkbookDraftScope, fresh: WorkbookCheckpoint['source'] | null | undefined): boolean {
  if (state.pending || state.sheetActionConflict) return true;
  try { return workbookPlanHasChanges(workbookGridPlan(state.source.model, state.source.sourceSha256, state.acknowledged, state.desired, state.sheetDeletions, state.sourceAcknowledgement && state.sourceSnapshotBinding ? { scope, acknowledgement: state.sourceAcknowledgement, binding: state.sourceSnapshotBinding } : undefined)) || !matchesWorkbookSourceSnapshot(state, scope, fresh); }
  catch { return true; }
}
