import path from 'node:path';
import type { Document, Element } from '@xmldom/xmldom';
import { WorkbookFormatError, type WorkbookParts } from './package.js';
import { parseWorkbookXml } from './xml.js';

export const MAIN_NAMESPACES = new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main']);
export function children(parent: Element, name: string): Element[] {
  return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1 && node.localName === name && node.namespaceURI === parent.namespaceURI);
}
export function child(parent: Element, name: string): Element | undefined { return children(parent, name)[0]; }
export function xmlPart(parts: WorkbookParts, name: string): Document {
  const bytes = parts.get(name);
  if (!bytes) throw new WorkbookFormatError('Workbook relationship points to a missing part.');
  return parseWorkbookXml(bytes);
}
/** Resolve package relationships only; never interpret a target as a filesystem
 * path or fetch an external relationship. */
export function relationshipTarget(source: string, target: string): string {
  if (/[\\\u0000-\u001f?#]/.test(target)) throw new WorkbookFormatError('Invalid workbook relationship.');
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { throw new WorkbookFormatError('Invalid workbook relationship.'); }
  if (!decoded || decoded.startsWith('//') || /[\\\u0000-\u001f]/.test(decoded) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)) throw new WorkbookFormatError('Invalid workbook relationship.');
  const resolved = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(source), decoded));
  if (!resolved || resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) throw new WorkbookFormatError('Workbook relationship escapes its package.');
  return resolved;
}
export function relationships(parts: WorkbookParts, source: string): Map<string, { type: string; target: string; external: boolean }> {
  const name = source ? path.posix.join(path.posix.dirname(source), '_rels', path.posix.basename(source) + '.rels') : '_rels/.rels';
  const root = xmlPart(parts, name).documentElement;
  if (!root || root.localName !== 'Relationships' || !['http://schemas.openxmlformats.org/package/2006/relationships', 'http://purl.oclc.org/ooxml/package/relationships'].includes(root.namespaceURI ?? '')) throw new WorkbookFormatError('Invalid workbook relationships.');
  const result = new Map<string, { type: string; target: string; external: boolean }>();
  for (const item of children(root, 'Relationship')) {
    const id = item.getAttribute('Id'), type = item.getAttribute('Type'), target = item.getAttribute('Target');
    if (!id || !type || !target || result.has(id)) throw new WorkbookFormatError('Invalid workbook relationship identity.');
    const external = item.getAttribute('TargetMode') === 'External';
    result.set(id, { type, target: external ? target : relationshipTarget(source, target), external });
  }
  return result;
}
export function address(value: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/i.exec(value);
  if (!match) throw new WorkbookFormatError('Invalid workbook cell address.');
  let column = 0;
  for (const letter of match[1]!.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column > 16384 || row > 1048576) throw new WorkbookFormatError('Workbook cell address exceeds the worksheet limit.');
  return { row: row - 1, column: column - 1 };
}
export function range(value: string) {
  const pieces = value.split(':');
  if (pieces.length > 2) throw new WorkbookFormatError('Invalid workbook range.');
  const start = address(pieces[0]!), end = address(pieces[1] ?? pieces[0]!);
  return { startRow: start.row, startColumn: start.column, endRow: end.row, endColumn: end.column };
}
