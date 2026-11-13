import type { WorkbookCellEdit, WorkbookDimensionEdit, WorkbookStructureEdit, WorkbookStyleEdit, WorkbookVisibilityEdit } from '@open-design/contracts/runtime/workbook';
import { readXlsxWorkbook, type ReadWorkbook } from './reader.js';
import { WorkbookFormatError, WORKBOOK_PACKAGE_LIMITS, writeWorkbookPackage } from './package.js';
import { patchWorkbookSheets } from './sheet-patch.js';
import { prepareWorkbookSheetTemplate, type WorkbookSheetTemplateEntry } from './sheet-template.js';
import { calculatePreparedWorkbookSheetEdits } from './calculated-patch.js';

export interface WorkbookSheetTemplateSource { sheetId: string; sourceSha256: string; bytes: Buffer }

/** Source assembly owner reached by the checked frozen-asset render consumer.
 * The host authorizes explicit same-file historical template requests. This is
 * not automatic SDK Undo or proof of a prior Delete; that future producer needs
 * protected per-delete ownership. Every restored ID must have exactly one
 * checked template before historical formulas enter final calculation.
 */
export async function calculateWorkbookRestoredSheetEdits(source: ReadWorkbook, target: readonly WorkbookSheetTemplateEntry[], templates: readonly WorkbookSheetTemplateSource[], edits: readonly WorkbookCellEdit[] = [], dimensions: readonly WorkbookDimensionEdit[] = [], styles: readonly WorkbookStyleEdit[] = [], visibility: readonly WorkbookVisibilityEdit[] = [], structure: readonly WorkbookStructureEdit[] = []) {
  const restored = new Set(target.filter(sheet => sheet.origin === 'restore').map(sheet => sheet.sheetId));
  if (!restored.size || templates.length !== restored.size || templates.length > 64) throw new WorkbookFormatError('Historical worksheet template ownership is incomplete.');
  const admitted = new Set<string>(), assets = new Map<string, Buffer>(); let total = 0;
  for (const template of templates) {
    if (!restored.has(template.sheetId) || admitted.has(template.sheetId)) throw new WorkbookFormatError('Historical worksheet template ownership is ambiguous.');
    admitted.add(template.sheetId);
    const prior = assets.get(template.sourceSha256);
    if (prior && !prior.equals(template.bytes)) throw new WorkbookFormatError('Historical worksheet asset digest has inconsistent bytes.');
    if (!prior) { assets.set(template.sourceSha256, template.bytes); total += template.bytes.length; }
    if (!Number.isSafeInteger(total) || total > WORKBOOK_PACKAGE_LIMITS.archiveBytes) throw new WorkbookFormatError('Historical worksheet templates exceed their aggregate limit.', 'WORKBOOK_LIMIT');
  }
  const prepared = new Map<string, Buffer>();
  for (const template of templates) prepared.set(template.sheetId, await prepareWorkbookSheetTemplate(source, template.bytes, template.sourceSha256, template.sheetId, target));
  // Membership/rels/content-types/visible selection retain the existing strict
  // owner. Restored IDs are absent births only for that package assembly step;
  // their content comes exclusively from the checked raw worksheet templates.
  const staged = await readXlsxWorkbook(await patchWorkbookSheets(source, target.map(sheet => ({ sheetId: sheet.sheetId, name: sheet.name, origin: sheet.origin === 'restore' ? 'new' : sheet.origin })), visibility));
  const parts = new Map(staged.parts);
  for (const [id, xml] of prepared) {
    const part = staged.sheetParts.get(id);
    if (!part) throw new WorkbookFormatError('Restored worksheet relationship identity is unavailable.');
    parts.set(part, xml);
  }
  const assembled = await readXlsxWorkbook(await writeWorkbookPackage(parts));
  return calculatePreparedWorkbookSheetEdits(assembled, edits, dimensions, styles, structure);
}
