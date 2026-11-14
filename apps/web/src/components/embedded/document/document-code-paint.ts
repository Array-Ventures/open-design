import { $isLineBreakNode, $isTextNode } from 'lexical';
import type { CodeNode } from '@lexical/code';
import { documentTextStyles } from './document-styles';

/** Uniform plain code can retain its original direct CODE presentation owner.
 * Mixed runs keep their normal lossless DOM export rather than being flattened. */
export function uniformDocumentCodeStyle(node: CodeNode): string | undefined {
  let uniform: string | undefined;
  let text = false;
  for (const child of node.getChildren()) {
    if ($isLineBreakNode(child)) continue;
    if (!$isTextNode(child) || child.getFormat() !== 0) return;
    const style = document.createElement('span').style;
    style.cssText = child.getStyle();
    const names = Array.from(style).sort();
    if (names.some(name => !['color', 'background-color', 'font-size'].includes(name)
      || !documentTextStyles.get(name)?.test(style.getPropertyValue(name))
      || style.getPropertyPriority(name))) return;
    const normalized = names.map(name => `${name}:${style.getPropertyValue(name)}`).join(';');
    if (text && uniform !== normalized) return;
    uniform = normalized;
    text = true;
  }
  return uniform || undefined;
}

export function documentCodeNeedsHtml(node: CodeNode): boolean {
  return Boolean(node.getStyle()) || node.getChildren().some(child =>
    $isTextNode(child) && (Boolean(child.getStyle()) || child.getFormat() !== 0));
}
