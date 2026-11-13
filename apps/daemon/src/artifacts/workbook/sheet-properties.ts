import type { WorkbookSheetProjection } from '@open-design/contracts/runtime/workbook';
import type { ReadWorkbook } from './reader.js';
import { children, xmlPart } from './parts.js';
import { WorkbookFormatError } from './package.js';
import { writeWorkbookXml } from './xml.js';

/** Only the ordinary Worksheets heading/title vector is owned. Other vector
 * categories can contain names/references and require their own adapter. */
export function patchWorkbookSheetProperties(source: ReadWorkbook, target: WorkbookSheetProjection): Buffer | undefined {
  if (!source.parts.has('docProps/app.xml')) return undefined;
  const document = xmlPart(source.parts, 'docProps/app.xml'), root = document.documentElement!;
  const unsupported = () => new WorkbookFormatError('Extended worksheet title metadata needs its own writer.', 'WORKBOOK_UNSUPPORTED');
  if (root.localName !== 'Properties' || root.namespaceURI !== 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties') throw unsupported();
  const heading = children(root, 'HeadingPairs'), titles = children(root, 'TitlesOfParts');
  if (!heading.length && !titles.length) return undefined;
  if (heading.length !== 1 || titles.length !== 1) throw unsupported();
  const elements = (element: ElementLike) => Array.from(element.childNodes).filter((node): node is import('@xmldom/xmldom').Element => node.nodeType === 1);
  const hv = elements(heading[0]!), tv = elements(titles[0]!);
  const vt = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
  if (hv.length !== 1 || tv.length !== 1 || hv[0]!.localName !== 'vector' || tv[0]!.localName !== 'vector' || hv[0]!.namespaceURI !== vt || tv[0]!.namespaceURI !== vt) throw unsupported();
  const pairs = elements(hv[0]!), names = elements(tv[0]!);
  const attributes = (element: ElementLike, allowed: readonly string[] = []) => {
    for (const attribute of Array.from(element.attributes)) if (attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && (attribute.namespaceURI || !allowed.includes(attribute.name))) throw unsupported();
  };
  const textOnly = (element: ElementLike) => {
    attributes(element);
    if (Array.from(element.childNodes).some(node => node.nodeType !== 3 && node.nodeType !== 4)) throw unsupported();
  };
  const containerOnly = (element: ElementLike) => {
    if (Array.from(element.childNodes).some(node => node.nodeType !== 1 && (node.nodeType !== 3 || Boolean(node.textContent?.trim())))) throw unsupported();
  };
  for (const container of [heading[0]!, titles[0]!, hv[0]!, tv[0]!, ...pairs]) containerOnly(container);
  for (const wrapper of [heading[0]!, titles[0]!]) attributes(wrapper);
  for (const vector of [hv[0]!, tv[0]!]) attributes(vector, ['size', 'baseType']);
  for (const variant of pairs) attributes(variant);
  for (const name of names) textOnly(name);

  if (hv[0]!.getAttribute('baseType') !== 'variant' || pairs.length !== 2 || hv[0]!.getAttribute('size') !== '2' || pairs.some(pair => pair.localName !== 'variant' || pair.namespaceURI !== vt)) throw unsupported();
  const label = elements(pairs[0]!), count = elements(pairs[1]!);
  for (const value of [...label, ...count]) textOnly(value);
  if (label.length !== 1 || count.length !== 1 || label[0]!.namespaceURI !== vt || count[0]!.namespaceURI !== vt || label[0]!.localName !== 'lpstr' || label[0]!.textContent !== 'Worksheets' || count[0]!.localName !== 'i4' || Number(count[0]!.textContent) !== source.model.sheets.length || tv[0]!.getAttribute('baseType') !== 'lpstr' || Number(tv[0]!.getAttribute('size')) !== source.model.sheets.length || names.length !== source.model.sheets.length || names.some((name, index) => name.namespaceURI !== vt || name.localName !== 'lpstr' || name.textContent !== source.model.sheets[index]!.name)) throw unsupported();
  count[0]!.textContent = String(target.length);
  for (const name of names) tv[0]!.removeChild(name);
  tv[0]!.setAttribute('size', String(target.length));
  for (const sheet of target) {
    const name = document.createElementNS(vt, `${tv[0]!.prefix ? tv[0]!.prefix + ':' : ''}lpstr`);
    name.textContent = sheet.name; tv[0]!.appendChild(name);
  }
  return writeWorkbookXml(document);
}
type ElementLike = import('@xmldom/xmldom').Element;
