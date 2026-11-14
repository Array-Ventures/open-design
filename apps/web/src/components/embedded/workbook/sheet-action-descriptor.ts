import { z } from 'zod';
import { WORKBOOK_SHEET_ID_MAX } from '@open-design/contracts/runtime/workbook';

/** Shared data identity only. Purpose and issuance belong to the live action
 * owner/marker; a parsed descriptor never grants a native command. */
export const workbookActionSheetIdSchema = z.string().regex(/^[1-9][0-9]{0,4}$/)
  .refine(value => Number(value) <= WORKBOOK_SHEET_ID_MAX);
export const workbookSheetActionDescriptorSchema = z.object({
  version: z.literal(1), token: z.string().uuid(), generation: z.string().uuid(), sheetId: workbookActionSheetIdSchema,
}).strict();
export type WorkbookSheetActionDescriptor = z.infer<typeof workbookSheetActionDescriptorSchema>;
