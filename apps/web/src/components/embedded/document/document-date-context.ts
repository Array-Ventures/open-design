import styles from './DocumentEditor.module.css';
import { documentTextStyles } from './document-styles';
import { readDocumentDateElement } from './document-date-source';
const semanticFormatting = new Set(['STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'SMALL', 'MARK']);
const inheritedTextStyles = new Set([...documentTextStyles.keys(), 'font-weight', 'font-style', 'text-decoration', 'white-space']);
/** Date has no TextNode format/style payload. Refuse presentation its atom
 * cannot retain instead of admitting it and flattening a later source save. */
export function readEditableDocumentDateElement(element: Element) {
  const value = readDocumentDateElement(element);
  if (!value) return null;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (semanticFormatting.has(parent.tagName) || parent.tagName === 'DEL' && parent.getAttribute('data-eve-suggestion') !== '1') return null;
    const classes = (parent.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    if (classes.length) {
      // These are regenerated from retained checklist state, not an imported
      // text-format class. All other ancestor classes remain unsupported.
      const list = parent.tagName === 'UL' && parent.getAttribute('__lexicallisttype') === 'check';
      const item = parent.tagName === 'LI' && parent.parentElement?.getAttribute('__lexicallisttype') === 'check';
      const retained = list ? styles.checklist : item && parent.getAttribute('aria-checked') === 'true' ? styles.checked : item && parent.getAttribute('aria-checked') === 'false' ? styles.unchecked : '';
      const allowed = new Set((retained ?? '').split(/\s+/).filter(Boolean));
      if (classes.some(name => !allowed.has(name))) return null;
    }
    for (const declaration of (parent.getAttribute('style') ?? '').split(';')) {
      const colon = declaration.indexOf(':'); if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      // TableCellNode independently retains an authored cell background.
      if (property === 'background-color' && ['TD', 'TH'].includes(parent.tagName)) continue;
      if (inheritedTextStyles.has(property) || /^(?:font(?:-|$)|background(?:-|$)|text-(?!align$)|line-height$|letter-spacing$|word-spacing$)/.test(property)) return null;
    }
  }
  return value;
}
