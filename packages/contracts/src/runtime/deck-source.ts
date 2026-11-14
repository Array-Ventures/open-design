import { DECK_EXPLICIT_SLIDE_MARKERS } from './deck-stage-fallback.js';

/** Parser-neutral source-tree adapter. Templates are inert: adapters expose only
 * actual element children, never template content or browser-created clones. */
export interface DeckSourceTree<Node> {
  tag(node: Node): string | null;
  children(node: Node): readonly Node[];
  parent(node: Node): Node | null;
  attribute(node: Node, name: string): string | null;
}
const markers = new Set(DECK_EXPLICIT_SLIDE_MARKERS.map(selector => selector.slice(1)));
export function canonicalDeckSourceSlides<Node>(root: Node, tree: DeckSourceTree<Node>): Node[] {
  const stages: Node[] = [];
  function stagesIn(node: Node) {
    if (tree.tag(node) === 'deck-stage') stages.push(node);
    tree.children(node).forEach(stagesIn);
  }
  stagesIn(root);
  if (stages.length !== 1) return [];
  const stage = stages[0]!;
  const slides: Node[] = [];
  function visit(node: Node) {
    for (const child of tree.children(node)) {
      if (tree.attribute(child, 'data-screen-label') !== null || (tree.attribute(child, 'class') ?? '').split(/\s+/).some(value => markers.has(value))) slides.push(child);
      visit(child);
    }
  }
  visit(stage);
  const direct = slides.filter(node => tree.parent(node) === stage);
  const result = direct.length ? direct : slides.filter(node => {
    for (let parent = tree.parent(node); parent && parent !== stage; parent = tree.parent(parent)) if (slides.includes(parent)) return false;
    return true;
  });
  return result.length <= 200 ? result : [];
}
export function deckSourcePath<Node>(node: Node, tree: DeckSourceTree<Node>): string | null {
  const parts: number[] = [];
  let current = node;
  while (tree.tag(current) !== 'body') {
    const parent = tree.parent(current);
    if (!parent) return null;
    const index = tree.children(parent).indexOf(current);
    if (index < 0) return null;
    parts.unshift(index);
    current = parent;
  }
  const path = `path-${parts.join('-')}`;
  return parts.length && path.length <= 500 ? path : null;
}
export function validDeckSourcePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 500 && /^path(?:-\d+)+$/.test(value);
}
