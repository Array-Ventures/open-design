import type { Element, Node } from '@xmldom/xmldom';
import type { DocumentCodeBlockGeometry } from '@open-design/document-style';

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fail = (): never => { throw Error('The document converter could not preserve authored presentation ownership.'); };
const children = (element: Element, name: string) => Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === word && (node as Element).localName === name);

/** Called only after the existing bookmark stack proves one complete owned
 * SourceCode paragraph. Text equality validates that binding; it never selects
 * a paragraph by its text or position. All unrelated native properties survive. */
export function projectDocumentCodeBlock(paragraph: Element, value: DocumentCodeBlockGeometry, expectedText: string,
  property: (paragraph: Element, name: 'spacing' | 'ind') => Element): void {
  const pPr = children(paragraph, 'pPr'), style = pPr[0] && children(pPr[0], 'pStyle');
  if (pPr.length !== 1 || style?.length !== 1 || style[0]!.getAttributeNS(word, 'val') !== 'SourceCode') return fail();
  const align = children(pPr[0]!, 'jc'), contextual = children(pPr[0]!, 'contextualSpacing');
  if (align.some(item => !['left', 'start'].includes(item.getAttributeNS(word, 'val') ?? ''))
    || contextual.some(item => !['0', 'false', 'off'].includes(item.getAttributeNS(word, 'val') ?? 'true'))) return fail();
  let text = '';
  const read = (node: Node): void => {
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.namespaceURI !== word) return fail();
    if (['pPr', 'rPr', 'bookmarkStart', 'bookmarkEnd'].includes(element.localName ?? '')) return;
    if (element.localName === 't') { text += element.textContent ?? ''; return; }
    if (element.localName === 'softHyphen') {
      if (element.attributes.length) return fail();
      text += '\u00ad'; return;
    }
    if (element.localName === 'br') {
      if (element.attributes.length) return fail();
      text += '\n'; return;
    }
    if (!['p', 'r'].includes(element.localName ?? '')) return fail();
    for (const child of Array.from(element.childNodes)) read(child);
  };
  read(paragraph);
  if (!expectedText.trim() || text !== expectedText || text.split('\n').length !== value.codeBlockLineCount) return fail();
  const indent = property(paragraph, 'ind');
  if (Array.from(indent.attributes).some(attribute => attribute.namespaceURI !== word
    || !['left', 'right'].includes(attribute.localName ?? '') || Number(attribute.value) !== 0)) return fail();
  indent.setAttributeNS(word, 'w:left', String(Math.round(value.codeBlockStartPt * 20)));
  indent.setAttributeNS(word, 'w:right', String(Math.round(value.codeBlockEndPt * 20)));
  const spacing = property(paragraph, 'spacing');
  spacing.setAttributeNS(word, 'w:before', String(Math.round(value.codeBlockBeforePt * 20)));
  spacing.setAttributeNS(word, 'w:after', String(Math.round(value.codeBlockAfterPt * 20)));
  spacing.setAttributeNS(word, 'w:beforeAutospacing', '0');
  spacing.setAttributeNS(word, 'w:afterAutospacing', '0');
}
