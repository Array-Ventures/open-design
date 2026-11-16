import { createContext, useContext, type JSX } from 'react';
import { DecoratorNode, $applyNodeReplacement, type DOMConversionMap, type LexicalEditor, type LexicalUpdateJSON, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical';
import { RiCalendarLine } from '@remixicon/react';
import { readDocumentDate, type DocumentDate } from '@open-design/contracts/runtime/document';
import { useT } from '../../../i18n';
import { Button } from '../boardui/button';
import { documentDateElement } from './document-date-source';
import { readEditableDocumentDateElement } from './document-date-context';
export const DocumentDateInteraction = createContext<{ open(key: NodeKey, target: HTMLElement): void } | null>(null);
export type SerializedDocumentDate = Spread<DocumentDate, SerializedLexicalNode>;
function validated(value: unknown): DocumentDate { const data = readDocumentDate(value); if (!data) throw Error('This date could not be preserved.'); return data; }
function DateChip({ nodeKey, value }: { nodeKey: NodeKey; value: DocumentDate }) {
  const interaction = useContext(DocumentDateInteraction), t = useT();
  return <Button variant="ghost" size="small" className="mx-1 inline-flex h-8 min-w-0 max-w-full gap-1 rounded-md bg-background-secondary-default px-1 py-0 align-baseline text-body-2-regular text-text-primary" leadingIcon={RiCalendarLine} aria-label={value.label} aria-roledescription={t('documentDate.label')} onMouseDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); event.stopPropagation(); interaction?.open(nodeKey, event.currentTarget); }}><span className="min-w-0 truncate">{value.label}</span></Button>;
}
/** An inline noneditable date with a source-owned label, not a recomputed display string. */
export class DocumentDateNode extends DecoratorNode<JSX.Element> {
  __date: DocumentDate;
  constructor(value: DocumentDate, key?: NodeKey) { super(key); this.__date = validated(value); }
  static getType() { return 'document-date'; }
  static clone(node: DocumentDateNode) { return new DocumentDateNode(node.__date, node.__key); }
  static importJSON(value: SerializedDocumentDate) { if (value.type !== 'document-date' || value.version !== 1) throw Error('This date version could not be preserved.'); return $createDocumentDateNode(validated(value)).updateFromJSON(value); }
  updateFromJSON(value: LexicalUpdateJSON<SerializedDocumentDate>): this { const data = validated(value); super.updateFromJSON(value); this.getWritable().__date = data; return this; }
  static importDOM(): DOMConversionMap { return { time: element => { const data = readEditableDocumentDateElement(element); return data ? { priority: 3, conversion: () => ({ node: $createDocumentDateNode(data) }) } : null; } }; }
  createDOM() { const span = document.createElement('span'); span.setAttribute('contenteditable', 'false'); return span; }
  updateDOM() { return false; }
  isInline() { return true; }
  isKeyboardSelectable() { return true; }
  getDate(): DocumentDate { return { ...this.getLatest().__date }; }
  setDate(value: DocumentDate) { this.getWritable().__date = validated(value); }
  getTextContent() { return this.getDate().label; }
  exportDOM() { return { element: documentDateElement(this.getDate()) }; }
  exportJSON(): SerializedDocumentDate { return { ...super.exportJSON(), ...this.getDate(), type: 'document-date', version: 1 }; }
  decorate(_editor: LexicalEditor) { return <DateChip nodeKey={this.getKey()} value={this.getDate()} />; }
}
export function $createDocumentDateNode(value: DocumentDate) { return $applyNodeReplacement(new DocumentDateNode(value)); }
export function $isDocumentDateNode(node: unknown): node is DocumentDateNode { return node instanceof DocumentDateNode; }
