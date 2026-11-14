import { createHash } from 'node:crypto';
import { canonicalWorkbookSheetBaseline, workbookSheetBaseline, workbookSheetBaselineIdentitySchema, type WorkbookSheetBaselineIdentity } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { workbookSourceSheetProjectionSchema } from '@open-design/contracts/runtime/workbook';
import { readXlsxWorkbook, type ReadWorkbook } from './reader.js';
import { WorkbookFormatError } from './package.js';
import { child, children, xmlPart } from './parts.js';
import { writeWorkbookXml } from './xml.js';
import { workbookCellStyleSource, type WorkbookCellStyleSource } from './cell-style-guard.js';
import { workbookSheetFormulaByIdentity } from './sheet-formulas.js';

export interface WorkbookSheetTemplateEntry {
  sheetId: string;
  name: string;
  origin: 'source' | 'new' | 'restore';
  baselineIdentity?: WorkbookSheetBaselineIdentity | undefined;
}

/** Raw XML owner called by the declared frozen-asset assembler. The host
 * authorizes the selected same-file historical version; this helper checks its
 * bytes/resources/worksheet identity. An explicit authorized template request
 * is not proof of an SDK Delete command. A future automatic Undo producer must
 * separately qualify protected per-delete kernel identity; compatible resources
 * alone never grant lineage. Raw XML indices retain their historical prefix,
 * never the reader's compacted model style indices.
 */
export async function prepareWorkbookSheetTemplate(current: ReadWorkbook, bytes: Buffer, expectedSha256: string, sheetId: string, target: readonly WorkbookSheetTemplateEntry[]): Promise<Buffer> {
  return (await prepareWorkbookSheetTemplateSource(current, bytes, expectedSha256, sheetId, target)).xml;
}

/** The assembler retains this already-checked reader as the original cell/style
 * guard owner; its compact ordinals are never written into the target XML. */
export async function prepareWorkbookSheetTemplateSource(current: ReadWorkbook, bytes: Buffer, expectedSha256: string, sheetId: string, target: readonly WorkbookSheetTemplateEntry[]): Promise<{ xml: Buffer; styleSource: WorkbookCellStyleSource }> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || createHash('sha256').update(bytes).digest('hex') !== expectedSha256) throw new WorkbookFormatError('Historical worksheet source hash does not match.');
  // Reuse ordinary projection name/ID bounds; the assembler owns template refs.
  workbookSourceSheetProjectionSchema.parse(target.map(sheet => ({ sheetId: sheet.sheetId, name: sheet.name, origin: sheet.origin === 'restore' ? 'new' : sheet.origin })));
  const selected = target.find(sheet => sheet.sheetId === sheetId);
  if (selected?.origin !== 'restore' || current.sheetParts.has(sheetId)) throw new WorkbookFormatError('Historical worksheet target identity is invalid.');
  const historical = await readXlsxWorkbook(bytes);
  if (selected.baselineIdentity !== undefined) {
    // A client claim is only consistency data. Extract from the fully validated
    // historical reader, including actual referenced style definitions, before
    // assembling XML or applying any authored deltas. Asset SHA/ACL checks stay
    // independent and optional legacy manual requests retain their semantics.
    const identity = workbookSheetBaselineIdentitySchema.parse(selected.baselineIdentity);
    const actual = createHash('sha256').update(canonicalWorkbookSheetBaseline(workbookSheetBaseline(historical.model, sheetId)), 'utf8').digest('hex');
    if (identity.sha256 !== actual) throw new WorkbookFormatError('Historical worksheet baseline identity does not match.');
  }
  const styleSource = workbookCellStyleSource(historical, sheetId, current);
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
  return { xml: writeWorkbookXml(document), styleSource };
}
