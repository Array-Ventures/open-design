// @vitest-environment node
import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { injectDeckStageFallback } from '@open-design/contracts/runtime/deck-stage-fallback';
import { canonicalDeckMorphCandidates } from '@open-design/contracts/runtime/deck-morph';

it.each([
  { name: 'trimmed text', left: '<h1 data-test="a">  Title </h1>', right: '<h1 data-test="b">Title</h1>', pairs: ['a', 'b'] },
  { name: 'explicit identity across changed text and tags', left: '<h1 data-test="a" data-od-morph-id="same">First</h1>', right: '<p data-test="b" data-od-morph-id="same">Changed</p>', pairs: ['a', 'b'] },
  { name: 'aria-label priority', left: '<p data-test="a" aria-label="Label">First</p>', right: '<p data-test="b" aria-label="Label">Changed</p>', pairs: ['a', 'b'] },
  { name: 'empty explicit fallback', left: '<div data-test="a" data-od-morph-id="">Same</div>', right: '<div data-test="b" data-od-morph-id="">Same</div>', pairs: ['a', 'b'] },
  { name: 'text before data-od-id', left: '<div data-od-id="same">First</div>', right: '<div data-od-id="same">Changed</div>', pairs: [] },
  { name: 'bare ids are not candidates', left: '<div id="same">First</div>', right: '<div id="same">First</div>', pairs: [] },
  { name: 'duplicate on previous', left: '<p>Same</p><p>Same</p>', right: '<p>Same</p>', pairs: [] },
  { name: 'third duplicate stays ambiguous', left: '<p>Same</p>', right: '<p>Same</p><p>Same</p><p>Same</p>', pairs: [] },
  { name: 'raw image source stays raw', left: '<img src="../a.png">', right: '<img src="a.png">', pairs: [] },
  { name: 'Unicode is not normalized', left: '<p>café</p>', right: '<p>café</p>', pairs: [] },
  { name: 'inert template does not duplicate', left: '<h1 data-test="a">Same</h1><template><h1>Same</h1></template>', right: '<h1 data-test="b">Same</h1>', pairs: ['a', 'b'] },
  { name: 'hidden matching remains eligible', left: '<p data-test="a" hidden>Same</p>', right: '<p data-test="b" hidden>Same</p>', pairs: ['a', 'b'] },
])('preserves serialized browser matching: $name', async ({ left, right, pairs }) => {
  let update!: () => void, finish!: () => void;
  const dom = new JSDOM(injectDeckStageFallback(`<!doctype html><html><head></head><body><deck-stage transition="magic-move"><section class="slide">${left}</section><section class="slide">${right}</section></deck-stage></body></html>`), {
    runScripts: 'dangerously', url: 'http://localhost', beforeParse(window) {
      Reflect.set(window, 'matchMedia', () => ({ matches: false }));
      Reflect.set(window.document, 'startViewTransition', (options: { update: () => void }) => { update = options.update; return { ready: Promise.resolve(), finished: new Promise<void>(resolve => { finish = resolve; }), skipTransition() { finish(); } }; });
    },
  });
  try {
    await new Promise<void>(resolve => dom.window.addEventListener('load', () => resolve(), { once: true }));
    const stage = dom.window.document.querySelector('deck-stage') as HTMLElement & { next(): void };
    const original = Array.from(stage.querySelectorAll('*')).map(element => [element, element.getAttribute('style')] as const);
    const slide = stage.querySelector('section')!;
    // The built public collector and serialized runtime both execute without module bindings.
    const source = canonicalDeckMorphCandidates<Element>(slide, { tag: e => e.localName, children: e => Array.from(e.children), attribute: (e, name) => e.getAttribute(name), text: e => e.textContent || '' });
    if (pairs.length) expect([...source.values()].filter(Boolean)).not.toHaveLength(0);
    stage.next();
    const named = () => Array.from(stage.querySelectorAll<HTMLElement>('*')).filter(element => element.style?.getPropertyValue('view-transition-name')?.startsWith('od-deck-object-')).map(element => element.getAttribute('data-test'));
    expect(named()).toEqual(pairs.length ? [pairs[0]] : []);
    expect(update).toBeTypeOf('function'); update();
    expect(named()).toEqual(pairs.length ? [pairs[1]] : []);
    finish(); await Promise.resolve();
    expect(named()).toEqual([]);
    for (const [element, style] of original) expect(element.getAttribute('style')).toBe(style);
  } finally { dom.window.close(); }
});
