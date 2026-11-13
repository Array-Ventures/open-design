import type { Document, Element } from '@xmldom/xmldom';
import { workbookVisibilityEditSchema, type WorkbookVisibilityEdit } from '@open-design/contracts/runtime/workbook';
import type { ReadWorkbook } from './reader.js';
import { child, children, xmlPart } from './parts.js';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { writeWorkbookXml } from './xml.js';

function create(document: Document, parent: Element, name: string): Element {
  return document.createElementNS(parent.namespaceURI, `${parent.prefix ? `${parent.prefix}:` : ''}${name}`);
}
/** Change only sheet visibility and the views made invalid by hiding a sheet.
 * Cell/formula/range ownership, relationship targets and sheet order never move. */
export async function patchWorkbookVisibility(source: ReadWorkbook, edits: readonly WorkbookVisibilityEdit[]): Promise<Buffer> {
  const document = xmlPart(source.parts, 'xl/workbook.xml'), root = document.documentElement!;
  if (source.model.features.signed || source.model.features.macros || [...source.parts.keys()].some(name => name.startsWith('_xmlsignatures/')) || child(root, 'workbookProtection') || child(root, 'customWorkbookViews')) throw new WorkbookFormatError('This workbook does not support worksheet visibility changes.', 'WORKBOOK_UNSUPPORTED');
  if (edits.length > source.model.sheets.length) throw new WorkbookFormatError('Too many worksheet visibility edits.');
  const sheets = children(child(root, 'sheets')!, 'sheet');
  const final = new Map(source.model.sheets.map(sheet => [sheet.id, sheet.visibility]));
  const seen = new Set<string>();
  for (const raw of edits) {
    const edit = workbookVisibilityEditSchema.parse(raw), previous = final.get(edit.sheetId);
    if (seen.has(edit.sheetId) || previous === undefined) throw new WorkbookFormatError('Invalid or duplicate worksheet visibility edit.');
    if (previous === 'veryHidden') throw new WorkbookFormatError('Very hidden worksheets cannot be changed here.', 'WORKBOOK_UNSUPPORTED');
    seen.add(edit.sheetId); final.set(edit.sheetId, edit.visibility);
  }
  const visible = sheets.map((sheet, index) => final.get(sheet.getAttribute('sheetId')!) === 'visible' ? index : -1).filter(index => index >= 0);
  if (!visible.length) throw new WorkbookFormatError('Keep at least one worksheet visible.');
  for (const sheet of sheets) if (seen.has(sheet.getAttribute('sheetId')!)) {
    const visibility = final.get(sheet.getAttribute('sheetId')!)!;
    if (visibility === 'visible') sheet.removeAttribute('state'); else sheet.setAttribute('state', visibility);
  }
  const output = new Map(source.parts), changed = new Map<string, Document>();
  const sheetDocument = (index: number) => {
    const id = sheets[index]!.getAttribute('sheetId')!, part = source.sheetParts.get(id)!;
    let parsed = changed.get(part); if (!parsed) { parsed = xmlPart(source.parts, part); changed.set(part, parsed); }
    return parsed;
  };
  // Hidden sheets must not retain a selected tab in any workbook view.
  for (let index = 0; index < sheets.length; index++) if (seen.has(sheets[index]!.getAttribute('sheetId')!) && final.get(sheets[index]!.getAttribute('sheetId')!) === 'hidden') {
    const part = source.sheetParts.get(sheets[index]!.getAttribute('sheetId')!)!;
    const parsed = xmlPart(source.parts, part), views = child(parsed.documentElement!, 'sheetViews');
    let altered = false;
    for (const view of views ? children(views, 'sheetView') : []) if (view.hasAttribute('tabSelected')) { view.removeAttribute('tabSelected'); altered = true; }
    if (altered) changed.set(part, parsed);
  }
  let bookViews = child(root, 'bookViews');
  // Without a bookViews element, Excel's default active tab is the first sheet.
  if ((!bookViews || !children(bookViews, 'workbookView').length) && final.get(sheets[0]!.getAttribute('sheetId')!) !== 'visible') {
    if (!bookViews) { bookViews = create(document, root, 'bookViews'); root.insertBefore(bookViews, child(root, 'sheets')!); }
    bookViews.appendChild(create(document, bookViews, 'workbookView'));
  }
  const views = bookViews ? children(bookViews, 'workbookView') : [];
  for (const [viewId, view] of views.entries()) {
    const active = Number(view.getAttribute('activeTab') ?? '0');
    if (!Number.isInteger(active) || active < 0 || active >= sheets.length) throw new WorkbookFormatError('Invalid workbook active worksheet.');
    if (final.get(sheets[active]!.getAttribute('sheetId')!) !== 'visible') {
      const next = visible.filter(index => index < active).at(-1) ?? visible.find(index => index > active)!;
      view.setAttribute('activeTab', String(next));
      const parsed = sheetDocument(next), sheetRoot = parsed.documentElement!;
      let sheetViews = child(sheetRoot, 'sheetViews');
      if (!sheetViews) {
        sheetViews = create(parsed, sheetRoot, 'sheetViews');
        const before = Array.from(sheetRoot.childNodes).find(node => node.nodeType === 1 && !['sheetPr', 'dimension'].includes((node as Element).localName));
        sheetRoot.insertBefore(sheetViews, before ?? null);
      }
      let selected = children(sheetViews, 'sheetView').find(item => item.getAttribute('workbookViewId') === String(viewId));
      if (!selected) { selected = create(parsed, sheetViews, 'sheetView'); selected.setAttribute('workbookViewId', String(viewId)); sheetViews.appendChild(selected); }
      selected.setAttribute('tabSelected', '1');
    }
    if (view.hasAttribute('firstSheet')) {
      const first = Number(view.getAttribute('firstSheet'));
      if (!Number.isInteger(first) || first < 0 || first >= sheets.length) throw new WorkbookFormatError('Invalid workbook first worksheet.');
      if (!visible.includes(first)) view.setAttribute('firstSheet', String(visible[0]));
    }
  }
  output.set('xl/workbook.xml', writeWorkbookXml(document));
  for (const [part, parsed] of changed) output.set(part, writeWorkbookXml(parsed));
  return writeWorkbookPackage(output);
}
