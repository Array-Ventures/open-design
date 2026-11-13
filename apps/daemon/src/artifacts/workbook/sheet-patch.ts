import { workbookSheetProjectionSchema, WORKBOOK_SHEET_ID_MAX, workbookVisibilityEditSchema, type WorkbookSheetProjection, type WorkbookVisibilityEdit } from '@open-design/contracts/runtime/workbook';
import type { Element } from '@xmldom/xmldom';
import type { ReadWorkbook } from './reader.js';
import { assertWorkbookStructureSupported } from './structure-patch.js';
import { child, children, xmlPart } from './parts.js';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { writeWorkbookXml } from './xml.js';
import { workbookSheetFormula } from './sheet-formulas.js';
import { patchWorkbookSheetProperties } from './sheet-properties.js';
import { removeWorkbookCalculationChain } from './calculation-chain.js';

const invalid = (message: string): never => { throw new WorkbookFormatError(message); };
const unsupported = (message: string): never => { throw new WorkbookFormatError(message, 'WORKBOOK_UNSUPPORTED'); };
/** Internal source-only foundation. No preview capability or wire plan enables
 * these actions yet. Repeat this admission in the eventual contained caller. */
export function assertWorkbookSheetsSupported(source: ReadWorkbook): void {
  assertWorkbookStructureSupported(source);
  workbookSheetProjectionSchema.parse(source.model.sheets.map(sheet => ({ sheetId: sheet.id, name: sheet.name, origin: 'source' })));
  for (const sheet of source.model.sheets) {
    if (!/^[1-9][0-9]*$/.test(sheet.id) || Number(sheet.id) > WORKBOOK_SHEET_ID_MAX) unsupported('Worksheet IDs exceed the bounded numeric importer.');
    if (sheet.visibility === 'veryHidden') unsupported('Very hidden sheets need their own sheet-action policy.');
  }
  for (const part of source.parts.keys()) if (part.startsWith('docProps/') && !['docProps/app.xml', 'docProps/core.xml'].includes(part)) unsupported('This document property has no worksheet-name owner.');
  // Qualify extended title vectors even if the requested action is only rename.
  patchWorkbookSheetProperties(source, source.model.sheets.map(sheet => ({ sheetId: sheet.id, name: sheet.name, origin: 'source' })));
}

export async function patchWorkbookSheets(source: ReadWorkbook, raw: WorkbookSheetProjection, visibility: readonly WorkbookVisibilityEdit[] = []): Promise<Buffer> {
  assertWorkbookSheetsSupported(source);
  const target = workbookSheetProjectionSchema.parse(raw), originals = new Map(source.model.sheets.map(sheet => [sheet.id, sheet]));
  const maximum = Math.max(...source.model.sheets.map(sheet => Number(sheet.id)));
  const existingOrder = source.model.sheets.filter(sheet => target.some(item => item.origin === 'source' && item.sheetId === sheet.id)).map(sheet => sheet.id);
  const surviving = target.filter(sheet => sheet.origin === 'source').map(sheet => sheet.sheetId);
  if (existingOrder.join('\0') !== surviving.join('\0')) invalid('Surviving worksheets cannot be reordered by this sheet-action plan.');
  let sawNew = false;
  for (const sheet of target) {
    if (sheet.origin === 'source') {
      if (sawNew || !originals.has(sheet.sheetId)) invalid('Worksheet source identity or append order is invalid.');
    } else {
      sawNew = true;
      if (originals.has(sheet.sheetId) || Number(sheet.sheetId) <= maximum) invalid('New worksheet IDs must be fresh bounded births above the source maximum.');
    }
  }
  const states = new Map(target.map(sheet => [sheet.sheetId, sheet.origin === 'new' ? 'visible' : originals.get(sheet.sheetId)!.visibility]));
  const seenVisibility = new Set<string>();
  for (const rawEdit of visibility) {
    const edit = workbookVisibilityEditSchema.parse(rawEdit);
    if (!states.has(edit.sheetId) || seenVisibility.has(edit.sheetId)) invalid('Worksheet visibility does not belong to the final sheet projection.');
    seenVisibility.add(edit.sheetId); states.set(edit.sheetId, edit.visibility);
  }
  if (![...states.values()].includes('visible')) invalid('Keep at least one worksheet visible.');
  if (target.length === source.model.sheets.length && target.every((sheet, index) => sheet.origin === 'source' && sheet.sheetId === source.model.sheets[index]!.id && sheet.name === source.model.sheets[index]!.name && states.get(sheet.sheetId) === source.model.sheets[index]!.visibility)) return writeWorkbookPackage(source.parts);
  const output = new Map(source.parts), document = xmlPart(source.parts, 'xl/workbook.xml'), root = document.documentElement!, container = child(root, 'sheets')!;
  const entries = children(container, 'sheet'), relations = xmlPart(source.parts, 'xl/_rels/workbook.xml.rels'), relationRoot = relations.documentElement!;
  const types = xmlPart(source.parts, '[Content_Types].xml'), typeRoot = types.documentElement!;
  const sourceEntries = new Map(entries.map(sheet => [sheet.getAttribute('sheetId')!, sheet]));
  const relationNamespace = entries[0]!.getAttributeNodeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')?.namespaceURI ?? entries[0]!.getAttributeNodeNS('http://purl.oclc.org/ooxml/officeDocument/relationships', 'id')?.namespaceURI ?? invalid('Worksheet relationship namespace is unavailable.');
  const newElement = (parent: Element, name: string) => parent.ownerDocument!.createElementNS(parent.namespaceURI, `${parent.prefix ? parent.prefix + ':' : ''}${name}`);
  const finalIds = new Set(target.map(sheet => sheet.sheetId));
  for (const sheet of source.model.sheets) if (!finalIds.has(sheet.id)) {
    const entry = sourceEntries.get(sheet.id)!, relationId = entry.getAttributeNS(relationNamespace, 'id')!;
    const part = source.sheetParts.get(sheet.id)!;
    const relation = children(relationRoot, 'Relationship').filter(node => node.getAttribute('Id') === relationId);
    if (relation.length !== 1) invalid('Removed worksheet relationship ownership is ambiguous.');
    relationRoot.removeChild(relation[0]!); output.delete(part);
    for (const node of children(typeRoot, 'Override')) if (node.getAttribute('PartName') === `/${part}`) typeRoot.removeChild(node);
  }
  const reservedParts = new Set([...source.parts.keys()].map(name => name.toLowerCase()));
  const reservedRelations = new Set(children(relationRoot, 'Relationship').map(node => node.getAttribute('Id')));
  for (const sheet of target) {
    let entry = sourceEntries.get(sheet.sheetId);
    if (sheet.origin === 'new') {
      let index = 1; while (reservedParts.has(`xl/worksheets/sheet${index}.xml`.toLowerCase())) index++;
      const part = `xl/worksheets/sheet${index}.xml`; reservedParts.add(part.toLowerCase());
      let rid = 1; while (reservedRelations.has(`rId${rid}`)) rid++;
      const relationshipId = `rId${rid}`; reservedRelations.add(relationshipId);
      entry = newElement(container, 'sheet'); entry.setAttribute('sheetId', sheet.sheetId); entry.setAttributeNS(relationNamespace, 'r:id', relationshipId);
      const relation = newElement(relationRoot, 'Relationship'); relation.setAttribute('Id', relationshipId); relation.setAttribute('Type', `${relationNamespace}/worksheet`); relation.setAttribute('Target', `worksheets/sheet${index}.xml`); relationRoot.appendChild(relation);
      const type = newElement(typeRoot, 'Override'); type.setAttribute('PartName', `/${part}`); type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'); typeRoot.appendChild(type);
      output.set(part, Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${root.namespaceURI}"><sheetData/></worksheet>`));
    }
    entry!.setAttribute('name', sheet.name);
    const state = states.get(sheet.sheetId)!;
    if (state === 'visible') entry!.removeAttribute('state'); else entry!.setAttribute('state', state);
    container.appendChild(entry!);
  }
  for (const entry of entries) if (!finalIds.has(entry.getAttribute('sheetId')!)) container.removeChild(entry);
  const firstVisible = target.findIndex(sheet => states.get(sheet.sheetId) === 'visible');
  let views = child(root, 'bookViews');
  if (firstVisible > 0 && (!views || !children(views, 'workbookView').length)) {
    if (!views) { views = newElement(root, 'bookViews'); root.insertBefore(views, container); }
    views.appendChild(newElement(views, 'workbookView'));
  }
  for (const view of views ? children(views, 'workbookView') : []) for (const attribute of ['activeTab', 'firstSheet']) {
    // OOXML defaults both omitted indices to zero. Map that implicit source
    // identity too, otherwise a surviving hidden sheet can become index zero.
    const oldIndex = view.hasAttribute(attribute) ? Number(view.getAttribute(attribute)) : 0;
    if (!Number.isSafeInteger(oldIndex) || oldIndex < 0 || oldIndex >= source.model.sheets.length) invalid('Workbook view sheet index is invalid.');
    const index = target.findIndex(sheet => sheet.sheetId === source.model.sheets[oldIndex]!.id && states.get(sheet.sheetId) === 'visible');
    view.setAttribute(attribute, String(index < 0 ? firstVisible : index));
  }
  // Rename/delete can affect formulas anywhere. Keep untouched worksheet bytes,
  // and clear derived caches on all surviving formula cells before calculation.
  for (const sheet of target.filter(sheet => sheet.origin === 'source')) {
    const part = source.sheetParts.get(sheet.sheetId)!, doc = xmlPart(source.parts, part), sheetRoot = doc.documentElement!;
    let changed = false;
    const sheetViews = child(sheetRoot, 'sheetViews');
    for (const view of sheetViews ? children(sheetViews, 'sheetView') : []) if (view.hasAttribute('tabSelected')) { view.removeAttribute('tabSelected'); changed = true; }
    const data = child(sheetRoot, 'sheetData');
    for (const row of data ? children(data, 'row') : []) for (const cell of children(row, 'c')) {
      const formula = child(cell, 'f'); if (!formula) continue;
      formula.textContent = workbookSheetFormula(formula.textContent ?? '', source.model.sheets, target);
      for (const cache of [...children(cell, 'v'), ...children(cell, 'is')]) cell.removeChild(cache);
      cell.removeAttribute('t'); changed = true;
    }
    if (changed) output.set(part, writeWorkbookXml(doc));
  }
  output.set('xl/workbook.xml', writeWorkbookXml(document));
  output.set('xl/_rels/workbook.xml.rels', writeWorkbookXml(relations));
  output.set('[Content_Types].xml', writeWorkbookXml(types));
  const properties = patchWorkbookSheetProperties(source, target); if (properties) output.set('docProps/app.xml', properties);
  removeWorkbookCalculationChain(output);
  return writeWorkbookPackage(output);
}
