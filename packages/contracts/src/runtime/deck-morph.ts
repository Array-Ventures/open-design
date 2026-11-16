/** Parser-neutral view of the actual light-DOM element tree. Children are in
 * document order and exclude inert template content; text matches textContent.
 * Candidate identity is presentation metadata, never source/edit authority. */
export interface DeckMorphTree<Node> {
  tag(node: Node): string | null;
  children(node: Node): readonly Node[];
  attribute(node: Node, name: string): string | null;
  text(node: Node): string;
}

/** Canonical browser Magic Move candidates, excluding the slide root itself.
 * Null preserves an ambiguous key's original insertion order. Keep this function
 * self-contained: the exact compiled function is injected into artifact runtime. */
export function canonicalDeckMorphCandidates<Node>(slide: Node, tree: DeckMorphTree<Node>): Map<string, Node | null> {
  const result = new Map<string, Node | null>();
  const pending = Array.from(tree.children(slide)).reverse();
  while (pending.length) {
    const element = pending.pop()!;
    const tag = tree.tag(element);
    const explicit = tree.attribute(element, 'data-od-morph-id');
    if (explicit !== null || tree.attribute(element, 'data-od-id') !== null ||
      ['img', 'svg', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'].includes(tag ?? '')) {
      const semantic = tree.attribute(element, 'aria-label') ||
        (tag === 'img' ? tree.attribute(element, 'src') : tree.text(element).trim());
      const identity = explicit || semantic || tree.attribute(element, 'data-od-id') || tree.attribute(element, 'id');
      if (identity) {
        const key = explicit ? 'explicit:' + explicit : tag + ':' + identity;
        result.set(key, result.has(key) ? null : element);
      }
    }
    const children = tree.children(element);
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]!);
  }
  return result;
}
