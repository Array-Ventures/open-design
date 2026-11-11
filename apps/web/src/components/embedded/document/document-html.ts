import DOMPurify from 'dompurify';

const tags = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'br', 'span', 'code', 'pre', 'hr'];
const safeStyle = new Map([
  ['width', /^(?:[1-9][0-9]{0,3}(?:\.[0-9]+)?px|(?:[1-9][0-9]?|100)(?:\.[0-9]+)?%)$/],
  ['text-align', /^(left|right|center|justify|start|end)$/],
  ['font-weight', /^(normal|bold|[1-9]00)$/],
  ['font-style', /^(normal|italic)$/],
  ['text-decoration', /^(none|underline|line-through)$/],
]);

export function isDocumentLinkSupported(href: string): boolean {
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(href, 'https://document.invalid/').protocol); }
  catch { return false; }
}

/** Import semantic document content into the editor, never an authored application runtime. */
export function documentImport(html: string): Document {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: tags, ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan', 'start', 'style', 'data-od-id', 'data-language', 'data-highlight-language', '__lexicallisttype', 'aria-checked'],
    RETURN_DOM_FRAGMENT: true,
  });
  for (const element of fragment.querySelectorAll<HTMLElement>('[style]')) {
    const properties = [...safeStyle].flatMap(([name, pattern]) => {
      const value = element.style.getPropertyValue(name).trim();
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
  const document = new DOMParser().parseFromString('<!doctype html><html><body></body></html>', 'text/html');
  document.body.append(document.importNode(fragment, true));
  return document;
}

export { documentFontFamily, documentHtml } from '@open-design/contracts/runtime/document';

export function isEditableDocument(html: string): boolean {
  return new DOMParser().parseFromString(html, 'text/html').documentElement.getAttribute('data-eve-document') === '1';
}
