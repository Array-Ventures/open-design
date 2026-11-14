import { HorizontalRuleNode, type SerializedHorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import { $applyNodeReplacement, $getState, $setState, createState, type DOMConversionMap, type EditorConfig } from 'lexical';
import { documentImportStyles } from './document-styles';

/** Preserve the same bounded declarations admitted by the document importer. */
export const documentDividerStyle = createState('eveDocumentDividerStyle', {
  parse: value => typeof value === 'string' && value.length <= 4096
    ? value.split(';').filter(declaration => {
      const colon = declaration.indexOf(':');
      return colon > 0 && documentImportStyles.get(declaration.slice(0, colon).trim())?.test(declaration.slice(colon + 1).trim());
    }).join(';') : '',
});

/** Extend the SDK rule's selection and history behavior with authored presentation. */
export class DocumentDividerNode extends HorizontalRuleNode {
  static getType(): string { return 'document-divider'; }
  static clone(node: DocumentDividerNode): DocumentDividerNode { return new DocumentDividerNode(node.getKey()); }
  static importJSON(value: SerializedHorizontalRuleNode): DocumentDividerNode {
    return $createDocumentDividerNode().updateFromJSON(value);
  }
  static importDOM(): DOMConversionMap {
    return { hr: () => ({ priority: 1, conversion: element => {
      const node = $createDocumentDividerNode();
      $setState(node, documentDividerStyle, documentDividerStyle.parse(element.getAttribute('style')));
      return { node };
    } }) };
  }
  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.style.cssText = $getState(this, documentDividerStyle);
    return element;
  }
  updateDOM(_previous?: DocumentDividerNode, element?: HTMLElement): false {
    if (element) element.style.cssText = $getState(this, documentDividerStyle);
    return false;
  }
  exportDOM() {
    const output = super.exportDOM();
    const style = $getState(this, documentDividerStyle);
    if (style && output.element instanceof HTMLElement) output.element.style.cssText = style;
    return output;
  }
}

export function $createDocumentDividerNode(): DocumentDividerNode {
  return $applyNodeReplacement(new DocumentDividerNode());
}

export const documentDividerReplacement = {
  replace: HorizontalRuleNode,
  with: () => new DocumentDividerNode(),
  withKlass: DocumentDividerNode,
};
