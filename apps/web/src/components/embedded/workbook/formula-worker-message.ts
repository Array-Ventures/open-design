import { z } from 'zod';
import { workbookCalculationTagSchema } from './formula-input-provenance';
const index = z.number().int().min(0).max(1_048_575);
const range = z.object({ startRow: index, endRow: index, startColumn: index.max(16_383), endColumn: index.max(16_383) });
const tree = z.object({ treeId: z.number().int(), unitId: z.string(), subUnitId: z.string(), row: index, column: index.max(16_383), formula: z.string().max(16_384), parents: z.array(z.number().int()).max(10_000) });
const base = { type: z.literal('studio:workbook-calculation-worker') };
export const workbookCalculationMessageSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('ready') }),
  z.object({ ...base, kind: z.literal('unavailable') }),
  z.object({ ...base, kind: z.literal('graph'), workbookCalculation: workbookCalculationTagSchema, result: z.array(tree).max(10_000) }),
  z.object({ ...base, kind: z.literal('complete'), outcome: z.literal('not-executed'), workbookCalculation: workbookCalculationTagSchema }),
  z.object({ ...base, kind: z.literal('arrays'), workbookCalculation: workbookCalculationTagSchema, arrayFormulaRange: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.record(z.string(), range)))).optional() }),
]);
export type WorkbookCalculationResultMessage = Extract<z.infer<typeof workbookCalculationMessageSchema>, { kind: 'graph' | 'arrays' | 'complete' }>;
