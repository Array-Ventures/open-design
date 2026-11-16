import { expect, it } from 'vitest';
import { canonicalDeckMorphCandidates, type DeckMorphTree } from '../src/runtime/deck-morph.js';
type Node = { tag: string; text: string; attributes: Record<string, string>; children: Node[] };
const node = (tag: string, text = '', attributes: Record<string, string> = {}, children: Node[] = []): Node => ({ tag, text, attributes, children });
const tree: DeckMorphTree<Node> = { tag: n => n.tag, text: n => n.text, children: n => n.children, attribute: (n, key) => n.attributes[key] ?? null };
const collect = (...children: Node[]) => canonicalDeckMorphCandidates(node('section', '', {}, children), tree);
it('keeps explicit keys independent of tag and preserves exact whitespace', () => {
  const first = node('h1', 'ignored', { 'data-od-morph-id': '  Same  ' });
  expect([...collect(first)]).toEqual([['explicit:  Same  ', first]]);
});
it('keeps aria-label ahead of image src and text without trimming labels', () => {
  const image = node('img', '', { 'aria-label': ' Label ', src: 'ignored.png' });
  expect([...collect(image)]).toEqual([['img: Label ', image]]);
});
it('uses trimmed text before data-od-id and id, but does not normalize Unicode', () => {
  const text = node('p', '  café\n', { 'data-od-id': 'ignored', id: 'ignored2' });
  const decomposed = node('p', 'cafe\u0301');
  expect([...collect(text, decomposed).keys()]).toEqual(['p:café', 'p:cafe\u0301']);
});
it('uses raw image src and falls back through data-od-id then id', () => {
  const image = node('img', 'not image identity', { src: '../a.png' });
  const marker = node('div', '  ', { 'data-od-id': 'stable', id: 'other' });
  const fallback = node('p', '', { id: 'last' });
  expect([...collect(image, marker, fallback).keys()]).toEqual(['img:../a.png', 'div:stable', 'p:last']);
});
it('selects empty explicit and data markers but ignores bare ids on other tags', () => {
  const explicit = node('div', 'Text', { 'data-od-morph-id': '' });
  const marker = node('span', 'Other', { 'data-od-id': '' });
  expect([...collect(explicit, marker, node('div', 'Ignored', { id: 'bare' }), node('p', ''))]).toEqual([['div:Text', explicit], ['span:Other', marker]]);
});
it('includes SVG and every heading level; selection does not filter hidden nodes', () => {
  const tags = ['svg', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'];
  expect([...collect(...tags.map(tag => node(tag, 'Text', { hidden: '' }))).keys()]).toEqual(tags.map(tag => tag + ':Text'));
});
it('excludes the root, preserves depth-first document order, and does not mutate the tree', () => {
  const root = node('p', 'Root', { 'data-od-morph-id': 'root' }, [node('div', '', {}, [node('p', 'First')]), node('h1', 'Last')]);
  const before = JSON.stringify(root);
  expect([...canonicalDeckMorphCandidates(root, tree).keys()]).toEqual(['p:First', 'h1:Last']);
  expect(JSON.stringify(root)).toBe(before);
});
it('keeps second and third duplicate keys ambiguous without reordering their first position', () => {
  expect([...collect(node('p', 'Same'), node('h1', 'Middle'), node('p', 'Same'), node('p', 'Same'))].map(([key, value]) => [key, value?.text ?? null])).toEqual([['p:Same', null], ['h1:Middle', 'Middle']]);
  expect(collect(node('p', '', { 'data-od-morph-id': 'x' }), node('img', '', { 'data-od-morph-id': 'x' })).get('explicit:x')).toBeNull();
});
it('does not introduce a recursive-call depth limit for deep adapter trees', () => {
  let current = node('p', 'Deep');
  for (let i = 0; i < 20_000; i++) current = node('div', '', {}, [current]);
  expect([...canonicalDeckMorphCandidates(current, tree).keys()]).toEqual(['p:Deep']);
});
