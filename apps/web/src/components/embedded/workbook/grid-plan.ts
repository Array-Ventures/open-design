import { gridSourceSheetProjection } from './grid-sheet-projection';
import type { WorkbookSourceDeleteContext } from './sheet-delete-context';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { IWorkbookData } from '@univerjs/presets';
import { csvGridEdits } from './csv-grid-edits';
import { workbookGridEdits } from './grid-edits';
/** Live writing and protected-draft validation must derive identical plans.
 * CSV dimensions are view state; XLSX dimensions remain persisted edits. */
export function workbookGridPlan(model: WorkbookDocument, sha256: string, initial: IWorkbookData, current: IWorkbookData, contexts?: readonly WorkbookSourceDeleteContext[]) {
  const projection = gridSourceSheetProjection(model, sha256, initial, current, contexts ?? []);
  if (projection) return { ...workbookGridEdits(projection.model, sha256, projection.before, projection.after), sheets: projection.sheets };
  return (model.sourceFormat === 'csv' ? csvGridEdits : workbookGridEdits)(model, sha256, initial, current);
}

/** Keep dirty/journal/drain admission aligned for every supported plan owner. */
export function workbookPlanHasChanges(plan: ReturnType<typeof workbookGridPlan>): boolean {
  return Boolean(plan.edits.length || plan.dimensions?.length || plan.styles?.length || plan.visibility?.length || plan.structure?.length || plan.sheets?.length);
}
