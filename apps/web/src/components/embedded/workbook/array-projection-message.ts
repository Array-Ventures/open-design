import { z } from 'zod';
import { workbookCalculationTagSchema } from './formula-input-provenance';
const row = z.number().int().min(0).max(1_048_575), column = z.number().int().min(0).max(16_383);
const scalar = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('number'), value: z.number().finite() }),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }),
  z.object({ kind: z.literal('string'), value: z.string().max(8 * 1024 * 1024) }),
  z.object({ kind: z.literal('error'), value: z.string().max(255) }),
  z.object({ kind: z.literal('blank'), value: z.null() }),
]);
const range = z.object({ startRow: row, endRow: row, startColumn: column, endColumn: column }).refine(r => r.startRow <= r.endRow && r.startColumn <= r.endColumn);
const owner = z.object({ sheetId: z.string().max(255), row, column, formula: z.string().max(16_384), range, provenance: z.enum(['source', 'runtime']) });
export const arrayProjectionSchema = z.object({
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), workbookCalculation: workbookCalculationTagSchema,
  owners: z.array(owner).max(4096),
  cells: z.record(z.string().max(255), z.record(z.string().regex(/^\d+$/), z.record(z.string().regex(/^\d+$/), scalar))),
  stored: z.array(z.string().max(1024)).max(10_000), unavailable: z.array(z.string().max(1024)).max(10_000),
}).superRefine((projection, ctx) => {
  let count = 0, text = 0, area = 0;
  for (const sheet of Object.values(projection.cells)) for (const [r, cells] of Object.entries(sheet)) {
    if (Number(r) > 1_048_575) ctx.addIssue({ code: 'custom', message: 'Invalid projection row.' });
    for (const [c, value] of Object.entries(cells)) { count++; if (Number(c) > 16_383) ctx.addIssue({ code: 'custom', message: 'Invalid projection column.' }); text += typeof value.value === 'string' ? value.value.length : 0; }
  }
  for (const owner of projection.owners) { area += (owner.range.endRow - owner.range.startRow + 1) * (owner.range.endColumn - owner.range.startColumn + 1); if (owner.row !== owner.range.startRow || owner.column !== owner.range.startColumn) ctx.addIssue({ code: 'custom', message: 'Invalid projection owner.' }); }
  if (count > 100_000 || area > 100_000 || text > 8 * 1024 * 1024) ctx.addIssue({ code: 'custom', message: 'Projection exceeds its aggregate budget.' });
});
export type ArrayProjection = z.infer<typeof arrayProjectionSchema>;
export const arrayProjectionMessageSchema = z.discriminatedUnion('kind', [
  z.object({ type: z.literal('studio:workbook-array-projection'), kind: z.literal('ready') }),
  z.object({ type: z.literal('studio:workbook-array-projection'), kind: z.literal('unavailable') }),
  z.object({ type: z.literal('studio:workbook-array-projection'), kind: z.literal('result'), projection: arrayProjectionSchema }),
]);
