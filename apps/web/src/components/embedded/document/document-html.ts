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

export const documentFontFamily = (font: 'sans' | 'serif'): string => font === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif';

/** Standalone content styling also works in isolated HTML/PDF/Word conversion. */
export function documentHtml(title: string, body: string, font: 'sans' | 'serif' = 'sans', headingFont: 'sans' | 'serif' = 'serif'): string {
  const escaped = title.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  return `<!doctype html><html data-eve-document="1" data-eve-document-font="${font}" data-eve-document-heading-font="${headingFont}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaped}</title><style>body{margin:0;padding:64px 52px;background:Canvas;color:CanvasText;font:16px/1.5 ${documentFontFamily(font)}}main{max-width:720px;margin:0 auto}p{margin:0 0 1em}h1,h2,h3,h4,h5,h6{font-family:${documentFontFamily(headingFont)};line-height:1.25;margin:1.4em 0 .6em}h1{font-size:2em;line-height:40px;margin:24px 0 16px}h2{font-size:1.5em;line-height:32px;margin:24px 0 12px}h3{font-size:1.25em;line-height:28px;margin:24px 0 12px}main>:first-child{margin-top:0}ul,ol{padding-inline-start:24px;margin-block:16px}table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid GrayText;padding:8px;vertical-align:top}td p,th p{margin:0}blockquote{border-inline-start:3px solid GrayText;margin-inline:0;padding-inline-start:16px}a{color:LinkText}pre{overflow-x:auto;white-space:pre;padding:16px;font:14px/1.5 monospace}code{font-family:monospace}ul[__lexicallisttype="check"]{list-style:none}li[aria-checked="true"]::marker{content:"☑ "}li[aria-checked="false"]::marker{content:"☐ "}@media print{body{padding:0}table{break-inside:avoid}}</style></head><body><main>${body}</main></body></html>`;
}

export function isEditableDocument(html: string): boolean {
  return new DOMParser().parseFromString(html, 'text/html').documentElement.getAttribute('data-eve-document') === '1';
}
