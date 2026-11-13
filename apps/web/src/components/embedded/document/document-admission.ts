import { documentHtml, isEditableDocument, isDocumentLinkSupported, supportedDocumentLanguage } from './document-html';
import { supportedDocumentImageElement } from './document-image-source';
import { documentImportStyles, documentTextStyles } from './document-styles';
import styles from './DocumentEditor.module.css';

const tags = new Set(['main', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'br', 'span', 'code', 'pre', 'img']);
const canonicalBorderImageDefaults = new Set(['border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat']);
const inline = new Set(['span', 'strong', 'b', 'em', 'i', 'u', 's', 'code']);
const attributes: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'],
  li: ['value', 'role', 'tabindex', 'aria-checked'], ul: ['__lexicallisttype'],
  pre: ['spellcheck', 'data-language', 'data-highlight-language'], span: ['data-eve-document-image'],
};
const editorClasses = new Set(Object.values(styles).flatMap(value => value.split(/\s+/)));
function supportedElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (!tags.has(tag)) return false;
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === 'class' && attribute.value.split(/\s+/).every(value => editorClasses.has(value))) continue;
    if (!['style', 'dir', 'data-od-id', ...(attributes[tag] ?? [])].includes(attribute.name)) return false;
  }
  // Unknown declarations (including invalid CSS that the DOM parser discards) must not vanish on save.
  if (element.hasAttribute('dir') && (!['ltr', 'rtl'].includes(element.getAttribute('dir')!) || !['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'ul', 'ol', 'table', 'tr', 'td', 'th', 'pre'].includes(tag))) return false;
  if (element.hasAttribute('data-od-id') && !/^[A-Za-z0-9_-]{1,100}$/.test(element.getAttribute('data-od-id')!)) return false;
  if (tag === 'a' && element.hasAttribute('target') && element.getAttribute('target') !== '_blank') return false;
  if (tag === 'a' && element.hasAttribute('rel') && element.getAttribute('rel') !== 'noopener noreferrer') return false;
  if (['main', 'div'].includes(tag) && element.attributes.length) return false;
  if (element.hasAttribute('role') && element.getAttribute('role') !== 'checkbox') return false;
  if (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1') return false;
  if (element.hasAttribute('aria-checked') && !['true', 'false'].includes(element.getAttribute('aria-checked')!)) return false;
  if (element.hasAttribute('__lexicallisttype') && element.getAttribute('__lexicallisttype') !== 'check') return false;
  if (element.hasAttribute('data-eve-document-image') && (element.getAttribute('data-eve-document-image') !== '1' || element.children.length !== 1 || element.firstElementChild?.tagName !== 'IMG' || element.textContent?.trim())) return false;
  if (element.hasAttribute('data-od-id') && !['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'ul', 'ol', 'table', 'tr', 'td', 'th', 'pre'].includes(tag) && !element.hasAttribute('data-eve-document-image')) return false;
  if (tag === 'li' && ['role', 'tabindex', 'aria-checked'].some(name => element.hasAttribute(name)) && element.parentElement?.getAttribute('__lexicallisttype') !== 'check') return false;
  for (const name of ['colspan', 'rowspan', 'start', 'value']) {
    if (element.hasAttribute(name) && !/^[1-9]\d*$/.test(element.getAttribute(name)!)) return false;
  }
  // Lexical re-numbers ordered items; only already-sequential exported values are lossless.
  if (tag === 'li' && element.hasAttribute('value') && element.parentElement?.tagName === 'OL') {
    const parent = element.parentElement;
    const index = Array.from(parent.children).filter(child => child.tagName === 'LI').indexOf(element);
    if (Number(element.getAttribute('value')) !== Number(parent.getAttribute('start') ?? 1) + index) return false;
  }
  const rawStyle = element.getAttribute('style') ?? '';
  const canonicalCellBorder = ['td', 'th'].includes(tag) && /^1px solid (?:black|rgb\(0,\s*0,\s*0\))$/.test(element.style.getPropertyValue('border'));

  // CSSOM may expand shorthands (notably border). Validate each authored declaration
  // independently instead of comparing declaration counts with normalized properties.
  for (const declaration of rawStyle.split(';').filter(value => value.trim())) {
    const colon = declaration.indexOf(':');
    if (colon < 1) return false;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const probe = document.createElement('span').style;
    probe.cssText = declaration;
    if (!probe.getPropertyValue(name)) return false;
    // A later default must not hide an earlier authored image or reset.
    if (canonicalBorderImageDefaults.has(name) && (probe.getPropertyValue(name).trim() !== 'initial' || probe.getPropertyPriority(name))) return false;
  }
  for (const name of Array.from(element.style)) {
    const value = element.style.getPropertyValue(name).trim();
    if (element.style.getPropertyPriority(name)) return false;
    // Lexical's own exports add these presentation defaults, regenerated on every save.
    if (inline.has(tag) && name === 'white-space' && value === 'pre-wrap') continue;
    if (canonicalCellBorder && name === 'border-image' && value === 'none') continue;
    // Chromium expands Lexical's border shorthand into these exact reset
    // longhands. Admit only regenerated initial defaults, never authored images.
    if (canonicalCellBorder && canonicalBorderImageDefaults.has(name) && value === 'initial') continue;
    if (canonicalCellBorder && /^border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?$/.test(name)) continue;
    // Flattening text wrappers cannot retain contextual CSS-wide values or currentColor.
    if (documentTextStyles.has(name) && /^(?:inherit|initial|unset|revert|revert-layer|currentcolor)$/i.test(value)) return false;
    const pattern = documentImportStyles.get(name);
    if (!pattern?.test(value)) return false;
    if (documentTextStyles.has(name) && !inline.has(tag) && !(name === 'background-color' && ['td', 'th'].includes(tag))) return false;
    const indentable = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(tag);
    if (name === 'padding-inline-start' && (!indentable || parseFloat(value) % 40 !== 0)) return false;
    if (name === 'text-align' && !indentable) return false;
    // These resets do not cancel inherited semantic bold/italic/underline in Lexical.
    if (name === 'font-weight' && ['normal', '400'].includes(value)) return false;
    if (name === 'font-style' && value === 'normal') return false;
    if (name === 'text-decoration' && value === 'none') return false;
    if (['font-weight', 'font-style', 'text-decoration'].includes(name) && !inline.has(tag)) return false;
    if (name === 'font-size' && !/^(?:\d+(?:\.\d+)?)(?:px|pt)$/.test(value)) return false;
    if (name === 'aspect-ratio' && tag !== 'img') return false;
    if (name === 'width' && (!['col', 'td', 'th'].includes(tag) || !value.endsWith('px'))) return false;
    if (name === 'height' && tag !== 'tr') return false;
    if (name === 'vertical-align' && !['td', 'th'].includes(tag)) return false;
  }
  return true;
}

/** Unsupported authored presentation stays in its original viewer; editing must never silently strip it. */
export function supportedDocument(html: string, fileName: string): boolean {
  if (!isEditableDocument(html)) return false;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const root = parsed.documentElement;
  if (Array.from(root.attributes).some(attr => !['data-eve-document', 'data-eve-document-font', 'data-eve-document-heading-font', 'lang', 'dir'].includes(attr.name))) return false;
  if (root.hasAttribute('lang') && !supportedDocumentLanguage(root.getAttribute('lang')!)) return false;
  if (root.hasAttribute('dir') && !['ltr', 'rtl'].includes(root.getAttribute('dir')!)) return false;
  for (const name of ['data-eve-document-font', 'data-eve-document-heading-font']) {
    if (root.hasAttribute(name) && !['sans', 'serif'].includes(root.getAttribute(name)!)) return false;
  }
  if (parsed.body.attributes.length) return false;
  const canonical = new DOMParser().parseFromString(documentHtml('', '', root.getAttribute('data-eve-document-font') === 'serif' ? 'serif' : 'sans', root.getAttribute('data-eve-document-heading-font') === 'sans' ? 'sans' : 'serif'), 'text/html');
  for (const element of Array.from(parsed.head.children)) {
    if (element.tagName === 'TITLE' && !element.attributes.length) continue;
    if (element.tagName === 'STYLE' && !element.attributes.length && element.textContent === canonical.querySelector('style')?.textContent) continue;
    if (element.tagName === 'META' && Array.from(canonical.head.querySelectorAll('meta')).some(meta => meta.outerHTML === element.outerHTML)) continue;
    return false;
  }
  return Array.from(parsed.body.querySelectorAll<HTMLElement>('*')).every(supportedElement)
    && Array.from(parsed.body.querySelectorAll('a[href]')).every(link => isDocumentLinkSupported(link.getAttribute('href')!))
    && Array.from(parsed.body.querySelectorAll('img')).every(image => supportedDocumentImageElement(image, fileName));
}
