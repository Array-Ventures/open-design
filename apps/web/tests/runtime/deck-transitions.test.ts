// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { injectDeckStageFallback } from '@open-design/contracts/runtime/deck-stage-fallback';

type Attempt = { update: () => void; types: string[]; finish: () => void; skip: ReturnType<typeof vi.fn> };
const documents: JSDOM[] = [];
afterEach(() => { for (const dom of documents.splice(0)) dom.window.close(); });
async function fixture(mode = 'magic-move', reduced = false, attributes = '', removedHead = false) {
  const attempts: Attempt[] = [];
  const dom = new JSDOM(injectDeckStageFallback(`<!doctype html><html><head></head><body>${removedHead ? '<script>document.head.remove()</script>' : ''}<deck-stage transition="${mode}" ${attributes}><section class="slide"><h1 style="view-transition-name:authored!important">Shared title</h1></section><section class="slide"><h1>Shared title</h1></section><section class="slide"><h1>Shared title</h1></section></deck-stage></body></html>`), {
    runScripts: 'dangerously', url: 'http://localhost',
    beforeParse(window) {
      Reflect.set(window, 'matchMedia', () => ({ matches: reduced }));
      Reflect.set(window.document, 'startViewTransition', (options: { update: () => void; types: string[] }) => {
        let finish!: () => void;
        const finished = new Promise<void>(resolve => { finish = resolve; });
        const skip = vi.fn(() => finish());
        attempts.push({ ...options, finish, skip });
        return { ready: Promise.resolve(), finished, skipTransition: skip };
      });
    },
  });
  documents.push(dom);
  await new Promise<void>(resolve => dom.window.addEventListener('load', () => resolve(), { once: true }));
  const stage = dom.window.document.querySelector('deck-stage') as unknown as HTMLElement & { goTo(index: number): void; index: number; next(): void; prev(): void };
  const active = () => dom.window.document.querySelector('[data-od-deck-active]');
  return { dom, stage, attempts, active };
}

describe('presentation transition lifecycle', () => {
  it('matches shared objects and restores exact authored styles after completion', async () => {
    const f = await fixture(), titles = f.stage.querySelectorAll('h1');
    f.stage.next(); expect(f.attempts).toHaveLength(1);
    expect(titles[0]!.style.getPropertyValue('view-transition-name')).toBe('od-deck-object-0');
    f.attempts[0]!.update(); expect(f.active()).toBe(f.stage.children[1]);
    expect(titles[0]!.style.getPropertyValue('view-transition-name')).toBe('authored');
    expect(titles[0]!.style.getPropertyPriority('view-transition-name')).toBe('important');
    expect(titles[1]!.style.getPropertyValue('view-transition-name')).toBe('od-deck-object-0');
    f.attempts[0]!.finish(); await Promise.resolve();
    expect(titles[1]!.hasAttribute('style')).toBe(false);
  });
  it('still initializes when authored content removed the head element', async () => {
    const f = await fixture('none', false, '', true);
    f.stage.next(); expect(f.active()).toBe(f.stage.children[1]);
  });

  it('keeps navigation working when the native API is unavailable or throws', async () => {
    const f = await fixture(); Reflect.deleteProperty(f.dom.window.document, 'startViewTransition');
    f.stage.next(); expect(f.active()).toBe(f.stage.children[1]);
    const g = await fixture(); Reflect.set(g.dom.window.document, 'startViewTransition', () => { throw new Error('Fixture API refusal'); });
    g.stage.next(); expect(g.active()).toBe(g.stage.children[1]);
    expect(g.stage.querySelectorAll('[style*="od-deck-object"]')).toHaveLength(0);
  });

  it('keeps the newest rapid navigation and ignores superseded callbacks', async () => {
    const f = await fixture(); f.stage.next(); f.stage.next();
    expect(f.attempts[0]!.skip).toHaveBeenCalledOnce();
    f.attempts[0]!.update(); expect(f.active()).toBe(f.stage.children[0]);
    f.attempts[1]!.update(); expect(f.active()).toBe(f.stage.children[2]);
    f.attempts[1]!.finish(); await Promise.resolve();
    expect(f.stage.querySelectorAll('[style*="od-deck-object"]')).toHaveLength(0);
  });
  for (const [mode, reduced, attributes, edit] of [['none', false, '', false], ['unknown', false, '', false], ['push', true, '', false], ['fade', false, 'noscale', false], ['magic-move', false, '', true]] as const) {
    it(`navigates instantly for ${mode}, reduced=${reduced}, ${attributes}, edit=${edit}`, async () => {
      const f = await fixture(mode, reduced, attributes);
      if (edit) f.dom.window.document.documentElement.setAttribute('data-od-edit-mode', '');
      f.stage.next(); expect(f.attempts).toHaveLength(0); expect(f.active()).toBe(f.stage.children[1]);
    });
  }
  it('uses navigation direction for Push and clamps invalid slide requests', async () => {
    const f = await fixture('push'); f.stage.next(); f.attempts[0]!.update();
    expect(f.attempts[0]!.types).toEqual(['od-deck-push', 'od-deck-forward']);
    f.stage.prev(); expect(f.attempts[1]!.types).toEqual(['od-deck-push', 'od-deck-backward']);
    f.attempts[1]!.update(); f.stage.goTo(-5); expect(f.stage.index).toBe(0);
    f.stage.goTo(1.9); expect(f.stage.index).toBe(1); f.stage.goTo(Number.NaN); expect(f.stage.index).toBe(1);
  });
  it('cleans up when Edit begins or the stage is removed', async () => {
    const f = await fixture(); f.stage.next(); f.attempts[0]!.update();
    f.dom.window.dispatchEvent(new f.dom.window.MessageEvent('message', { data: { type: 'od-edit-mode', enabled: true } }));
    expect(f.attempts[0]!.skip).toHaveBeenCalledOnce();
    expect(f.stage.querySelectorAll('[style*="od-deck-object"]')).toHaveLength(0);
    f.stage.next(); f.attempts[1]!.update(); f.stage.remove();
    expect(f.attempts[1]!.skip).toHaveBeenCalledOnce();
    expect(f.stage.querySelectorAll('[style*="od-deck-object"]')).toHaveLength(0);
  });
  it('avoids ambiguous duplicate matches and preserves later authored changes', async () => {
    const f = await fixture();
    for (const slide of Array.from(f.stage.children).slice(0, 2)) slide.append(slide.querySelector('h1')!.cloneNode(true));
    await Promise.resolve();
    f.stage.next(); expect(f.stage.querySelectorAll('[style*="od-deck-object"]')).toHaveLength(0);
    f.attempts[0]!.update(); f.attempts[0]!.finish(); await Promise.resolve();
    const g = await fixture(); g.stage.next(); g.attempts[0]!.update();
    const title = g.stage.children[1]!.querySelector('h1')!; title.style.setProperty('view-transition-name', 'later-authored');
    g.attempts[0]!.finish(); await Promise.resolve();
    expect(title.style.getPropertyValue('view-transition-name')).toBe('later-authored');
  });
});
