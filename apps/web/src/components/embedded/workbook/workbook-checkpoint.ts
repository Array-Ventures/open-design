import { z } from 'zod';
import { workbookEditPlanSchema, workbookPreviewSchema } from '@open-design/contracts/runtime/workbook';
import type { WorkbookCheckpoint } from './workbook-writer';
import { workbookGridEdits } from './grid-edits';

export const workbookDraftScopeSchema = z.object({ viewerId: z.string().min(1).max(200), projectId: z.string().uuid(), fileName: z.string().min(1).max(500), draftId: z.string().uuid() }).strict();
export type WorkbookDraftScope = z.infer<typeof workbookDraftScopeSchema>;
const identity = z.string().min(1).max(600).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const position = z.string().regex(/^(0|[1-9][0-9]{0,6})$/);
const rowPosition = position.refine(value => Number(value) < 1_048_576), columnPosition = position.refine(value => Number(value) < 16_384);
const cell = z.object({ v: z.union([z.string().max(32767), z.number().finite(), z.boolean(), z.null()]).optional(), f: z.string().max(8192).nullable().optional() }).passthrough();
const snapshot = z.object({ id: identity, name: z.string().max(1000), appVersion: z.string().max(100), locale: z.string().min(1).max(100), sheetOrder: z.array(identity).min(1).max(64), styles: z.record(identity, z.record(z.unknown())),
  sheets: z.record(identity, z.object({ id: identity, name: z.string().min(1).max(31), rowCount: z.number().int().min(1).max(1_048_576), columnCount: z.number().int().min(1).max(16_384),
    cellData: z.record(rowPosition, z.record(columnPosition, cell.nullable())).optional() }).passthrough()),
}).passthrough();
const intent = z.object({ id: z.string().uuid(), preparationId: z.string().uuid(), previewId: z.string().uuid(), renderId: z.string().uuid().optional(), plan: workbookEditPlanSchema }).strict();
const checkpoint = z.object({ version: z.literal(1), source: workbookPreviewSchema, acknowledged: snapshot, desired: snapshot,
  pending: z.object({ intent, snapshot }).strict().nullable(),
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
  if ([state.acknowledged, state.desired, ...(state.pending ? [state.pending.snapshot] : [])].some(sheet => sheet.id !== gridId)) throw new Error('The workbook draft identity is inconsistent.');
  for (const data of [state.acknowledged, state.desired, ...(state.pending ? [state.pending.snapshot] : [])]) {
    if (new Set(data.sheetOrder).size !== data.sheetOrder.length || JSON.stringify([...data.sheetOrder].sort()) !== JSON.stringify(Object.keys(data.sheets).sort())) throw new Error('The workbook draft sheet structure is inconsistent.');
    for (const [id, sheet] of Object.entries(data.sheets)) {
      if (sheet.id !== id) throw new Error('The workbook draft sheet identity is inconsistent.');
      for (const [row, cells] of Object.entries(sheet.cellData ?? {})) for (const column of Object.keys(cells)) if (Number(row) >= sheet.rowCount! || Number(column) >= sheet.columnCount!) throw new Error('The workbook draft contains out-of-bounds cells.');
    }
  }
  const sheetIds = state.source.model.sheets.map(sheet => sheet.id);
  if (JSON.stringify(state.acknowledged.sheetOrder) !== JSON.stringify(sheetIds)) throw new Error('The workbook draft baseline is inconsistent.');
  if (state.pending) {
    const derived = workbookGridEdits(state.source.model, state.source.sourceSha256, state.acknowledged, state.pending.snapshot);
    if (JSON.stringify(derived) !== JSON.stringify(state.pending.intent.plan)) throw new Error('The pending workbook save does not match its protected snapshot.');
  }
  return state;
}
export function encodeWorkbookDraft(scope: WorkbookDraftScope, checkpoint: WorkbookCheckpoint) {
  const value = { version: 1, scope, checkpoint, updatedAt: Date.now() };
  decodeWorkbookDraft(value, scope); return value;
}
