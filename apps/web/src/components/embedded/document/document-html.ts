import { documentImportStyles } from './document-styles';
import { localDocumentImageSource, dataDocumentImageSource } from './document-image-source';
import DOMPurify from 'dompurify';

const tags = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'br', 'span', 'code', 'pre', 'hr', 'img'];


export function isDocumentLinkSupported(href: string): boolean {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(href, 'https://document.invalid/').protocol); }
  catch { return false; }
}

/** Import semantic document content into the editor, never an authored application runtime. */
export function documentImport(html: string): Document {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: tags, ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan', 'start', 'style', 'data-od-id', 'data-language', 'data-highlight-language', '__lexicallisttype', 'aria-checked', 'src', 'alt', 'width', 'height', 'dir', 'value', 'data-eve-document-image'],
    RETURN_DOM_FRAGMENT: true,
  });
  for (const image of fragment.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? '';
    if (!localDocumentImageSource(src) && !dataDocumentImageSource(src)) image.remove();
  }
  for (const element of fragment.querySelectorAll<HTMLElement>('[style]')) {
    // Read authored declarations rather than CSSOM-expanded longhands: an unsafe
    // background shorthand must not synthesize an admitted transparent color.
    const properties = (element.getAttribute('style') ?? '').split(';').flatMap(declaration => {
      const colon = declaration.indexOf(':');
      if (colon < 1) return [];
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const pattern = documentImportStyles.get(name);
      if (!pattern) return [];
      const probe = document.createElement('span').style;
      probe.cssText = declaration;
      const value = probe.getPropertyValue(name).trim();
      return pattern.test(value) ? [[name, value]] : [];
    });
    element.removeAttribute('style');
    for (const [name, value] of properties) element.style.setProperty(name!, value!);
  }
  // Lexical imports PRE as a code block already; a multiline CODE wrapper would create a second block.
  for (const code of fragment.querySelectorAll('pre > code')) code.replaceWith(...code.childNodes);
  for (const link of fragment.querySelectorAll('a')) {
    const href = link.getAttribute('href') ?? '';
    if (!isDocumentLinkSupported(href)) link.removeAttribute('href');
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  const imported = new DOMParser().parseFromString('<!doctype html><html><body></body></html>', 'text/html');
  imported.body.append(imported.importNode(fragment, true));
  return imported;
}

export { documentFontFamily, documentHtml } from '@open-design/contracts/runtime/document';

export function isEditableDocument(html: string): boolean {
  return new DOMParser().parseFromString(html, 'text/html').documentElement.getAttribute('data-eve-document') === '1';
}
