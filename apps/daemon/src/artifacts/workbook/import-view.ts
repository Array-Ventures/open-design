import type { Element } from '@xmldom/xmldom';
import { MAIN_NAMESPACES, xmlPart } from './parts.js';
import { WorkbookFormatError, type WorkbookParts } from './package.js';
import { writeWorkbookXml } from './xml.js';

const XMLNS = 'http://www.w3.org/2000/xmlns/';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const RELATIONSHIPS = new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships']);

/** ExcelJS dispatches lexical SpreadsheetML names instead of expanded names.
 * Give that importer a private canonical view, never the source-patching owner.
 * Only relationship-selected, already bounded SpreadsheetML parts participate.
 * Foreign elements remain prefixed, so local-name lookalikes cannot gain meaning.
 */
export function workbookImportView(parts: WorkbookParts, names: readonly string[]): WorkbookParts {
  const result = new Map(parts);
  const documents = new Map([...new Set(names)].map(name => [name, xmlPart(parts, name)]));
  const vocabulary = new Set(['c', 'v', 'f', 'row', 'sheet', 'xf', 'font', 'si', 't', 'r', 'rPr']);
  for (const document of documents.values()) {
    for (const element of Array.from(document.getElementsByTagName('*'))) {
      if (MAIN_NAMESPACES.has(element.namespaceURI ?? '')) vocabulary.add(element.localName!);
    }
  }
  for (const [name, document] of documents) {
    const root = document.documentElement;
    const expectedRoot = name === 'xl/workbook.xml' ? 'workbook' : name === 'xl/styles.xml' ? 'styleSheet' : name === 'xl/sharedStrings.xml' ? 'sst' : 'worksheet';
    if (!root || root.localName !== expectedRoot || !MAIN_NAMESPACES.has(root.namespaceURI ?? '')) throw new WorkbookFormatError('Invalid workbook importer namespace.');
    let foreign = 0;
    function copy(element: Element, foreignOwner = false): Element {
      const main = MAIN_NAMESPACES.has(element.namespaceURI ?? '');
      if (main && foreignOwner) throw new WorkbookFormatError('Foreign workbook importer ownership.', 'WORKBOOK_UNSUPPORTED');
      if (!element.namespaceURI) throw new WorkbookFormatError('Unqualified workbook importer element.', 'WORKBOOK_UNSUPPORTED');
      if (!main && vocabulary.has(element.localName!)) {
        throw new WorkbookFormatError('Foreign workbook importer element.', 'WORKBOOK_UNSUPPORTED');
      }
      const prefixes = new Map<string, string>();
      const freshPrefix = (namespace: string): string => {
        const existing = prefixes.get(namespace);
        if (existing) return existing;
        let prefix: string;
        do { prefix = `odimport${foreign++}`; } while (element.lookupNamespaceURI(prefix));
        prefixes.set(namespace, prefix);
        return prefix;
      };
      const prefix = main ? '' : freshPrefix(element.namespaceURI);
      const target = document.createElementNS(element.namespaceURI, main ? element.localName! : `${prefix}:${element.localName}`);
      // Keep original bindings for source-owned QName-valued extension data.
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.namespaceURI === XMLNS) target.setAttributeNS(XMLNS, attribute.name, attribute.value);
      }
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.namespaceURI === XMLNS) continue;
        const namespace = attribute.namespaceURI;
        let value = attribute.value;
        if (namespace === MC && ['Ignorable', 'MustUnderstand', 'ProcessContent', 'PreserveElements', 'PreserveAttributes'].includes(attribute.localName!)) {
          const prefixList = ['Ignorable', 'MustUnderstand'].includes(attribute.localName!);
          value = value.trim().split(/\s+/).filter(Boolean).map(token => {
            const colon = token.indexOf(':');
            const oldPrefix = prefixList ? token : colon < 0 ? null : token.slice(0, colon);
            const resolved = element.lookupNamespaceURI(oldPrefix);
            if (!resolved) throw new WorkbookFormatError('Unresolved workbook compatibility namespace.');
            const replacement = freshPrefix(resolved);
            target.setAttributeNS(XMLNS, `xmlns:${replacement}`, resolved);
            return prefixList ? replacement : `${replacement}:${colon < 0 ? token : token.slice(colon + 1)}`;
          }).join(' ');
        }
        if (!namespace) target.setAttribute(attribute.name, value);
        else if (namespace === 'http://www.w3.org/XML/1998/namespace') target.setAttributeNS(namespace, `xml:${attribute.localName}`, value);
        else {
          const attributePrefix = RELATIONSHIPS.has(namespace) ? 'r' : freshPrefix(namespace);
          target.setAttributeNS(namespace, `${attributePrefix}:${attribute.localName}`, value);
          target.setAttributeNS(XMLNS, `xmlns:${attributePrefix}`, namespace);
        }
      }
      if (main) {
        if (element === root || element.hasAttribute('xmlns')) target.setAttributeNS(XMLNS, 'xmlns', element.namespaceURI);
      } else target.setAttributeNS(XMLNS, `xmlns:${prefix}`, element.namespaceURI);
      for (const node of Array.from(element.childNodes)) target.appendChild(node.nodeType === 1 ? copy(node as Element, foreignOwner || !main) : node.cloneNode(true));
      return target;
    }
    document.replaceChild(copy(root), root);
    result.set(name, writeWorkbookXml(document));
  }
  return result;
}

