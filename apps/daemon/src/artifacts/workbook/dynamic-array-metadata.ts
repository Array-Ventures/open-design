import type { Element } from '@xmldom/xmldom';
import { WorkbookFormatError } from './package.js';
import type { ReadWorkbook } from './reader.js';
import { MAIN_NAMESPACES, address, child, children, relationships, xmlPart } from './parts.js';
import { writeWorkbookXml } from './xml.js';
import { formulaCellKey } from './formula-cache-policy.js';

const METADATA_RELATIONSHIPS = new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata', 'http://purl.oclc.org/ooxml/officeDocument/relationships/sheetMetadata']);
const DYNAMIC_NS = 'http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray';
const DYNAMIC_EXT = '{BDBB8CDC-FA1E-496E-A857-3C3F30C029C3}';
const fail = () => new WorkbookFormatError('Dynamic array metadata is not supported or is ambiguous. Source metadata is preserved.', 'WORKBOOK_UNSUPPORTED');
function index(element: Element, name: string, offset: number): number {
  const raw = element.getAttribute(name);
  if (!raw || !/^(0|[1-9][0-9]*)$/.test(raw)) throw fail();
  const value = Number(raw) - offset;
  if (!Number.isSafeInteger(value) || value < 0) throw fail();
  return value;
}
function only(element: Element, name: string): Element {
  const values = children(element, name); if (values.length !== 1) throw fail(); return values[0]!;
}
function exactChildren(element: Element, name: string): Element[] {
  const values = children(element, name);
  if (Array.from(element.childNodes).filter(node => node.nodeType === 1).length !== values.length) throw fail();
  return values;
}
function single(element: Element, name: string): Element {
  const values = exactChildren(element, name); if (values.length !== 1) throw fail(); return values[0]!;
}
function dynamicRecord(future: Element): void {
  const extension = single(single(future, 'extLst'), 'ext');
  if (extension.getAttribute('uri') !== DYNAMIC_EXT) throw fail();
  const values = Array.from(extension.childNodes).filter((node): node is Element => node.nodeType === 1);
  const properties = values[0];
  if (values.length !== 1 || properties?.namespaceURI !== DYNAMIC_NS || properties.localName !== 'dynamicArrayProperties' || !['1', 'true'].includes(properties.getAttribute('fDynamic') ?? '') || !['0', 'false'].includes(properties.getAttribute('fCollapsed') ?? '0') || Array.from(properties.childNodes).some(node => node.nodeType === 1)) throw fail();
  if (Array.from(properties.attributes).some(attribute => attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !['fDynamic', 'fCollapsed'].includes(attribute.name))) throw fail();
}
/** Resolve the actual OOXML cell metadata chain. Neither function names nor
 * t=array identify a dynamic owner. Unsupported metadata is never normalized. */
export function verifiedDynamicArrayOwners(source: ReadWorkbook): Set<string> {
  const result = new Set<string>();
  const metadata = [...relationships(source.parts, 'xl/workbook.xml').values()].filter(rel => METADATA_RELATIONSHIPS.has(rel.type));
  let root: Element | undefined;
  if (metadata.length) {
    if (metadata.length !== 1 || metadata[0]!.external) throw fail();
    root = xmlPart(source.parts, metadata[0]!.target).documentElement ?? undefined;
    if (!root || root.localName !== 'metadata') throw fail();
  }
  const types = root ? exactChildren(only(root, 'metadataTypes'), 'metadataType') : [];
  const records = root ? exactChildren(only(root, 'cellMetadata'), 'bk') : [];
  const futures = root ? children(root, 'futureMetadata') : [];
  if (root) {
    if (!MAIN_NAMESPACES.has(root.namespaceURI ?? '') || types.length !== 1 || types.some(type => type.getAttribute('name') !== 'XLDAPR' || !['1', 'true'].includes(type.getAttribute('cellMeta') ?? '')) || futures.length !== 1 || futures[0]!.getAttribute('name') !== 'XLDAPR') throw fail();
    for (const [container, entries] of [[only(root, 'metadataTypes'), types], [only(root, 'cellMetadata'), records], [futures[0]!, children(futures[0]!, 'bk')]] as const) if (container.hasAttribute('count') && index(container, 'count', 0) !== entries.length) throw fail();
    for (const element of Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1)) if (element.namespaceURI !== root.namespaceURI || !['metadataTypes', 'cellMetadata', 'futureMetadata'].includes(element.localName ?? '')) throw fail();
  }
  const futureRecords = futures[0] ? exactChildren(futures[0], 'bk') : [];
  for (const future of futureRecords) dynamicRecord(future);
  for (const record of records) {
    const rc = single(record, 'rc');
    if (!types[index(rc, 't', 1)] || !futureRecords[index(rc, 'v', 0)]) throw fail();
  }
  for (const sheet of source.model.sheets) {
    const owners = new Map((sheet.arrayFormulas ?? []).map(owner => [`${owner.row}:${owner.column}`, owner]));
    const data = child(xmlPart(source.parts, source.sheetParts.get(sheet.id)!).documentElement!, 'sheetData');
    for (const row of data ? children(data, 'row') : []) for (const cell of children(row, 'c')) {
      if (cell.hasAttribute('vm')) throw fail();
      if (!cell.hasAttribute('cm')) continue;
      if (!root) throw fail();
      const position = address(cell.getAttribute('r')!), owner = owners.get(`${position.row}:${position.column}`);
      if (!owner || owner.kind !== 'array') throw fail();
      const cm = index(cell, 'cm', 1);
      if (!records[cm]) throw fail();
      result.add(formulaCellKey(sheet.id, owner.row, owner.column));
    }
  }
  return result;
}

/** New owners share one immutable dynamic-property record. Never renumber or
 * append through an unknown metadata graph. Existing richer metadata continues
 * to be preserved and its new-owner save is refused. */
export function ensureDynamicArrayMetadata(source: ReadWorkbook, output: Map<string, Buffer>): number {
  verifiedDynamicArrayOwners(source);
  const found = [...relationships(source.parts, 'xl/workbook.xml').values()].filter(rel => METADATA_RELATIONSHIPS.has(rel.type));
  if (found.length) {
    const root = xmlPart(source.parts, found[0]!.target).documentElement!;
    const types = exactChildren(only(root, 'metadataTypes'), 'metadataType'), records = exactChildren(only(root, 'cellMetadata'), 'bk'), futures = children(root, 'futureMetadata');
    if (types.length !== 1 || records.length !== 1 || futures.length !== 1 || children(futures[0]!, 'bk').length !== 1) throw fail();
    return 1;
  }
  if (output.has('xl/metadata.xml') || xmlPart(source.parts, 'xl/workbook.xml').documentElement!.namespaceURI !== 'http://schemas.openxmlformats.org/spreadsheetml/2006/main') throw fail();
  const contentTypes = xmlPart(output, '[Content_Types].xml'), contentRoot = contentTypes.documentElement!;
  if (children(contentRoot, 'Override').some(item => item.getAttribute('PartName') === '/xl/metadata.xml')) throw fail();
  const content = contentTypes.createElementNS(contentRoot.namespaceURI, contentRoot.prefix ? `${contentRoot.prefix}:Override` : 'Override');
  content.setAttribute('PartName', '/xl/metadata.xml'); content.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml'); contentRoot.appendChild(content);
  const relPath = 'xl/_rels/workbook.xml.rels', rels = xmlPart(output, relPath), relRoot = rels.documentElement!;
  const identities = new Set(children(relRoot, 'Relationship').map(item => item.getAttribute('Id')));
  let id = 'evebotArrayMetadata'; for (let index = 1; identities.has(id); index++) id = `evebotArrayMetadata${index}`;
  const rel = rels.createElementNS(relRoot.namespaceURI, relRoot.prefix ? `${relRoot.prefix}:Relationship` : 'Relationship');
  rel.setAttribute('Id', id); rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata'); rel.setAttribute('Target', 'metadata.xml'); relRoot.appendChild(rel);
  output.set(relPath, writeWorkbookXml(rels)); output.set('[Content_Types].xml', writeWorkbookXml(contentTypes));
  output.set('xl/metadata.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="${DYNAMIC_NS}"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="${DYNAMIC_EXT}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>`));
  return 1;
}
