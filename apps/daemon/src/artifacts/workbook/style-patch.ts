import type { Document, Element } from '@xmldom/xmldom';
import { workbookStyleEditSchema, WORKBOOK_MODEL_LIMITS, type WorkbookStyleEdit } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { address, child, children, relationships, xmlPart } from './parts.js';
import type { ReadWorkbook } from './reader.js';
import { writeWorkbookXml } from './xml.js';

function create(doc: Document, parent: Element, name: string) { return doc.createElementNS(parent.namespaceURI, parent.prefix ? `${parent.prefix}:${name}` : name); }
function signature(node: Element): string {
  return JSON.stringify([node.namespaceURI, node.localName, Array.from(node.attributes).map(a => [a.namespaceURI, a.name, a.value]).sort(), Array.from(node.childNodes).filter(n => n.nodeType !== 3 || n.textContent?.trim()).map(n => n.nodeType === 1 ? signature(n as Element) : n.textContent)]);
}
function intern(parent: Element, name: string, node: Element): number {
  const entries = children(parent, name), key = signature(node), found = entries.findIndex(entry => signature(entry) === key);
  if (found >= 0) return found;
  if (entries.length >= WORKBOOK_MODEL_LIMITS.styles) throw new WorkbookFormatError('Workbook style table exceeds its limit.', 'WORKBOOK_LIMIT');
  parent.appendChild(node); parent.setAttribute('count', String(entries.length + 1)); return entries.length;
}
function replace(parent: Element, name: string, replacement?: Element) {
  const old = children(parent, name); for (const entry of old) parent.removeChild(entry);
  if (replacement) parent.insertBefore(replacement, child(parent, 'extLst') ?? null);
}
function coordinate(row: number, column: number) { let letters = ''; for (let n = column + 1; n; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters; return `${letters}${row + 1}`; }
/** Clone only the effective cell XF and changed components. Unrepresented XML,
 * workbook parts, rich strings and formula caches remain source-owned. */
export async function patchWorkbookStyles(source: ReadWorkbook, edits: readonly WorkbookStyleEdit[]): Promise<Buffer> {
  if (!edits.length) return writeWorkbookPackage(source.parts);
  if (source.model.features.signed) throw new WorkbookFormatError('Editing would invalidate workbook signatures.', 'WORKBOOK_UNSUPPORTED');
  if (edits.length > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookFormatError('Too many style edits.', 'WORKBOOK_LIMIT');
  const link = [...relationships(source.parts, 'xl/workbook.xml').values()].find(link => link.type.endsWith('/styles'));
  if (!link || link.external) throw new WorkbookFormatError('Workbook style table is unavailable.', 'WORKBOOK_UNSUPPORTED');
  const doc = xmlPart(source.parts, link.target), root = doc.documentElement!, xfs = child(root, 'cellXfs'), fonts = child(root, 'fonts'), fills = child(root, 'fills');
  if (!xfs || !fonts || !fills) throw new WorkbookFormatError('Workbook style components are missing.', 'WORKBOOK_UNSUPPORTED');
  const documents = new Map<string, Document>(), seen = new Set<string>();
  for (const input of edits) {
    const edit = workbookStyleEditSchema.parse(input), key = `${edit.sheetId}:${edit.row}:${edit.column}`;
    if (seen.has(key)) throw new WorkbookFormatError('Duplicate workbook style edit.'); seen.add(key);
    const sheet = source.model.sheets.find(sheet => sheet.id === edit.sheetId), part = source.sheetParts.get(edit.sheetId);
    if (!sheet || !part || edit.row >= sheet.rowCount || edit.column >= sheet.columnCount) throw new WorkbookFormatError('Style edit is outside the workbook.');
    let document = documents.get(part); if (!document) { document = xmlPart(source.parts, part); documents.set(part, document); }
    const worksheet = document.documentElement!, data = child(worksheet, 'sheetData');
    if (!data || child(worksheet, 'sheetProtection')) throw new WorkbookFormatError('Protected or missing worksheets cannot be formatted here.', 'WORKBOOK_UNSUPPORTED');
    // Explicit coordinates are necessary to avoid guessing omitted source cells.
    let row = children(data, 'row').find(row => Number(row.getAttribute('r')) === edit.row + 1);
    if (children(data, 'row').some(row => !row.hasAttribute('r') || children(row, 'c').some(cell => !cell.hasAttribute('r')))) throw new WorkbookFormatError('Implicit cell coordinates need a formatting adapter.', 'WORKBOOK_UNSUPPORTED');
    let cell = row && children(row, 'c').find(cell => cell.getAttribute('r') === coordinate(edit.row, edit.column));
    const column = child(worksheet, 'cols') && children(child(worksheet, 'cols')!, 'col').find(col => Number(col.getAttribute('min')) <= edit.column + 1 && Number(col.getAttribute('max')) >= edit.column + 1);
    const baseId = Number(cell?.getAttribute('s') ?? (row?.getAttribute('customFormat') === '1' ? row.getAttribute('s') : null) ?? column?.getAttribute('style') ?? '0');
    const base = children(xfs, 'xf')[baseId]; if (!base) throw new WorkbookFormatError('Cell style is missing.');
    const xf = base.cloneNode(true) as Element;
    if (edit.bold !== undefined || edit.italic !== undefined || edit.fontColor !== undefined) {
      if (['0', 'false'].includes(base.getAttribute('applyFont') ?? '')) throw new WorkbookFormatError('Inherited font overrides need a formatting adapter.', 'WORKBOOK_UNSUPPORTED');
      const original = children(fonts, 'font')[Number(base.getAttribute('fontId') ?? 0)]; if (!original) throw new WorkbookFormatError('Cell font is missing.');
      const font = original.cloneNode(true) as Element;
      for (const [property, name] of [['bold', 'b'], ['italic', 'i']] as const) if (edit[property] !== undefined) {
        replace(font, name, edit[property] ? create(doc, font, name) : undefined);
      }
      if (edit.fontColor !== undefined) { const color = create(doc, font, 'color'); color.setAttribute(edit.fontColor === null ? 'auto' : 'rgb', edit.fontColor === null ? '1' : edit.fontColor.toUpperCase()); replace(font, 'color', color); }
      xf.setAttribute('fontId', String(intern(fonts, 'font', font))); xf.setAttribute('applyFont', '1');
    }
    if (edit.fillColor !== undefined) {
      const fill = create(doc, fills, 'fill'), pattern = create(doc, fill, 'patternFill'); pattern.setAttribute('patternType', edit.fillColor === null ? 'none' : 'solid'); fill.appendChild(pattern);
      if (edit.fillColor !== null) { const foreground = create(doc, pattern, 'fgColor'); foreground.setAttribute('rgb', edit.fillColor.toUpperCase()); pattern.appendChild(foreground); }
      xf.setAttribute('fillId', String(intern(fills, 'fill', fill))); xf.setAttribute('applyFill', '1');
    }
    const styleId = intern(xfs, 'xf', xf);
    if (!row) { row = create(document, data, 'row'); row.setAttribute('r', String(edit.row + 1)); data.insertBefore(row, children(data, 'row').find(r => Number(r.getAttribute('r')) > edit.row + 1) ?? null); }
    if (!cell) { cell = create(document, row, 'c'); cell.setAttribute('r', coordinate(edit.row, edit.column)); row.insertBefore(cell, children(row, 'c').find(c => address(c.getAttribute('r')!).column > edit.column) ?? null); }
    cell.setAttribute('s', String(styleId));
  }
  const output = new Map(source.parts); output.set(link.target, writeWorkbookXml(doc));
  for (const [part, document] of documents) output.set(part, writeWorkbookXml(document));
  return writeWorkbookPackage(output);
}
