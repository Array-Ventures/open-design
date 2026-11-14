import { DOCUMENT_SUGGESTION_UPDATE_TAG } from './document-suggestion-policy';
import { $addUpdateTag, $copyNode, $createRangeSelection, $setSelection, $createTextNode, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, type ElementNode, type LexicalNode, type TextNode } from 'lexical';
import { $isLinkNode } from '@lexical/link';
import { $createDocumentSuggestionNode, $isDocumentSuggestionNode, type DocumentSuggestionNode } from './DocumentSuggestionNode';

export function $documentSuggestions(): DocumentSuggestionNode[] {
  const result: DocumentSuggestionNode[] = [];
  const visit = (node: LexicalNode) => { if ($isDocumentSuggestionNode(node)) result.push(node); else if ($isElementNode(node)) node.getChildren().forEach(visit); };
  $getRoot().getChildren().forEach(visit); return result;
}
function block(node: LexicalNode): ElementNode | null {
  for (let current: LexicalNode | null = node; current; current = current.getParent()) {
    if ($isDocumentSuggestionNode(current)) return null;
    if ($isElementNode(current) && !current.isInline()) return ['paragraph', 'heading', 'listitem'].includes(current.getType()) ? current : null;
  }
  return null;
}
/** Only plain inline selection ranges; never remove an unsupported structure first. */
function qualified() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) throw Error('Select text inside one paragraph to suggest a change.');
  if (/[\uD800-\uDFFF]/u.test(selection.getTextContent())) throw Error('Select complete Unicode characters.');
  const owner = block(selection.anchor.getNode());
  if (selection.getNodes().some(node => $isTextNode(node) && (node.getType() !== 'text' || node.getMode() !== 'normal'))) throw Error('Suggestions do not support atomic text tokens.');
  if (!owner || owner !== block(selection.focus.getNode()) || (!selection.isCollapsed() && selection.getNodes().some(node => {
    if (node === owner) return false;
    return !$isTextNode(node) && !$isLinkNode(node) || block(node) !== owner;
  }))) throw Error('Suggestions currently support text inside one paragraph.');
  return selection;
}
function copyText(texts: TextNode[]): LexicalNode[] {
  const result: LexicalNode[] = [];
  let previous: LexicalNode | null = null, link: ElementNode | null = null;
  for (const text of texts) {
    const parent = text.getParent();
    if ($isLinkNode(parent)) {
      if (parent !== previous) { link = $copyNode(parent); result.push(link); }
      link!.append($copyNode(text));
    } else { result.push($copyNode(text)); link = null; }
    previous = parent;
  }
  return result;
}
/** One native editor update owns the proposed text and retained original branch. */
export function $suggestDocumentText(text: string, id: string, appendTo?: string): string {
  if (!text || /[\r\n\uD800-\uDFFF]/u.test(text)) throw Error('Suggest text without paragraph breaks.');
  const current = $getSelection();
  if (appendTo && $isRangeSelection(current) && current.isCollapsed()) {
    const leaf = current.anchor.getNode();
    let parent = leaf.getParent();
    if ($isLinkNode(parent)) parent = parent.getParent();
    if ($isTextNode(leaf) && current.anchor.offset === leaf.getTextContentSize() && $isDocumentSuggestionNode(parent)
      && parent.suggestion().id === appendTo && parent.suggestion().kind === 'insert' && parent.getLastDescendant() === leaf) {
      $addUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG); current.insertText(text); return appendTo;
    }
  }
  if (appendTo && $isRangeSelection(current) && current.isCollapsed()) {
    const point = current.anchor, node = point.getNode();
    const previous = $isElementNode(node) ? node.getChildAtIndex(point.offset - 1) : point.offset === 0 ? node.getPreviousSibling() : null;
    if ($isDocumentSuggestionNode(previous) && previous.suggestion().id === appendTo && previous.suggestion().kind === 'insert') {
      const last = previous.getLastDescendant();
      if (!$isTextNode(last)) throw Error('This insertion could not be preserved.');
      $addUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG); last.setTextContent(last.getTextContent() + text); previous.selectNext(0, 0); return appendTo;
    }
  }
  const selection = qualified();
  if ($documentSuggestions().some(node => node.suggestion().id === id)) throw Error('Suggestion identity is already in use.');
  const replacement = !selection.isCollapsed();
  const inserted = $createDocumentSuggestionNode({ id, kind: 'insert', operation: replacement ? 'replace' : 'insert' });
  const leaf = $createTextNode(text).setFormat(selection.format).setStyle(selection.style);
  const parent = selection.anchor.getNode().getParent();
  if ($isLinkNode(parent) && selection.focus.getNode().getParent() === parent) {
    const link = $copyNode(parent); link.append(leaf); inserted.append(link);
  } else inserted.append(leaf);
  if (replacement) {
    const original = selection.extract().filter($isTextNode);
    if (!original.length) throw Error('Select text to replace.');
    const removed = $createDocumentSuggestionNode({ id, kind: 'delete', operation: 'replace' });
    removed.append(...copyText(original));
    $addUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG); selection.insertNodes([removed, inserted]);
  } else { $addUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG); selection.insertNodes([inserted]); }
  inserted.selectNext(0, 0);
  return id;
}
export function $suggestDocumentDeletion(id: string): void {
  if ($documentSuggestions().some(node => node.suggestion().id === id)) throw Error('Suggestion identity is already in use.');
  const selection = qualified();
  if (selection.isCollapsed()) throw Error('Select text to suggest its deletion.');
  const removed = $createDocumentSuggestionNode({ id, kind: 'delete', operation: 'delete' });
  const original = selection.extract().filter($isTextNode);
  if (!original.length) throw Error('Select text to suggest its deletion.');
  removed.append(...copyText(original));
  $addUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG);
  selection.insertNodes([removed]); removed.selectNext(0, 0);
}
/** Resolve only the complete, current proposal; IDs alone are never a permission. */
export function $resolveDocumentSuggestion(id: string, accept: boolean): void {
  const nodes = $documentSuggestions().filter(node => node.suggestion().id === id);
  if (!nodes.length) throw Error('This suggestion is no longer available.');
  const operation = nodes[0]!.suggestion().operation;
  if (nodes.some(node => node.suggestion().operation !== operation) || (operation === 'replace'
    ? nodes.length !== 2 || nodes[0]!.suggestion().kind !== 'delete' || nodes[1]!.suggestion().kind !== 'insert' || nodes[0]!.getNextSibling() !== nodes[1]
    : nodes.length !== 1)) throw Error('This suggestion could not be preserved.');
  $addUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG);
  for (const node of nodes) {
    if ((node.suggestion().kind === 'insert') === accept) node.getChildren().forEach(child => node.insertBefore(child));
    node.remove();
  }
}

/** Extend by one Unicode grapheme without joining paragraphs or guessing UTF-16 characters. */
export function $suggestDocumentCharacterDeletion(backward: boolean, id: string): void {
  const selection = qualified();
  if (!selection.isCollapsed()) { $suggestDocumentDeletion(id); return; }
  const owner = block(selection.anchor.getNode())!;
  const texts = owner.getAllTextNodes();
  const point = selection.anchor, anchor = point.getNode();
  let offset = 0;
  if ($isTextNode(anchor)) {
    for (const text of texts) { if (text === anchor) { offset += point.offset; break; } offset += text.getTextContentSize(); }
  } else if ($isElementNode(anchor)) {
    const preceding = anchor.getChildren().slice(0, point.offset).reduce((sum, child) => sum + child.getTextContentSize(), 0);
    const first = anchor.getAllTextNodes()[0];
    for (const text of texts) { if (text === first) break; offset += text.getTextContentSize(); }
    offset += preceding;
  } else throw Error('Select text to suggest its deletion.');
  const value = texts.map(text => text.getTextContent()).join('');
  const boundaries = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(segment => segment.index);
  boundaries.push(value.length);
  if (!boundaries.includes(offset)) throw Error('Select complete Unicode characters.');
  const start = backward ? boundaries.filter(index => index < offset).at(-1) : offset;
  const end = backward ? offset : boundaries.find(index => index > offset);
  if (start === undefined || end === undefined || start === end) throw Error('Suggestions cannot join paragraphs.');
  const set = (target: typeof selection.anchor, position: number) => {
    for (const text of texts) {
      if (position <= text.getTextContentSize()) { target.set(text.getKey(), position, 'text'); return; }
      position -= text.getTextContentSize();
    }
    throw Error('The selected text changed.');
  };
  set(selection.anchor, start); set(selection.focus, end);
  $suggestDocumentDeletion(id);
}

/** Revise only the still-current insertion minted by this live input owner. */
export function $eraseCurrentDocumentInsertion(id: string | undefined, backward: boolean): boolean {
  if (!id) return false;
  const selection = $getSelection();
  const node = $documentSuggestions().find(value => value.suggestion().id === id && value.suggestion().kind === 'insert');
  if (!node || !$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const point = selection.anchor, anchor = point.getNode(), texts = node.getAllTextNodes();
  const first = texts[0], last = texts.at(-1);
  if (!first || !last) return false;
  const atEnd = anchor === last && point.offset === last.getTextContentSize()
    || anchor === node.getParent() && point.offset === node.getIndexWithinParent() + 1
    || $isTextNode(anchor) && point.offset === 0 && anchor.getPreviousSibling() === node;
  const atStart = anchor === first && point.offset === 0
    || anchor === node.getParent() && point.offset === node.getIndexWithinParent()
    || $isTextNode(anchor) && point.offset === anchor.getTextContentSize() && anchor.getNextSibling() === node;
  if (backward ? !atEnd : !atStart) return false;
  const text = node.getTextContent();
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
  const start = backward ? segments.at(-1)!.index : 0;
  const end = backward ? text.length : segments[1]?.index ?? text.length;
  if (node.suggestion().operation === 'replace' && start === 0 && end === text.length) {
    const removed = node.getPreviousSibling();
    if (!$isDocumentSuggestionNode(removed) || removed.suggestion().id !== id || removed.suggestion().kind !== 'delete' || removed.suggestion().operation !== 'replace') throw Error('This replacement could not be preserved.');
    $addUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG); removed.retainDeletion(); node.selectNext(0, 0); node.remove(); return true;
  }
  const range = $createRangeSelection();
  const set = (target: typeof range.anchor, offset: number) => {
    for (const leaf of texts) {
      if (offset <= leaf.getTextContentSize()) { target.set(leaf.getKey(), offset, 'text'); return; }
      offset -= leaf.getTextContentSize();
    }
    throw Error('The insertion changed before it could be edited.');
  };
  set(range.anchor, start); set(range.focus, end);
  $addUpdateTag(DOCUMENT_SUGGESTION_UPDATE_TAG); $setSelection(range); range.removeText();
  if (node.isAttached()) { node.selectNext(0, 0); if (!node.getTextContentSize()) node.remove(); }
  return true;
}
