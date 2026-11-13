import { expect, it } from 'vitest';
import { workbookEditPlanSchema, workbookSheetSourcesForPlan, workbookSourceSheetProjectionSchema } from '../src/runtime/workbook.js';

it('derives historical references in explicit code-point order without locale-dependent identity', () => {
  const ids = ['a', '_a', 'A', '0', '-a'], versionSha256 = 'a'.repeat(64);
  const plan = workbookEditPlanSchema.parse({ sourceSha256: 'b'.repeat(64), edits: [], sheets: ids.map((versionId, index) => ({ sheetId: String(index + 1), name: `Restored ${index}`, origin: 'restore', template: { versionId, versionSha256 } })) });
  expect(workbookSheetSourcesForPlan(plan)?.map(ref => ref.versionId)).toEqual(['-a', '0', 'A', '_a', 'a']);
  expect(workbookSourceSheetProjectionSchema.safeParse(plan.sheets).success).toBe(false);
  plan.sheets!.push({ sheetId: '6', name: 'Same asset', origin: 'restore', template: { versionId: 'A', versionSha256 } });
  expect(workbookSheetSourcesForPlan(plan)).toHaveLength(5);
  plan.sheets!.push({ sheetId: '7', name: 'Conflicting asset', origin: 'restore', template: { versionId: 'A', versionSha256: 'c'.repeat(64) } });
  expect(workbookEditPlanSchema.safeParse(plan).success).toBe(false);
});
