import { $applyNodeReplacement, ElementNode, type DOMConversionMap, type NodeKey, type SerializedElementNode, type Spread } from 'lexical';
import { readDocumentSuggestion, type DocumentSuggestion } from './document-suggestion-schema';
export type SerializedDocumentSuggestion = Spread<DocumentSuggestion & { type: 'document-suggestion'; version: 1 }, SerializedElementNode>;
/** Editable inline content with durable proposal identity, never a permission token. */
export class DocumentSuggestionNode extends ElementNode {
  __suggestion: DocumentSuggestion;
  constructor(suggestion: DocumentSuggestion, key?: NodeKey) {
    super(key);
    if (!['insert', 'delete'].includes(suggestion.kind)) throw Error('Invalid document suggestion kind.');
    const element = document.createElement(suggestion.kind === 'insert' ? 'ins' : 'del');
    element.setAttribute('data-eve-suggestion', '1');
    element.setAttribute('data-eve-suggestion-id', suggestion.id);
    element.setAttribute('data-eve-suggestion-operation', suggestion.operation);
    const parsed = readDocumentSuggestion(element);
    if (!parsed) throw Error('Invalid document suggestion.');
    this.__suggestion = parsed;
  }
  static getType() { return 'document-suggestion'; }
  static clone(node: DocumentSuggestionNode) { return new DocumentSuggestionNode(node.__suggestion, node.__key); }
  static importJSON(value: SerializedDocumentSuggestion) {
    if (!['insert', 'delete'].includes(value.kind)) throw Error('Invalid document suggestion kind.');
    const element = document.createElement(value.kind === 'insert' ? 'ins' : 'del');
    element.setAttribute('data-eve-suggestion', '1');
    element.setAttribute('data-eve-suggestion-id', value.id);
    element.setAttribute('data-eve-suggestion-operation', value.operation);
    const parsed = readDocumentSuggestion(element);
    if (!parsed) throw Error('Invalid document suggestion.');
    return $createDocumentSuggestionNode(parsed).updateFromJSON(value);
  }
  static importDOM(): DOMConversionMap {
    const convert = (element: HTMLElement) => {
      const value = readDocumentSuggestion(element);
      return value ? { priority: 2 as const, conversion: () => ({ node: $createDocumentSuggestionNode(value) }) } : null;
    };
    return { ins: convert, del: convert };
  }
  suggestion(): DocumentSuggestion { return { ...this.getLatest().__suggestion }; }
  isInline() { return true; }
  canBeEmpty() { return false; }
  canInsertTextBefore() { return false; }
  canInsertTextAfter() { return false; }
  private sourceElement(): HTMLElement {
    const value = this.suggestion(), element = document.createElement(value.kind === 'insert' ? 'ins' : 'del');
    element.setAttribute('data-eve-suggestion', '1');
    element.setAttribute('data-eve-suggestion-id', value.id);
    element.setAttribute('data-eve-suggestion-operation', value.operation);
    return element;
  }
  createDOM(): HTMLElement {
    const element = this.sourceElement();
    element.setAttribute('contenteditable', 'false');
    return element;
  }
  retainDeletion(): void {
    const value = this.suggestion();
    if (value.kind !== 'delete' || value.operation !== 'replace') throw Error('Expected the retained replacement branch.');
    this.getWritable().__suggestion = { ...value, operation: 'delete' };
  }
  updateDOM(_previous: DocumentSuggestionNode, element: HTMLElement) {
    element.setAttribute('data-eve-suggestion-operation', this.suggestion().operation);
    return false;
  }
  exportDOM() { return { element: this.sourceElement() }; }
  exportJSON(): SerializedDocumentSuggestion { return { ...super.exportJSON(), ...this.suggestion(), type: 'document-suggestion', version: 1 }; }
}
export function $createDocumentSuggestionNode(value: DocumentSuggestion) { return $applyNodeReplacement(new DocumentSuggestionNode(value)); }
export function $isDocumentSuggestionNode(node: unknown): node is DocumentSuggestionNode { return node instanceof DocumentSuggestionNode; }
