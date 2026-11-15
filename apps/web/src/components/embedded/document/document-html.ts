import { documentDateAttributes, readDocumentDateElement } from './document-date-source';
import { suggestionAttributes, validDocumentSuggestions } from './document-suggestion-schema';
import { documentImportStyles } from './document-styles';
import { localDocumentImageSource, dataDocumentImageSource, documentImageCssDimension } from './document-image-source';
import DOMPurify from 'dompurify';
import { findRealTagEnd, HTML_TAG_PATTERNS } from '@open-design/contracts/runtime/html-injection-points';

const tags = ['time', 'ins', 'del', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'br', 'span', 'code', 'pre', 'hr', 'img'];


export function isDocumentLinkSupported(href: string): boolean {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(href, 'https://document.invalid/').protocol); }
  catch { return false; }
}

/** Import semantic document content into the editor, never an authored application runtime. */
export function documentImport(html: string): Document {
  const sourceDates = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('time,[data-eve-document-date],[data-eve-date-locale]');
  if ([...sourceDates].some(element => !readDocumentDateElement(element))) throw Error('Document dates could not be preserved.');
  if (!validDocumentSuggestions(new DOMParser().parseFromString(html, 'text/html').body)) throw Error('Document suggestions could not be preserved.');
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: tags, ALLOWED_ATTR: [...documentDateAttributes, ...suggestionAttributes, 'href', 'title', 'colspan', 'rowspan', 'start', 'style', 'data-od-id', 'data-language', 'data-highlight-language', '__lexicallisttype', 'aria-checked', 'src', 'alt', 'width', 'height', 'dir', 'value', 'data-eve-document-image'],
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
      const imageDimension = element.tagName === 'IMG' && (name === 'width' || name === 'height');
      const pattern = documentImportStyles.get(name);
      if (!pattern && !imageDimension) return [];
      const probe = document.createElement('span').style;
      probe.cssText = declaration;
      const value = probe.getPropertyValue(name).trim();
      return (imageDimension ? documentImageCssDimension(value, name as 'width' | 'height') !== null : pattern!.test(value)) ? [[name, value]] : [];
    });
    element.removeAttribute('style');
    for (const [name, value] of properties) element.style.setProperty(name!, value!);
  }
  // Lexical imports PRE as a code block already; a multiline CODE wrapper would create a second block.
  for (const code of fragment.querySelectorAll<HTMLElement>('pre > code')) {
    // Retain admitted glyph presentation through the existing TextNode importer;
    // keeping CODE itself would create a second block for multiline content.
    if (code.style.length) {
      const span = document.createElement('span');
      span.style.cssText = code.style.cssText;
      span.append(...code.childNodes);
      code.replaceWith(span);
    } else code.replaceWith(...code.childNodes);
  }
  // The pinned Lexical text converter returns an array for PRE newlines/tabs,
  // but its DOM walker applies inherited forChild styles only to the last item.
  // Separate source text boundaries so every actual text run receives its own
  // existing style conversion. No character or visible whitespace is changed.
  for (const pre of fragment.querySelectorAll('pre')) {
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const text of texts) if (/[\n\t]/.test(text.data)) {
      text.replaceWith(...text.data.split(/([\n\t])/).filter(Boolean).map(value => document.createTextNode(value)));
    }
  }
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


export type DocumentRootAttributes = { lang: string | null; dir: 'ltr' | 'rtl' | null };
/** HTML language tags include grandfathered/private-use forms; an empty tag means unknown. */
export function supportedDocumentLanguage(value: string): boolean {
  return value === '' || value.length <= 100 && /^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i.test(value);
}
export function documentRootAttributes(html: string): DocumentRootAttributes {
  const root = new DOMParser().parseFromString(html, 'text/html').documentElement;
  const dir = root.getAttribute('dir');
  return { lang: root.getAttribute('lang'), dir: dir === 'ltr' || dir === 'rtl' ? dir : null };
}
/** Source-owned root metadata survives every save, including unrelated text edits. */
export function preserveDocumentRootAttributes(html: string, attributes: DocumentRootAttributes): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const suffix = `${attributes.lang !== null ? ` lang="${escape(attributes.lang)}"` : ''}${attributes.dir !== null ? ` dir="${attributes.dir}"` : ''}`;
  const end = findRealTagEnd(html, HTML_TAG_PATTERNS.htmlOpen);
  return end < 0 ? html : html.slice(0,end - 1) + suffix + html.slice(end - 1);
}
