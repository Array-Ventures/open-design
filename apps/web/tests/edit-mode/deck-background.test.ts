// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';
import { deckSlideIndexForSourcePath, readDeckSlideBackground, setDeckSlideBackground } from '../../src/edit-mode/deck-background';

describe('slide-local background source ownership', () => {
  it('changes only the selected opening tag, preserving source, other slides and notes', () => {
    const source = `<script>const example='<section class="slide">';</script><deck-stage><section class='slide' style='background:#fff; padding:4px'>One<aside>Notes</aside></section><!-- keep --><section class='slide'>Two</section></deck-stage>`;
    const next = setDeckSlideBackground(source, 1, '#123456')!;
    expect(next).toBe(source.replace("<section class='slide'>Two", "<section class='slide' style=\"background-color: #123456 !important;\">Two"));
    expect(readDeckSlideBackground(next, 1)).toEqual({color:'#123456',count:2,editable:true});
    expect(readDeckSlideBackground(next, 0)?.color).toBe('#fff');
  });
  it('preserves other inline properties, shorthand images and escaped values', () => {
    const source = `<deck-stage><section class="slide" style="background:url(&quot;assets/a&amp;b.svg&quot;) center/cover; padding: 8px">Slide</section></deck-stage>`;
    const next = setDeckSlideBackground(source, 0, '#abcdef')!;
    const parsed = new DOMParser().parseFromString(next,'text/html').querySelector<HTMLElement>('section')!;
    expect(parsed.style.backgroundImage).toContain('assets/a&b.svg');
    expect(parsed.style.padding).toBe('8px');
    expect(parsed.style.backgroundColor).toBe('rgb(171, 205, 239)');
    // jsdom expands background shorthand and loses its longhand priority metadata.
    // Assert the actual saved declaration; packaged Chromium checks its cascade.
    const declaration = postcss.parse(parsed.getAttribute('style')!).nodes.at(-1);
    expect(declaration).toMatchObject({type:'decl',prop:'background-color',value:'#abcdef',important:true});
    expect(setDeckSlideBackground(next,0,'#abcdef')).toBe(next);
  });
  it('uses the stage runtime order, ignoring nested slide content and templates', () => {
    const source = '<deck-stage><template><div class="slide">Inert</div></template><main><section class="slide">One<div class="slide">Nested content</div></section><section data-screen-label="Two">Two</section></main></deck-stage>';
    expect(readDeckSlideBackground(source,0)?.count).toBe(2);
    expect(setDeckSlideBackground(source,1,'#123456')).toContain('data-screen-label="Two" style=');
    const direct = source.replace('</deck-stage>','<section class="slide">Direct</section></deck-stage>');
    expect(readDeckSlideBackground(direct,0)?.count).toBe(1);
    expect(setDeckSlideBackground(direct,0,'#123456')).toContain('class="slide" style="background-color: #123456 !important;">Direct');
  });
  it('refuses ambiguous stages, stale indexes and CSS payloads', () => {
    for (const source of ['<main>App</main>','<deck-stage></deck-stage><deck-stage></deck-stage>']) expect(setDeckSlideBackground(source,0,'#123456')).toBeNull();
    const source='<deck-stage><section class="slide">One</section></deck-stage>';
    for(const index of [-1,1,0.5,NaN]) expect(setDeckSlideBackground(source,index,'#123456')).toBeNull();
    for(const color of ['red','url(https://example.test)','red;display:none','#123','var(--brand)']) expect(setDeckSlideBackground(source,0,color)).toBeNull();
  });
  it('preflights unwriteable inline CSS and preserves alpha colors', () => {
    for (const style of ['color:red; broken','.injected { color:red }']) {
      const source=`<deck-stage><section class="slide" style="${style}">One</section></deck-stage>`;
      expect(readDeckSlideBackground(source,0)?.editable).toBe(false);
      expect(setDeckSlideBackground(source,0,'#123456')).toBeNull();
    }
    const source='<deck-stage><section class="slide">One</section></deck-stage>';
    const next=setDeckSlideBackground(source,0,'#12345680')!;
    expect(next).toContain('background-color: #12345680 !important;');
    expect(readDeckSlideBackground(next,0)?.color).toBe('#12345680');
  });
  it('reads cascade colors without a DOM and keeps contextual values unresolved', () => {
    const source='<deck-stage><section class="slide" style="background:red!important;background-color:blue">One</section></deck-stage>';
    vi.stubGlobal('document',undefined);
    try {
      expect(readDeckSlideBackground(source,0)?.color).toBe('rgb(255, 0, 0)');
      expect(setDeckSlideBackground(source,0,'#123456')).toContain('background-color:#123456 !important;');
      expect(readDeckSlideBackground(source.replace('red','var(--brand)'),0)?.color).toBe('var(--brand)');
    } finally {vi.unstubAllGlobals();}
  });
});

it('maps element-only source ancestry independently of runtime order and ignores authored reserved paths', () => {
  const source = '<!doctype html><html><body><!-- skip --><script>window.before=true</script><deck-stage><div class="slide" data-od-source-path="path-forged">One</div> text <section data-screen-label="Two">Two</section></deck-stage></body></html>';
  expect(deckSlideIndexForSourcePath(source,'path-1-0')).toBe(0);
  expect(deckSlideIndexForSourcePath(source,'path-1-1')).toBe(1);
  for (const path of ['path-forged','path-0','path-1','path-1-2','path--1','path-1-0-0']) expect(deckSlideIndexForSourcePath(source,path)).toBeNull();
});
it('matches the visual tree after notes are stripped without moving the source write target', () => {
  const source = '<body><script id="speaker-notes" type="application/json">["One","Two"]</script><deck-stage><div class="slide">One</div><section class="slide">Two</section></deck-stage></body>';
  expect(deckSlideIndexForSourcePath(source,'path-0-1')).toBe(1);
  expect(setDeckSlideBackground(source,deckSlideIndexForSourcePath(source,'path-0-1')!,'#123456')).toBe(source.replace('class="slide">Two','class="slide" style="background-color: #123456 !important;">Two'));
  expect(deckSlideIndexForSourcePath(source,'path-1-1')).toBeNull();
});
