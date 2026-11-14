import { $createRangeSelection, $isElementNode, $isTextNode, type ElementNode, type LexicalNode, type RangeSelection, type TextNode } from 'lexical';
import { $isLinkNode } from '@lexical/link';

type Piece = { kind: 'text'; node: TextNode } | { kind: 'barrier'; node: LexicalNode };
/** Plan in one contiguous native text domain. BR, images, proposals and unknown
 * inline owners retain their positions as barriers; they never become text offsets.
 * This creates only a detached range and cannot change the active selection.
 */
export function $documentCharacterDeletionRange(selection: RangeSelection, owner: ElementNode, backward: boolean): RangeSelection {
  const pieces: Piece[] = [], edges = new Map<string, number[]>();
  const walk = (element: ElementNode) => {
    const boundaries = [pieces.length];
    for (const node of element.getChildren()) {
      if ($isTextNode(node) && node.getType() === 'text' && node.getMode() === 'normal') pieces.push({ kind: 'text', node });
      else if ($isLinkNode(node) && node.getChildrenSize()) walk(node);
      else pieces.push({ kind: 'barrier', node });
      boundaries.push(pieces.length);
    }
    edges.set(element.getKey(), boundaries);
  };
  walk(owner);
  const point = selection.anchor, anchor = point.getNode();
  let index: number, within = 0, candidate: number;
  if (point.type === 'text' && $isTextNode(anchor)) {
    index = pieces.findIndex(piece => piece.node.getKey() === anchor.getKey());
    if (index < 0 || !Number.isInteger(point.offset) || point.offset < 0 || point.offset > anchor.getTextContentSize()) throw Error('The selected text changed.');
    within = point.offset;
    candidate = index + (backward ? within === 0 ? -1 : 0 : within === anchor.getTextContentSize() ? 1 : 0);
  } else if (point.type === 'element' && $isElementNode(anchor)) {
    const boundary = edges.get(anchor.getKey())?.[point.offset];
    if (boundary === undefined) throw Error('The selected text changed.');
    index = boundary; candidate = backward ? boundary - 1 : boundary;
  } else throw Error('Select text to suggest its deletion.');
  if (pieces[candidate]?.kind !== 'text') throw Error('Character suggestions cannot cross a non-text boundary.');
  let first = candidate, last = candidate;
  while (pieces[first - 1]?.kind === 'text') first--;
  while (pieces[last + 1]?.kind === 'text') last++;
  const texts: TextNode[] = [];
  let offset = within;
  for (let position = first; position <= last; position++) {
    const piece = pieces[position]!;
    if (piece.kind !== 'text') throw Error('The text domain changed.');
    texts.push(piece.node);
    if (position < index) offset += piece.node.getTextContentSize();
  }
  const value = texts.map(node => node.getTextContent()).join('');
  let previous: number | undefined, next = value.length, boundary = offset === value.length;
  for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) {
    if (segment.index < offset) previous = segment.index;
    else if (segment.index === offset) boundary = true;
    else { next = segment.index; break; }
  }
  if (!boundary) throw Error('Select complete Unicode characters.');
  const start = backward ? previous : offset, end = backward ? offset : next;
  if (start === undefined || start === end) throw Error('Character suggestions cannot cross a non-text boundary.');
  const range = $createRangeSelection(); range.format = selection.format; range.style = selection.style;
  const set = (target: typeof range.anchor, position: number) => {
    for (const text of texts) {
      if (position <= text.getTextContentSize()) { target.set(text.getKey(), position, 'text'); return; }
      position -= text.getTextContentSize();
    }
    throw Error('The selected text changed.');
  };
  set(range.anchor, start); set(range.focus, end);
  return range;
}
