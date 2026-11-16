import { expect, it } from 'vitest';
import { load } from 'cheerio';
import { createRequire } from 'node:module';
// Daemon tests deliberately have no DOM library; describe this fixture's observed surface.
type DomElement = { localName: string; id: string; textContent: string | null; getAttribute(name: string): string | null; querySelectorAll(selector: string): Iterable<DomElement> };
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: { document: { querySelector(selector: string): DomElement | null }; close(): void } } };
import { canonicalDeckMorphCandidates, type DeckMorphTree } from '@open-design/contracts/runtime/deck-morph';
it.each([
  '<h1 id="a">Title <em>inside</em></h1><p id="b" aria-label="Label">Different</p><img id="c" src="../raw.png">',
  '<p data-od-morph-id="x">First</p><svg data-od-morph-id="x"><text>Second</text></svg><p>Last</p>',
  '<template><p>Inert</p></template><div hidden data-od-id="x">Hidden</div><div id="bare">Ignored</div>',
  '<svg id="a" aria-label="Vector"><g><text>Label</text></g></svg><h6 id="b"> Unicode café </h6>',
  '<div data-od-morph-id=""> Empty fallback </div><img data-od-id="fallback" src=""><p id="last"></p>',
  '<p>Same</p><p>Same</p><p>Same</p><h1>Remaining</h1>',
])('matches actual DOM selector semantics with the inert saved-source parser: %s', body => {
  const html = `<section id="slide" data-od-morph-id="root">${body}</section>`, $ = load(html);
  type SourceNode = ReturnType<typeof $>[number];
  const source: DeckMorphTree<SourceNode> = { tag: n => 'tagName' in n ? n.tagName : null, children: n => 'children' in n ? n.children.filter(c => c.type === 'tag' || c.type === 'script' || c.type === 'style') : [], attribute: (n, key) => 'attribs' in n ? n.attribs[key] ?? null : null, text: n => $(n).text() };
  const dom = new JSDOM(html);
  try {
    const slide = dom.window.document.querySelector('#slide')!;
    // Independent legacy selector projection is the pre-extraction browser contract.
    const expected = new Map<string, DomElement | null>();
    for (const element of slide.querySelectorAll('[data-od-morph-id],[data-od-id],img,svg,h1,h2,h3,h4,h5,h6,p')) {
      const explicit = element.getAttribute('data-od-morph-id');
      const semantic = element.getAttribute('aria-label') || (element.localName === 'img' ? element.getAttribute('src') : (element.textContent || '').trim());
      const identity = explicit || semantic || element.getAttribute('data-od-id') || element.id;
      if (identity) { const key = explicit ? 'explicit:' + explicit : element.localName + ':' + identity; expected.set(key, expected.has(key) ? null : element); }
    }
    const actual = canonicalDeckMorphCandidates($('#slide')[0]!, source);
    expect([...actual].map(([key, element]) => [key, element ? $(element).attr('id') ?? '' : null])).toEqual([...expected].map(([key, element]) => [key, element?.id ?? (element === null ? null : '')]));
    expect($.html()).not.toContain('view-transition-name');
  } finally { dom.window.close(); }
});
