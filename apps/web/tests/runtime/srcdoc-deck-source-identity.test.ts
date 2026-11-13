// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSrcdoc } from '../../src/runtime/srcdoc';

const opened: JSDOM[] = [];
afterEach(() => { opened.splice(0).forEach(dom => dom.window.close()); });

function runtime(source: string, mutate?: (document: Document) => void) {
  const generated = buildSrcdoc(source, { deck: true, editBridge: true, transportActivationGeneration: 'current-document' });
  const dom = new JSDOM(generated, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://fixture.test' });
  opened.push(dom);
  const win = dom.window, messages = vi.fn();
  Object.defineProperty(win, 'parent', { configurable: true, value: { postMessage: messages } });
  win.scrollTo = vi.fn();
  mutate?.(win.document);
  for (const marker of ['data-od-deck-stage-fallback', 'data-od-deck-bridge']) {
    const script = win.document.querySelector(`script[${marker}]`);
    if (!script) throw new Error('Missing real deck runtime');
    win.eval(script.textContent ?? '');
  }
  win.dispatchEvent(new win.Event('load'));
  return { win, states: () => messages.mock.calls.map(call => call[0]).filter(value => value?.type === 'od:slide-state') };
}

it('retains pre-script source identity when authored code reorders an unchanged number of slides', async () => {
  const source = '<!doctype html><html data-od-deck-source-generation="forged"><body><deck-stage><div class="slide" data-od-source-path="forged">First</div><section data-screen-label="Second">Second</section></deck-stage></body></html>';
  const { win, states } = runtime(source, doc => {
    const stage = doc.querySelector('deck-stage')!;
    stage.prepend(stage.lastElementChild!);
  });
  expect(win.document.querySelector('deck-stage')!.firstElementChild!.textContent).toBe('Second');
  await vi.waitFor(() => expect(states().at(-1)).toMatchObject({ active: 0, count: 2, sourcePath: 'path-0-1', sourceGeneration: 'current-document' }));
});

it('does not advertise an editing identity when runtime clones duplicate a source-owned slide', async () => {
  const source = '<deck-stage><div class="slide">First</div><div class="slide">Second</div></deck-stage>';
  const { states } = runtime(source, doc => {
    const stage = doc.querySelector('deck-stage')!;
    stage.append(stage.firstElementChild!.cloneNode(true));
  });
  await vi.waitFor(() => expect(states().at(-1)).toMatchObject({ active: 0, count: 3 }));
  expect(states().at(-1)).not.toHaveProperty('sourcePath');
  expect(states().at(-1)).not.toHaveProperty('sourceGeneration');
});
