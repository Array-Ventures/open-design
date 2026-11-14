import { z } from 'zod';
export const workbookDraftScopeSchema = z.object({ viewerId: z.string().min(1).max(200), projectId: z.string().uuid(), fileName: z.string().min(1).max(500), draftId: z.string().uuid() }).strict();
export type WorkbookDraftScope = z.infer<typeof workbookDraftScopeSchema>;
/** Shared bounded SDK snapshot shape; semantic source/plan ownership is checked
 * separately by its checkpoint or descriptor consumer. */
const identity = z.string().min(1).max(600).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const position = z.string().regex(/^(0|[1-9][0-9]{0,6})$/);
const rowPosition = position.refine(value => Number(value) < 1_048_576), columnPosition = position.refine(value => Number(value) < 16_384);
const cell = z.object({ v: z.union([z.string().max(32767), z.number().finite(), z.boolean(), z.null()]).optional(), f: z.string().max(8192).nullable().optional() }).passthrough();
export const workbookGridSnapshotSchema = z.object({ id: identity, name: z.string().max(1000), appVersion: z.string().max(100), locale: z.string().min(1).max(100), sheetOrder: z.array(identity).min(1).max(64), styles: z.record(identity, z.record(z.unknown())),
  sheets: z.record(identity, z.object({ id: identity, name: z.string().min(1).max(31), rowCount: z.number().int().min(1).max(1_048_576), columnCount: z.number().int().min(1).max(16_384),
    cellData: z.record(rowPosition, z.record(columnPosition, cell.nullable())).optional() }).passthrough()),
}).passthrough();
