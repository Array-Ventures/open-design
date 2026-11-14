import { z } from 'zod';

// Kept independent of workbook schemas so the edit-plan wire has no module cycle.
export const WORKBOOK_SHEET_BASELINE_VERSION = 1;
export const workbookSheetBaselineIdentitySchema = z.object({
  version: z.literal(WORKBOOK_SHEET_BASELINE_VERSION),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type WorkbookSheetBaselineIdentity = z.infer<typeof workbookSheetBaselineIdentitySchema>;
