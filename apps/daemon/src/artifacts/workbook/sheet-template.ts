import { createHash } from 'node:crypto';
import { workbookSheetProjectionSchema } from '@open-design/contracts/runtime/workbook';
import { readXlsxWorkbook, type ReadWorkbook } from './reader.js';
import { WorkbookFormatError } from './package.js';
import { child, children, xmlPart } from './parts.js';
import { writeWorkbookXml } from './xml.js';
import { assertWorkbookSheetResourceContinuity } from './sheet-resources.js';
import { workbookSheetFormulaByIdentity } from './sheet-formulas.js';

export interface WorkbookSheetTemplateEntry {
  sheetId: string;
  name: string;
  origin: 'source' | 'new' | 'restore';
}

/** Standalone source owner, not an accepted render field or history authorizer.
 * The future consumer must first authorize the same canonical file/version and
 * qualify the protected per-delete kernel identity. Compatible global resources
 * alone never grant lineage. Raw XML indices remain owned by their checked
 * historical prefix; the reader's compacted model styles are not transplanted.
 */
export async function prepareWorkbookSheetTemplate(current: ReadWorkbook, bytes: Buffer, expectedSha256: string, sheetId: string, target: readonly WorkbookSheetTemplateEntry[]): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || createHash('sha256').update(bytes).digest('hex') !== expectedSha256) throw new WorkbookFormatError('Historical worksheet source hash does not match.');
  // Reuse the strict final name/ID bounds without accepting restore on the wire.
  workbookSheetProjectionSchema.parse(target.map(sheet => ({ ...sheet, origin: sheet.origin === 'restore' ? 'new' : sheet.origin })));
  const selected = target.find(sheet => sheet.sheetId === sheetId);
  if (selected?.origin !== 'restore' || current.sheetParts.has(sheetId)) throw new WorkbookFormatError('Historical worksheet target identity is invalid.');
  const historical = await readXlsxWorkbook(bytes);
  assertWorkbookSheetResourceContinuity(historical, current);
  const part = historical.sheetParts.get(sheetId);
  if (!part) throw new WorkbookFormatError('Historical worksheet identity is missing.');
  // Source entries must identify current survivors; restoration of other absent
  // IDs needs its own separately checked template. New births are not historical
  // reference targets, even when a different ID reuses an old worksheet name.
  for (const sheet of target) if (sheet.origin === 'source' && !current.sheetParts.has(sheet.sheetId) || sheet.origin !== 'source' && current.sheetParts.has(sheet.sheetId)) throw new WorkbookFormatError('Historical worksheet projection identity is invalid.');
  const identities = target.filter(sheet => sheet.origin !== 'new').map(sheet => ({ id: sheet.sheetId, name: sheet.name }));
  const document = xmlPart(historical.parts, part), root = document.documentElement!;
  const views = child(root, 'sheetViews');
  for (const view of views ? children(views, 'sheetView') : []) view.removeAttribute('tabSelected');
  const data = child(root, 'sheetData');
  for (const row of data ? children(data, 'row') : []) for (const cell of children(row, 'c')) {
    const formula = child(cell, 'f'); if (!formula) continue;
    formula.textContent = workbookSheetFormulaByIdentity(formula.textContent ?? '', historical.model.sheets, identities);
    // Derived values must be calculated after the final authored edits, not
    // promoted from the old version by merely restoring its worksheet XML.
    for (const cache of [...children(cell, 'v'), ...children(cell, 'is')]) cell.removeChild(cache);
    cell.removeAttribute('t');
  }
  return writeWorkbookXml(document);
}
