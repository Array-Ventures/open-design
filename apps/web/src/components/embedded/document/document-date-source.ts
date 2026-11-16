import { documentDateAttributes, readDocumentDate, type DocumentDate } from '@open-design/contracts/runtime/document';
export { documentDateAttributes } from '@open-design/contracts/runtime/document';
/** Admit the complete atom before sanitizing; unknown attributes/content must not disappear. */
export function readDocumentDateElement(element: Element): DocumentDate | null {
  if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || element.tagName !== 'TIME' || element.getAttribute('data-eve-document-date') !== '1'
    || element.closest('pre,code') || !element.closest('p,h1,h2,h3,h4,h5,h6,li,td,th')
    || [...element.childNodes].some(node => node.nodeType !== 3) || element.children.length || [...element.attributes].some(attribute => !documentDateAttributes.includes(attribute.name as typeof documentDateAttributes[number]))) return null;
  return readDocumentDate({ iso: element.getAttribute('datetime'), locale: element.getAttribute('data-eve-date-locale'), label: element.textContent });
}
export function documentDateElement(value: DocumentDate): HTMLTimeElement {
  const data = readDocumentDate(value);
  if (!data) throw Error('This date could not be preserved.');
  const element = document.createElement('time');
  element.setAttribute('data-eve-document-date', '1'); element.setAttribute('datetime', data.iso);
  element.setAttribute('data-eve-date-locale', data.locale); element.textContent = data.label;
  return element;
}
