import type { Document, Element } from '@xmldom/xmldom';
import { workbookDimensionEditSchema, type WorkbookDimensionEdit } from '@open-design/contracts/runtime/workbook';
import type { ReadWorkbook } from './reader.js';
import { child, children, xmlPart } from './parts.js';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { writeWorkbookXml } from './xml.js';

function create(document: Document, parent: Element, name: string) {
  return document.createElementNS(parent.namespaceURI, `${parent.prefix ? `${parent.prefix}:` : ''}${name}`);
}
/** Only the requested row/column attributes change. Column ranges are split
 * without flattening their styles, outline levels or unknown OOXML metadata. */
export async function patchWorkbookDimensions(source: ReadWorkbook, edits: readonly WorkbookDimensionEdit[]): Promise<Buffer> {
  if (source.model.features.signed) throw new WorkbookFormatError('Editing would invalidate workbook signatures.', 'WORKBOOK_UNSUPPORTED');
  if (edits.length > 100_000) throw new WorkbookFormatError('Too many workbook dimension edits.', 'WORKBOOK_LIMIT');
  const documents = new Map<string, Document>(), positions = new Set<string>();
  for (const raw of edits) {
    const edit = workbookDimensionEditSchema.parse(raw), sheet = source.model.sheets.find(sheet => sheet.id === edit.sheetId), part = source.sheetParts.get(edit.sheetId);
    if (!sheet || !part || edit.index >= (edit.axis === 'row' ? sheet.rowCount : sheet.columnCount)) throw new WorkbookFormatError('Dimension edit is outside its sheet.');
    const key = `${edit.sheetId}:${edit.axis}:${edit.index}`;
    if (positions.has(key)) throw new WorkbookFormatError('Duplicate workbook dimension edit.'); positions.add(key);
    let document = documents.get(part);
    if (!document) {
      document = xmlPart(source.parts, part); documents.set(part, document);
      const data = child(document.documentElement!, 'sheetData'); let previousRow = 0;
      for (const row of data ? children(data, 'row') : []) {
        const index = row.hasAttribute('r') ? Number(row.getAttribute('r')) : previousRow + 1;
        row.setAttribute('r', String(index)); previousRow = index;
      }
    }
    const root = document.documentElement!;
    if (child(root, 'sheetProtection')) throw new WorkbookFormatError('Protected worksheet dimensions cannot be edited.', 'WORKBOOK_UNSUPPORTED');
    let target: Element;
    const index = edit.index + 1;
    if (edit.axis === 'row') {
      const data = child(root, 'sheetData'); if (!data) throw new WorkbookFormatError('Worksheet has no cell data.');
      target = children(data, 'row').find(row => Number(row.getAttribute('r')) === index) ?? create(document, data, 'row');
      if (!target.parentNode) { target.setAttribute('r', String(index)); data.insertBefore(target, children(data, 'row').find(row => Number(row.getAttribute('r')) > index) ?? null); }
      if (edit.size !== undefined) { target.setAttribute('ht', String(edit.size)); target.setAttribute('customHeight', '1'); }
    } else {
      let cols = child(root, 'cols');
      if (!cols) { cols = create(document, root, 'cols'); root.insertBefore(cols, child(root, 'sheetData') ?? null); }
      const matches = children(cols, 'col').filter(col => Number(col.getAttribute('min')) <= index && Number(col.getAttribute('max')) >= index);
      if (matches.length > 1) throw new WorkbookFormatError('Overlapping worksheet column ranges cannot be resized.', 'WORKBOOK_UNSUPPORTED');
      const old = matches[0]; target = old ? old.cloneNode(true) as Element : create(document, cols, 'col');
      target.setAttribute('min', String(index)); target.setAttribute('max', String(index));
      if (old) {
        const min = Number(old.getAttribute('min')), max = Number(old.getAttribute('max'));
        if (min < index) { const before = old.cloneNode(true) as Element; before.setAttribute('max', String(index - 1)); cols.insertBefore(before, old); }
        cols.insertBefore(target, old);
        if (max > index) { const after = old.cloneNode(true) as Element; after.setAttribute('min', String(index + 1)); cols.insertBefore(after, old); }
        cols.removeChild(old);
      } else cols.insertBefore(target, children(cols, 'col').find(col => Number(col.getAttribute('min')) > index) ?? null);
      if (edit.size !== undefined) { target.setAttribute('width', String(edit.size)); target.setAttribute('customWidth', '1'); }
    }
    if (edit.hidden !== undefined) target.setAttribute('hidden', edit.hidden ? '1' : '0');
  }
  const output = new Map(source.parts); for (const [part, document] of documents) output.set(part, writeWorkbookXml(document));
  return writeWorkbookPackage(output);
}
