import { z } from 'zod';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const workbookRestoreIntentSchema = z.object({
  version: z.literal(1), viewerId: z.string().min(1).max(200), projectId: z.string().uuid(), fileName: z.string().min(1).max(500),
  operationId: z.string().uuid(), preparationId: z.string().uuid(), versionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), versionNumber: z.number().int().positive().optional(),
  versionSha256: digest, sourceSha256: digest, renderId: z.string().uuid().optional(),
}).strict();
export type WorkbookRestoreIntent = z.infer<typeof workbookRestoreIntentSchema>;
export type WorkbookRestoreScope = Pick<WorkbookRestoreIntent, 'viewerId' | 'projectId' | 'fileName'>;
