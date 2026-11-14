import { z } from 'zod';
import { workbookSheetActionDescriptorSchema } from './sheet-action-descriptor';
import { workbookRemovedSheetSchema, workbookRemovedIndexSchema, workbookRemovedSheetIssue } from './sheet-delete-context';

const common = {
  descriptor: workbookSheetActionDescriptorSchema,
  birthToken: z.string().uuid(),
  captureSourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  removedSheet: workbookRemovedSheetSchema,
  removedIndex: workbookRemovedIndexSchema,
};
/** Data in the existing birth pool, never an SDK issuer or a file template. */
export const workbookBirthRemovalSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('unsaved') }).strict(),
  z.object({ ...common, kind: z.literal('pending-target'), creation: z.object({
    operationId: z.string().uuid(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict() }).strict(),
]).superRefine((value, check) => {
  const issue = workbookRemovedSheetIssue(value.removedSheet, value.descriptor.sheetId);
  if (issue) check.addIssue({ code: 'custom', message: issue });
  if (value.descriptor.token === value.birthToken) check.addIssue({ code: 'custom', message: 'The removal cannot reuse its birth token.' });
});
export type WorkbookBirthRemoval = z.infer<typeof workbookBirthRemovalSchema>;
