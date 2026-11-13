import type { Document, Element } from '@xmldom/xmldom';
import { workbookStyleEditSchema, WORKBOOK_MODEL_LIMITS, type WorkbookStyleEdit } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { appendWorkbookRowCell, orderWorkbookRowCells, address, child, children, relationships, xmlPart } from './parts.js';
import type { ReadWorkbook } from './reader.js';
import { writeWorkbookXml } from './xml.js';

function create(doc: Document, parent: Element, name: string) { return doc.createElementNS(parent.namespaceURI, parent.prefix ? `${parent.prefix}:${name}` : name); }
function unsigned(value: string | null, fallback?: number): number {
  if (value === null && fallback !== undefined) return fallback;
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new WorkbookFormatError('Invalid workbook style index.');
  return Number(value);
}
function flag(value: string | null): boolean {
  if (value === null || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  throw new WorkbookFormatError('Invalid row formatting flag.');
}
export function workbookStyleComponentSignature(node: Element): string {
  return JSON.stringify([node.namespaceURI, node.localName, Array.from(node.attributes).map(a => [a.namespaceURI, a.name, a.value]).sort(), Array.from(node.childNodes).filter(n => n.nodeType !== 3 || n.textContent?.trim()).map(n => n.nodeType === 1 ? workbookStyleComponentSignature(n as Element) : n.textContent)]);
}
/** Each source component is indexed once, and each new candidate once. */
function table(root: Element, name: string, entry: string, required = true) {
  const containers = children(root, name);
  if (containers.length > 1 || required && containers.length !== 1) throw new WorkbookFormatError('Workbook style components are missing or ambiguous.', 'WORKBOOK_UNSUPPORTED');
  const parent = containers[0], entries = parent ? children(parent, entry) : [];
  if (parent?.hasAttribute('count') && unsigned(parent.getAttribute('count')) !== entries.length) throw new WorkbookFormatError('Workbook style count does not match its components.');
  if (entries.length > WORKBOOK_MODEL_LIMITS.styles) throw new WorkbookFormatError('Workbook style table exceeds its limit.', 'WORKBOOK_LIMIT');
  const identities = new Map<string, number>();
  for (const [index, node] of entries.entries()) { const key = workbookStyleComponentSignature(node); if (!identities.has(key)) identities.set(key, index); }
  return { entries, at(index: number) { const result = entries[index]; if (!result) throw new WorkbookFormatError('Workbook style component is missing.'); return result; },
    intern(node: Element) {
      if (!parent) throw new WorkbookFormatError('Workbook style table is missing.');
      const key = workbookStyleComponentSignature(node), found = identities.get(key); if (found !== undefined) return found;
      if (entries.length >= WORKBOOK_MODEL_LIMITS.styles) throw new WorkbookFormatError('Workbook style table exceeds its limit.', 'WORKBOOK_LIMIT');
      const index = entries.length; entries.push(node); identities.set(key, index); parent.appendChild(node); parent.setAttribute('count', String(entries.length)); return index;
    } };
}
function replace(parent: Element, name: string, replacement?: Element) {
  for (const entry of children(parent, name)) parent.removeChild(entry);
  if (replacement) parent.insertBefore(replacement, child(parent, 'extLst') ?? null);
}
function coordinate(row: number, column: number) { let letters = ''; for (let n = column + 1; n; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters; return `${letters}${row + 1}`; }
interface SheetIndex { rowExtensions: Map<Element, Element | null>; document: Document; data: Element; rows: Map<number, Element>; cells: Map<string, Element>; columns: Map<number, number> }
function indexSheet(source: ReadWorkbook, part: string, styleCount: number): SheetIndex {
  const document = xmlPart(source.parts, part), root = document.documentElement!, data = child(root, 'sheetData');
  if (!data || child(root, 'sheetProtection')) throw new WorkbookFormatError('Protected or missing worksheets cannot be formatted here.', 'WORKBOOK_UNSUPPORTED');
  const rowExtensions = new Map<Element, Element | null>(), rows = new Map<number, Element>(), cells = new Map<string, Element>(), columns = new Map<number, number>();
  const styleId = (value: string | null) => { const id = unsigned(value); if (id >= styleCount) throw new WorkbookFormatError('Cell style is missing.'); return id; };
  for (const row of children(data, 'row')) {
    if (!row.hasAttribute('r')) throw new WorkbookFormatError('Implicit cell coordinates need a formatting adapter.', 'WORKBOOK_UNSUPPORTED');
    const number = unsigned(row.getAttribute('r')) - 1;
    if (number < 0 || number >= WORKBOOK_MODEL_LIMITS.rows || rows.has(number)) throw new WorkbookFormatError('Invalid worksheet row.');
    rows.set(number, row); rowExtensions.set(row, child(row, 'extLst') ?? null); flag(row.getAttribute('customFormat')); if (row.hasAttribute('s')) styleId(row.getAttribute('s'));
    for (const cell of children(row, 'c')) {
      if (!cell.hasAttribute('r')) throw new WorkbookFormatError('Implicit cell coordinates need a formatting adapter.', 'WORKBOOK_UNSUPPORTED');
      const position = address(cell.getAttribute('r')!), key = `${position.row}:${position.column}`;
      if (position.row !== number || cells.has(key)) throw new WorkbookFormatError('Invalid worksheet cell position.');
      cells.set(key, cell); if (cell.hasAttribute('s')) styleId(cell.getAttribute('s'));
    }
  }
  const coveredColumns = new Set<number>();
  for (const cols of children(root, 'cols')) for (const col of children(cols, 'col')) {
    const min = unsigned(col.getAttribute('min')), max = unsigned(col.getAttribute('max'));
    if (min < 1 || max < min || max > WORKBOOK_MODEL_LIMITS.columns) throw new WorkbookFormatError('Invalid worksheet column range.');
    const id = col.hasAttribute('style') ? styleId(col.getAttribute('style')) : undefined;
    for (let index = min - 1; index < max; index++) { if (coveredColumns.has(index)) throw new WorkbookFormatError('Ambiguous worksheet column ranges.'); coveredColumns.add(index); if (id !== undefined) columns.set(index, id); }
  }
  return { rowExtensions, document, data, rows, cells, columns };
}
/** Clone only the effective cell XF and changed components. Unrepresented XML,
 * workbook parts, rich strings and formula caches remain source-owned. */
export async function patchWorkbookStyles(source: ReadWorkbook, edits: readonly WorkbookStyleEdit[]): Promise<Buffer> {
  if (!edits.length) return writeWorkbookPackage(source.parts);
  if (source.model.features.signed) throw new WorkbookFormatError('Editing would invalidate workbook signatures.', 'WORKBOOK_UNSUPPORTED');
  if (edits.length > WORKBOOK_MODEL_LIMITS.cells) throw new WorkbookFormatError('Too many style edits.', 'WORKBOOK_LIMIT');
  const links = [...relationships(source.parts, 'xl/workbook.xml').values()].filter(link => link.type.endsWith('/styles'));
  const link = links[0]; if (links.length !== 1 || !link || link.external) throw new WorkbookFormatError('Workbook style table is unavailable.', 'WORKBOOK_UNSUPPORTED');
  const doc = xmlPart(source.parts, link.target), root = doc.documentElement!;
  const xfs = table(root, 'cellXfs', 'xf'), fonts = table(root, 'fonts', 'font'), fills = table(root, 'fills', 'fill');
  const borders = table(root, 'borders', 'border', false), parents = table(root, 'cellStyleXfs', 'xf', false);
  const formats = table(root, 'numFmts', 'numFmt', false);
  const formatIds = new Set(formats.entries.map(entry => unsigned(entry.getAttribute('numFmtId'))));
  if (formatIds.size !== formats.entries.length) throw new WorkbookFormatError('Duplicate workbook number format.');
  for (const xf of [...xfs.entries, ...parents.entries]) {
    fonts.at(unsigned(xf.getAttribute('fontId'), 0)); fills.at(unsigned(xf.getAttribute('fillId'), 0));
    if (xf.hasAttribute('borderId')) borders.at(unsigned(xf.getAttribute('borderId')));
    const format = unsigned(xf.getAttribute('numFmtId'), 0); if (format >= 164 && !formatIds.has(format)) throw new WorkbookFormatError('Workbook number format is missing.');
    if (xf.hasAttribute('xfId')) parents.at(unsigned(xf.getAttribute('xfId')));
  }
  const originalStyles = xfs.entries.length, documents = new Map<string, SheetIndex>(), seen = new Set<string>();
  for (const input of edits) {
    const edit = workbookStyleEditSchema.parse(input), key = `${edit.sheetId}:${edit.row}:${edit.column}`;
    if (seen.has(key)) throw new WorkbookFormatError('Duplicate workbook style edit.'); seen.add(key);
    const sheet = source.model.sheets.find(sheet => sheet.id === edit.sheetId), part = source.sheetParts.get(edit.sheetId);
    if (!sheet || !part || edit.row >= sheet.rowCount || edit.column >= sheet.columnCount) throw new WorkbookFormatError('Style edit is outside the workbook.');
    let index = documents.get(part); if (!index) { index = indexSheet(source, part, originalStyles); documents.set(part, index); }
    const { document, data, rows, cells, columns, rowExtensions } = index;
    let row = rows.get(edit.row), cell = cells.get(`${edit.row}:${edit.column}`);
    const customRow = flag(row?.getAttribute('customFormat') ?? null), rowStyle = customRow && row?.hasAttribute('s') ? unsigned(row.getAttribute('s')) : undefined, columnStyle = columns.get(edit.column);
    if (!cell?.hasAttribute('s') && rowStyle !== undefined && columnStyle !== undefined && rowStyle !== columnStyle) throw new WorkbookFormatError('Intersecting row and column styles need a formatting adapter.', 'WORKBOOK_UNSUPPORTED');
    const baseId = cell?.hasAttribute('s') ? unsigned(cell.getAttribute('s')) : rowStyle ?? columnStyle ?? 0;
    const base = xfs.at(baseId), xf = base.cloneNode(true) as Element;
    if (edit.bold !== undefined || edit.italic !== undefined || edit.fontSize !== undefined || edit.fontColor !== undefined) {
      if (['0', 'false'].includes(base.getAttribute('applyFont') ?? '')) throw new WorkbookFormatError('Inherited font overrides need a formatting adapter.', 'WORKBOOK_UNSUPPORTED');
      const font = fonts.at(unsigned(base.getAttribute('fontId'), 0)).cloneNode(true) as Element;
      for (const [property, name] of [['bold', 'b'], ['italic', 'i']] as const) if (edit[property] !== undefined) replace(font, name, edit[property] ? create(doc, font, name) : undefined);
      if (edit.fontSize !== undefined) { const size = create(doc, font, 'sz'); size.setAttribute('val', String(edit.fontSize)); replace(font, 'sz', size); }
      if (edit.fontColor !== undefined) { const color = create(doc, font, 'color'); color.setAttribute(edit.fontColor === null ? 'auto' : 'rgb', edit.fontColor === null ? '1' : edit.fontColor.toUpperCase()); replace(font, 'color', color); }
      xf.setAttribute('fontId', String(fonts.intern(font))); xf.setAttribute('applyFont', '1');
    }
    if (edit.fillColor !== undefined) {
      const fill = create(doc, root, 'fill'), pattern = create(doc, fill, 'patternFill'); pattern.setAttribute('patternType', edit.fillColor === null ? 'none' : 'solid'); fill.appendChild(pattern);
      if (edit.fillColor !== null) { const foreground = create(doc, pattern, 'fgColor'); foreground.setAttribute('rgb', edit.fillColor.toUpperCase()); pattern.appendChild(foreground); }
      xf.setAttribute('fillId', String(fills.intern(fill))); xf.setAttribute('applyFill', '1');
    }
    const styleId = xfs.intern(xf);
    if (!row) { row = create(document, data, 'row'); row.setAttribute('r', String(edit.row + 1)); data.appendChild(row); rows.set(edit.row, row); }
    if (!cell) { cell = create(document, row, 'c'); cell.setAttribute('r', coordinate(edit.row, edit.column)); appendWorkbookRowCell(row, cell, rowExtensions.get(row) ?? null); cells.set(`${edit.row}:${edit.column}`, cell); row.removeAttribute('spans'); replace(document.documentElement!, 'dimension'); }
    cell.setAttribute('s', String(styleId));
  }
  const output = new Map(source.parts); output.set(link.target, writeWorkbookXml(doc));
  for (const [part, { document, data, rows }] of documents) {
    for (const [, row] of [...rows].sort(([a], [b]) => a - b)) { data.appendChild(row);
      orderWorkbookRowCells(row);
    }
    output.set(part, writeWorkbookXml(document));
  }
  return writeWorkbookPackage(output);
}
