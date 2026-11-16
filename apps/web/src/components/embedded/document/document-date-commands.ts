import { $addUpdateTag, $copyNode, $createNodeSelection, $createParagraphNode, $getRoot, $getSelection, $isElementNode, $isNodeSelection, $isRangeSelection, $setSelection, type LexicalNode, type NodeKey } from 'lexical';
import { parseDate, getLocalTimeZone, today } from '@internationalized/date';
import { readDocumentDate, type DocumentDate } from '@open-design/contracts/runtime/document';
import { $createDocumentDateNode, $isDocumentDateNode, type DocumentDateNode } from './DocumentDateNode';
import { $createDocumentSuggestionNode, $isDocumentSuggestionNode } from './DocumentSuggestionNode';
import { $suggestDocumentDate } from './document-suggestion-commands';
import { DOCUMENT_SUGGESTION_UPDATE_TAG } from './document-suggestion-policy';
import type { DocumentMode } from './document-suggestion-input';
export function localDocumentDate(locale: string, iso = today(getLocalTimeZone()).toString()): DocumentDate {
  const date = parseDate(iso);
  const canonical = Intl.getCanonicalLocales(locale)[0]!;
  const label = new Intl.DateTimeFormat(canonical, { month: 'short', day: 'numeric', year: 'numeric', timeZone: getLocalTimeZone() }).format(date.toDate(getLocalTimeZone()));
  const value = readDocumentDate({ iso, locale: canonical, label });
  if (!value) throw Error('This date could not be preserved.');
  return value;
}
function $dateOwner(node: LexicalNode): LexicalNode | null {
  for (let current: LexicalNode | null = node; current; current = current.getParent()) {
    if (['paragraph', 'heading', 'listitem'].includes(current.getType())) return current;
  }
  return null;
}
/** Calendar operations are confined to ordinary inline document blocks. */
export function $dateBlock(node: LexicalNode): boolean {
  let block = false;
  for (let current: LexicalNode | null = node; current; current = current.getParent()) {
    const type = current.getType();
    if (['table', 'tablerow', 'tablecell', 'code', 'link'].includes(type)) return false;
    if (['paragraph', 'heading', 'listitem'].includes(type)) block = true;
  }
  return block;
}
export function $dateProposal(node: LexicalNode) {
  for (let current = node.getParent(); current; current = current.getParent()) if ($isDocumentSuggestionNode(current)) return current;
  return null;
}
export function $canChangeDate(node: DocumentDateNode, owned: ReadonlyMap<NodeKey, string>): boolean {
  if (!node.isAttached() || !$dateBlock(node)) return false;
  const proposal = $dateProposal(node);
  return !proposal || proposal.suggestion().kind === 'insert' && owned.get(node.getKey()) === proposal.suggestion().id;
}
export function $selectDocumentDate(node: DocumentDateNode) {
  const selection = $createNodeSelection(); selection.add(node.getKey()); $setSelection(selection);
}
/** The no-focus append policy belongs to this editor, not the reference audit. */
export function $insertDocumentDate(value: DocumentDate, mode: DocumentMode, owned: Map<NodeKey, string>): DocumentDateNode {
  if (mode === 'viewing') throw Error('This date cannot be changed here.');
  let selection = $getSelection();
  if (!selection) {
    let last = $getRoot().getLastChild();
    if (!$isElementNode(last) || last.getType() !== 'paragraph') {
      if (mode === 'suggesting') throw Error('Choose a paragraph for this date.');
      last = $createParagraphNode(); $getRoot().append(last);
    }
    if (!$isElementNode(last)) throw Error('Choose a paragraph for this date.');
    last.selectEnd(); selection = $getSelection();
  }
  if (!$isRangeSelection(selection) || ![selection.anchor.getNode(), selection.focus.getNode()].every($dateBlock)
    || $dateOwner(selection.anchor.getNode()) !== $dateOwner(selection.focus.getNode())
    || selection.getNodes().some(node => $dateProposal(node) || $isDocumentSuggestionNode(node))) throw Error('Choose unreviewed text inside one paragraph for this date.');
  const date = $createDocumentDateNode(value);
  if (mode === 'suggesting') owned.set(date.getKey(), $suggestDocumentDate(date, crypto.randomUUID()));
  else selection.insertNodes([date]);
  $selectDocumentDate(date);
  return date;
}
/** Changing a committed source date in Suggesting retains that exact old atom. */
export function $changeDocumentDate(node: DocumentDateNode, value: DocumentDate, mode: DocumentMode, owned: Map<NodeKey, string>): DocumentDateNode {
  if (mode === 'viewing' || !$canChangeDate(node, owned)) throw Error('Resolve this suggestion before changing its date.');
  const proposal = $dateProposal(node);
  if (mode === 'suggesting' && !proposal) {
    const id = crypto.randomUUID();
    const removed = $createDocumentSuggestionNode({ id, kind: 'delete', operation: 'replace' });
    const inserted = $createDocumentSuggestionNode({ id, kind: 'insert', operation: 'replace' });
    const original = $copyNode(node), next = $createDocumentDateNode(value);
    removed.append(original); inserted.append(next);
    $addUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG); node.replace(removed); removed.insertAfter(inserted);
    owned.set(next.getKey(), id); $selectDocumentDate(next); return next;
  }
  if (proposal) $addUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG);
  node.setDate(value); $selectDocumentDate(node); return node;
}
export function $selectedDocumentDate(): DocumentDateNode | null {
  const selection = $getSelection();
  if (!$isNodeSelection(selection) || selection.getNodes().length !== 1) return null;
  const node = selection.getNodes()[0]; return $isDocumentDateNode(node) ? node : null;
}
