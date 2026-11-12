import { documentCommentAnchorHint, readDocumentCommentAnchorHint, type DocumentCommentAnchor } from '@open-design/contracts';
export type { DocumentCommentAnchor } from '@open-design/contracts';
import { $createRangeSelection, $getSelection, $getState, $isElementNode, $isRangeSelection, $isTextNode, type LexicalNode, type PointType, type RangeSelection } from 'lexical';
import type { PreviewCommentTarget } from '../../../types';
import { documentBlockId, documentBlockNodes } from './document-identity';

type Endpoint = DocumentCommentAnchor['start'];
function endpoint(point: PointType): Endpoint | null {
  const node = point.getNode();
  let block: LexicalNode | null = node;
  while (block && !$getState(block, documentBlockId)) block = block.getParent();
  if (!block || !$isElementNode(block)) return null;
  let offset = $isTextNode(node) ? point.offset : $isElementNode(node) ? node.getChildren().slice(0, point.offset).reduce((sum, child) => sum + child.getTextContentSize(), 0) : -1;
  if (offset < 0) return null;
  let cursor = node;
  while (cursor !== block) {
    const parent = cursor.getParent();
    if (!parent) return null;
    offset += cursor.getPreviousSiblings().reduce((sum, sibling) => sum + sibling.getTextContentSize(), 0);
    cursor = parent;
  }
  return offset <= 1_000_000 ? { block: $getState(block, documentBlockId), offset } : null;
}
/** Capture actual Lexical selection, not a DOM canvas or generic HTML picker. */
export function captureDocumentComment(selection = $getSelection()): DocumentCommentAnchor | null {
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return null;
  const start = endpoint(selection.isBackward() ? selection.focus : selection.anchor), end = endpoint(selection.isBackward() ? selection.anchor : selection.focus), quote = selection.getTextContent();
  return start && end && quote.trim() && quote.length <= 4000 ? { version: 1, start, end, quote } : null;
}
function position(selection: RangeSelection, name: 'anchor' | 'focus', endpoint: Endpoint): boolean {
  const block = documentBlockNodes().find(node => $getState(node, documentBlockId) === endpoint.block);
  if (!block || !$isElementNode(block)) return false;
  let offset = endpoint.offset;
  const visit = (node: LexicalNode): boolean => {
    if ($isTextNode(node)) {
      if (offset <= node.getTextContentSize()) { selection[name].set(node.getKey(), offset, 'text'); return true; }
      offset -= node.getTextContentSize(); return false;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) if (visit(child)) return true;
      if (!node.getChildrenSize() && offset === 0) { selection[name].set(node.getKey(), 0, 'element'); return true; }
      return false;
    }
    const size = node.getTextContentSize(), parent = node.getParent();
    if (offset <= size && parent) { selection[name].set(parent.getKey(), node.getIndexWithinParent() + (offset ? 1 : 0), 'element'); return true; }
    offset -= size; return false;
  };
  return visit(block);
}
/** Exact identities, offsets AND quote must agree. Never silently point at new text. */
export function resolveDocumentComment(anchor: DocumentCommentAnchor): RangeSelection | null {
  const selection = $createRangeSelection();
  return position(selection, 'anchor', anchor.start) && position(selection, 'focus', anchor.end) && selection.getTextContent() === anchor.quote ? selection : null;
}
export function documentCommentTarget(fileName: string, anchor: DocumentCommentAnchor): PreviewCommentTarget {
  return { filePath: fileName, elementId: anchor.start.block, selector: `[data-od-id="${anchor.start.block}"]`, label: 'Selected text', text: anchor.quote, htmlHint: documentCommentAnchorHint(anchor), position: { x: 0, y: 0, width: 0, height: 0 } };
}
export function readDocumentCommentAnchor(target: Pick<PreviewCommentTarget, 'htmlHint'>): DocumentCommentAnchor | null {
  return readDocumentCommentAnchorHint(target.htmlHint);
}
