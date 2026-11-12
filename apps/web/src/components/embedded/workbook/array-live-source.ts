import type { IWorkbookData } from '@univerjs/core';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { sourceArrayInteractiveSnapshot } from './source-array-engine-data';
import { assertWorkbookCalculationBudget } from './formula-worker-budget';

/** Source proof comes from the SHA-verified daemon preview. This only selects
 * a disposable display capability; the server revalidates all save ownership. */
export function prepareWorkbookArrayLiveSource(model: WorkbookDocument, original: IWorkbookData, sourceSha256: string | undefined, restored?: IWorkbookData): IWorkbookData | undefined {
  if (model.sourceFormat === 'csv' || model.calculationMetadata !== 'verified' || !/^[a-f0-9]{64}$/.test(sourceSha256 ?? '') || model.definedNames?.length || model.tables?.length || !model.sheets.some(sheet => sheet.arrayFormulas?.length) || model.sheets.some(sheet => sheet.arrayFormulas === undefined || sheet.arrayFormulas.some(owner => owner.kind !== 'array' || owner.calculation !== 'fixed' && owner.calculation !== 'dynamic'))) return;
  const candidate = sourceArrayInteractiveSnapshot(model, original);
  if (candidate.state !== 'known') return;
  try {
    assertWorkbookCalculationBudget([restored ?? original], true);
    // Legacy recovery can contain cache followers as raw literals. It has no
    // proof for migrating those cells; preserve that exact draft in stored mode.
    if (restored && model.sheets.some(sheet => sheet.arrayFormulas!.some(owner => {
      if (restored.sheets[sheet.id]?.cellData?.[owner.row]?.[owner.column]?.f !== original.sheets[sheet.id]?.cellData?.[owner.row]?.[owner.column]?.f) return false;
      for (let row = owner.range.startRow; row <= owner.range.endRow; row++) for (let column = owner.range.startColumn; column <= owner.range.endColumn; column++) {
        if (row === owner.row && column === owner.column) continue;
        const cell = restored.sheets[sheet.id]?.cellData?.[row]?.[column];
        if (cell && (cell.v != null || cell.p || cell.f)) return true;
      }
      return false;
    }))) return;
    return candidate.interactiveSnapshot;
  } catch { return; }
}
