import type { Element } from '@xmldom/xmldom';
import type { ReadWorkbook } from './reader.js';
import { WorkbookFormatError } from './package.js';
import { child, children, relationships, xmlPart } from './parts.js';
import { assertWorkbookSheetsSupported } from './sheet-patch.js';
import { workbookStyleComponentSignature as signature } from './style-patch.js';

const unsupported = (): never => { throw new WorkbookFormatError('Historical worksheet resources do not match the current source owners.', 'WORKBOOK_UNSUPPORTED'); };
const collections = new Map([['numFmts', 'numFmt'], ['fonts', 'font'], ['fills', 'fill'], ['borders', 'border'], ['cellStyleXfs', 'xf'], ['cellXfs', 'xf'], ['cellStyles', 'cellStyle'], ['dxfs', 'dxf']]);
const critical = new Set(['fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs']);
function integer(value: string | null, fallback?: number): number {
  if (value === null && fallback !== undefined) return fallback;
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) return unsupported();
  return Number(value);
}
function elements(root: Element): Element[] { return Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1); }
function shell(root: Element): string {
  const copy = root.cloneNode(false) as Element; copy.removeAttribute('count'); return signature(copy);
}
function indexed(root: Element): Map<string, Element> {
  const result = new Map<string, Element>();
  for (const node of elements(root)) {
    if (node.namespaceURI !== root.namespaceURI || result.has(node.localName!)) unsupported();
    result.set(node.localName!, node);
  }
  return result;
}
function entries(root: Element | undefined, name: string): Element[] {
  if (!root) return [];
  const result = elements(root);
  if (result.some(node => node.namespaceURI !== root.namespaceURI || node.localName !== name) || root.hasAttribute('count') && integer(root.getAttribute('count')) !== result.length) unsupported();
  return result;
}
function theme(source: ReadWorkbook): string | undefined {
  const links = [...relationships(source.parts, 'xl/workbook.xml').values()].filter(link => link.type.endsWith('/theme'));
  if (links.length > 1 || links[0]?.external) return unsupported();
  return links[0]?.target;
}
function samePart(historical: ReadWorkbook, current: ReadWorkbook, name: string): void {
  const before = historical.parts.get(name), after = current.parts.get(name);
  if (before === undefined ? after !== undefined : !after || !before.equals(after)) unsupported();
}

/** Standalone template qualification, not a new UI capability or lineage guess.
 * Existing source writers may append global style components, but every old
 * index must retain its checked XML identity. No historical indices are remapped
 * or silently interpreted through a different current font/string/theme owner. */
export function assertWorkbookSheetResourceContinuity(historical: ReadWorkbook, current: ReadWorkbook): void {
  assertWorkbookSheetsSupported(historical); assertWorkbookSheetsSupported(current);
  if (historical.model.date1904 !== current.model.date1904) unsupported();
  samePart(historical, current, 'xl/sharedStrings.xml');
  const oldTheme = theme(historical), newTheme = theme(current);
  if (oldTheme !== newTheme) unsupported(); if (oldTheme) samePart(historical, current, oldTheme);
  if (!historical.parts.has('xl/styles.xml') || !current.parts.has('xl/styles.xml')) unsupported();
  const oldRoot = xmlPart(historical.parts, 'xl/styles.xml').documentElement!, newRoot = xmlPart(current.parts, 'xl/styles.xml').documentElement!;
  if (oldRoot.localName !== 'styleSheet' || signature(oldRoot.cloneNode(false) as Element) !== signature(newRoot.cloneNode(false) as Element)) unsupported();
  const before = indexed(oldRoot), after = indexed(newRoot), oldEntries = new Map<string, Element[]>(), newEntries = new Map<string, Element[]>();
  for (const [name, tag] of collections) {
    const oldContainer = before.get(name), newContainer = after.get(name), oldItems = entries(oldContainer, tag), newItems = entries(newContainer, tag);
    if (critical.has(name) && (!oldItems.length || !newItems.length)) unsupported();
    if (oldContainer && (!newContainer || shell(oldContainer) !== shell(newContainer)) || newItems.length < oldItems.length) unsupported();
    for (const [index, item] of oldItems.entries()) if (signature(item) !== signature(newItems[index]!)) unsupported();
    oldEntries.set(name, oldItems); newEntries.set(name, newItems);
  }
  for (const [name, node] of before) if (!collections.has(name) && (!after.has(name) || signature(node) !== signature(after.get(name)!))) unsupported();
  for (const name of after.keys()) if (!before.has(name) && !collections.has(name)) unsupported();
  // Appended identities must be unambiguous too: an appended numFmt can
  // otherwise shadow a retained ID while every old prefix node stays intact.
  for (const tables of [oldEntries, newEntries]) {
    const custom = new Set<number>();
    for (const format of tables.get('numFmts')!) {
      const id = integer(format.getAttribute('numFmtId'));
      if (id < 164 || custom.has(id) || format.getAttribute('formatCode') === null) unsupported(); custom.add(id);
    }
    const styleXfs = tables.get('cellStyleXfs')!, cellXfs = tables.get('cellXfs')!;
    for (const xf of [...styleXfs, ...cellXfs]) {
      for (const [attribute, table] of [['fontId', 'fonts'], ['fillId', 'fills'], ['borderId', 'borders'], ['xfId', 'cellStyleXfs']] as const) if (integer(xf.getAttribute(attribute), 0) >= tables.get(table)!.length) unsupported();
      const format = integer(xf.getAttribute('numFmtId'), 0); if (format >= 164 && !custom.has(format)) unsupported();
    }
    const names = new Set<string>(), builtins = new Set<number>();
    for (const style of tables.get('cellStyles')!) {
      const name = style.getAttribute('name')?.toLowerCase() ?? unsupported();
      if (!name || names.has(name) || integer(style.getAttribute('xfId'), 0) >= styleXfs.length) unsupported(); names.add(name);
      if (style.hasAttribute('builtinId')) { const id = integer(style.getAttribute('builtinId')); if (builtins.has(id)) unsupported(); builtins.add(id); }
    }
  }
  const cellXfs = oldEntries.get('cellXfs')!;
  const strings = historical.parts.has('xl/sharedStrings.xml') ? children(xmlPart(historical.parts, 'xl/sharedStrings.xml').documentElement!, 'si').length : 0;
  const styleIndex = (value: string | null) => { if (value !== null && integer(value) >= cellXfs.length) unsupported(); };
  for (const part of historical.sheetParts.values()) {
    const root = xmlPart(historical.parts, part).documentElement!, data = child(root, 'sheetData');
    for (const column of child(root, 'cols') ? children(child(root, 'cols')!, 'col') : []) styleIndex(column.getAttribute('style'));
    for (const row of data ? children(data, 'row') : []) {
      styleIndex(row.getAttribute('s'));
      for (const cell of children(row, 'c')) {
        styleIndex(cell.getAttribute('s'));
        if (cell.getAttribute('t') === 's' && integer(child(cell, 'v')?.textContent ?? null) >= strings) unsupported();
      }
    }
  }
}
