import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { IWorkbookData } from '@univerjs/presets';
import { workbookGridEdits, WorkbookEditError } from './grid-edits';
/** Row/column sizing is a view preference for CSV. It must not become a lossy
 * formatting save, nor block a genuine literal cell edit in the same draft. */
export function csvGridEdits(model: WorkbookDocument, sha256: string, initial: IWorkbookData, current: IWorkbookData): ReturnType<typeof workbookGridEdits> {
  const { dimensions: _view, ...plan } = workbookGridEdits(model, sha256, initial, current);
  if (plan.styles?.length || plan.edits.some(edit => edit.cell.formula || edit.cell.kind !== 'string' && edit.cell.kind !== 'blank' || edit.cell.kind === 'string' && edit.cell.runs)) throw new WorkbookEditError('CSV stores literal text only. Formulas and formatting cannot be saved.');
  return plan;
}
