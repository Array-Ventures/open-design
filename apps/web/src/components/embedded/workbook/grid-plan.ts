import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { IWorkbookData } from '@univerjs/presets';
import { csvGridEdits } from './csv-grid-edits';
import { workbookGridEdits } from './grid-edits';
/** Live writing and protected-draft validation must derive identical plans.
 * CSV dimensions are view state; XLSX dimensions remain persisted edits. */
export function workbookGridPlan(model: WorkbookDocument, sha256: string, initial: IWorkbookData, current: IWorkbookData) {
  return (model.sourceFormat === 'csv' ? csvGridEdits : workbookGridEdits)(model, sha256, initial, current);
}

/** Keep dirty/journal/drain admission aligned for every supported plan owner. */
export function workbookPlanHasChanges(plan: ReturnType<typeof workbookGridPlan>): boolean {
  return Boolean(plan.edits.length || plan.dimensions?.length || plan.styles?.length || plan.visibility?.length || plan.structure?.length || plan.sheets?.length);
}
