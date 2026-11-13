import type { Document, Element } from '@xmldom/xmldom';
import type { WorkbookCell, WorkbookFont } from '@open-design/contracts/runtime/workbook';
import { child, children } from './parts.js';
import { WorkbookFormatError } from './package.js';
const xmlSpace = 'http://www.w3.org/XML/1998/namespace';
const known = new Set(['rFont', 'family', 'sz', 'b', 'i', 'strike', 'u', 'vertAlign', 'color']);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
function element(doc: Document, parent: Element, name: string) {
  return doc.createElementNS(parent.namespaceURI, parent.prefix ? `${parent.prefix}:${name}` : name);
}
/** OOXML ST_Xstring escaping is distinct from XML escaping. One-pass decoding
 * keeps literal escape-shaped text distinct from encoded characters. */
export function decodeSpreadsheetText(text: string): string {
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
function encodeSpreadsheetText(text: string) {
  return text.replace(/_x[0-9A-Fa-f]{4}_/g, (match) => `_x005F_${match.slice(1)}`).replaceAll('\r', '_x000D_');
}
export function sourceRichFont(run: Element): WorkbookFont | undefined {
  const properties = child(run, 'rPr');
  if (!properties) return;
  const font: WorkbookFont = {};
  const value = (name: string) => child(properties, name)?.getAttribute('val');
  const number = (text: string) => {
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n)) throw new WorkbookFormatError('Invalid rich font number.');
    return n;
  };
  const name = value('rFont'),
    family = value('family'),
    size = value('sz');
  if (name != null) font.name = decodeSpreadsheetText(name);
  if (family != null) font.family = number(family);
  if (size != null) font.size = number(size);
  for (const [element, property] of [
    ['b', 'bold'],
    ['i', 'italic'],
    ['strike', 'strike'],
  ] as const)
    if (child(properties, element)) {
      const flag = value(element);
      if (flag != null && !['0', '1', 'false', 'true'].includes(flag))
        throw new WorkbookFormatError('Invalid rich font boolean.');
      font[property] = flag == null || flag === '1' || flag === 'true';
    }
  const underline = child(properties, 'u');
  if (underline) {
    const kind = underline.getAttribute('val') ?? 'single';
    if (['none', 'single', 'double', 'singleAccounting', 'doubleAccounting'].includes(kind))
      font.underline = kind as WorkbookFont['underline'];
  }
  const vertical = value('vertAlign');
  if (vertical === 'baseline' || vertical === 'superscript' || vertical === 'subscript') font.vertical = vertical;
  const color = child(properties, 'color');
  if (color) {
    const rgb = color.getAttribute('rgb'),
      theme = color.getAttribute('theme'),
      indexed = color.getAttribute('indexed'),
      auto = color.getAttribute('auto'),
      tint = color.getAttribute('tint');
    const shade = tint == null ? {} : { tint: number(tint) };
    if (rgb != null) font.color = { kind: 'rgb', argb: rgb.length === 6 ? `FF${rgb}` : rgb, ...shade };
    else if (theme != null) font.color = { kind: 'theme', index: number(theme), ...shade };
    else if (indexed != null) font.color = { kind: 'indexed', index: number(indexed), ...shade };
    else if (auto === '1' || auto === 'true') font.color = { kind: 'auto' };
  }
  return font;
}
function represented(properties: Element): boolean {
  if (properties.attributes.length) return false;
  const seen = new Set<string>();
  for (const node of Array.from(properties.childNodes)) {
    if (node.nodeType !== 1) continue;
    const item = node as Element,
      name = item.localName ?? '';
    if (
      item.namespaceURI !== properties.namespaceURI ||
      !known.has(name) ||
      seen.has(name) ||
      Array.from(item.childNodes).some((node) => node.nodeType === 1)
    )
      return false;
    seen.add(name);
    const allowed = name === 'color' ? new Set(['rgb', 'theme', 'indexed', 'auto', 'tint']) : new Set(['val']);
    if (
      Array.from(item.attributes).some(
        (attribute) => attribute.namespaceURI || !allowed.has(attribute.localName ?? attribute.name),
      )
    )
      return false;
    if (
      name === 'u' &&
      item.hasAttribute('val') &&
      !['none', 'single', 'double', 'singleAccounting', 'doubleAccounting'].includes(item.getAttribute('val')!)
    )
      return false;
    if (name === 'vertAlign' && !['baseline', 'superscript', 'subscript'].includes(item.getAttribute('val') ?? ''))
      return false;
    if (
      name === 'color' &&
      (['rgb', 'theme', 'indexed', 'auto'].filter((key) => item.hasAttribute(key)).length !== 1 ||
        (item.hasAttribute('auto') && item.hasAttribute('tint')))
    )
      return false;
  }
  return true;
}
function fontProperties(doc: Document, parent: Element, font: WorkbookFont): Element {
  const properties = element(doc, parent, 'rPr');
  const set = (name: string, value: string) => {
    const item = element(doc, parent, name);
    item.setAttribute('val', value);
    properties.appendChild(item);
  };
  if (font.name !== undefined) set('rFont', encodeSpreadsheetText(font.name));
  if (font.family !== undefined) set('family', String(font.family));
  if (font.bold !== undefined) set('b', font.bold ? '1' : '0');
  if (font.italic !== undefined) set('i', font.italic ? '1' : '0');
  if (font.strike !== undefined) set('strike', font.strike ? '1' : '0');
  if (font.color) {
    const color = element(doc, parent, 'color'),
      value = font.color;
    if (value.kind === 'auto') color.setAttribute('auto', '1');
    else {
      color.setAttribute(
        value.kind === 'rgb' ? 'rgb' : value.kind === 'theme' ? 'theme' : 'indexed',
        value.kind === 'rgb' ? value.argb : String(value.index),
      );
      if (value.tint !== undefined) color.setAttribute('tint', String(value.tint));
    }
    properties.appendChild(color);
  }
  if (font.size !== undefined) set('sz', String(font.size));
  if (font.underline !== undefined) set('u', font.underline);
  if (font.vertical !== undefined) set('vertAlign', font.vertical);
  return properties;
}
/** Rich runs live inline in the edited cell. Shared-string aliases and table
 * counts remain immutable. Unknown source run properties survive exact-font,
 * same-run edits; ambiguous authored formatting is refused before mutation. */
export function writeRichCell(
  doc: Document,
  target: Element,
  value: Extract<WorkbookCell, { kind: 'string' }>,
  previous: WorkbookCell | undefined,
  sourceText?: Element,
): Element {
  const inline = element(doc, target, 'is'),
    sourceRuns = sourceText ? children(sourceText, 'r') : [],
    oldRuns = previous?.kind === 'string' ? previous.runs : undefined;
  if (
    sourceText &&
    Array.from(sourceText.childNodes).some(
      (node) =>
        node.nodeType === 1 &&
        (!['r', 't'].includes((node as Element).localName ?? '') || node.namespaceURI !== sourceText.namespaceURI),
    )
  )
    throw new WorkbookFormatError(
      'Phonetic or annotated rich text needs its own edit adapter.',
      'WORKBOOK_UNSUPPORTED',
    );
  if (
    sourceRuns.some((run) =>
      Array.from(run.childNodes).some(
        (node) =>
          node.nodeType === 1 &&
          (!['rPr', 't'].includes((node as Element).localName ?? '') || node.namespaceURI !== run.namespaceURI),
      ),
    )
  )
    throw new WorkbookFormatError('Annotated rich runs need their own edit adapter.', 'WORKBOOK_UNSUPPORTED');
  const preserve =
    sourceRuns.length === value.runs!.length &&
    oldRuns?.length === value.runs!.length &&
    value.runs!.every((run, index) => same(run.font, oldRuns[index]!.font));
  if (
    !preserve &&
    sourceRuns.some((run) => {
      const properties = child(run, 'rPr');
      return properties && !represented(properties);
    })
  )
    throw new WorkbookFormatError(
      'Unrepresented source run formatting cannot be replaced safely.',
      'WORKBOOK_UNSUPPORTED',
    );
  for (const [index, valueRun] of value.runs!.entries()) {
    const run =
      preserve && sourceRuns[index] ? (doc.importNode(sourceRuns[index]!, true) as Element) : element(doc, target, 'r');
    if (!preserve && valueRun.font && Object.keys(valueRun.font).length)
      run.appendChild(fontProperties(doc, target, valueRun.font));
    for (const oldText of children(run, 't')) run.removeChild(oldText);
    const text = element(doc, target, 't');
    text.setAttributeNS(xmlSpace, 'xml:space', 'preserve');
    text.appendChild(doc.createTextNode(encodeSpreadsheetText(valueRun.text)));
    run.appendChild(text);
    inline.appendChild(run);
  }
  return inline;
}
