import { describe, expect, it } from 'vitest';
import { readDeckDimensions, resizeDeckSource } from '../../src/edit-mode/deck-properties';

describe('persisted presentation dimensions', () => {
  it('changes only opening-tag dimensions and retains authored width', () => {
    const source = `<!doctype html><!-- <deck-stage> --><script>const example='<deck-stage>';</script><deck-stage class='deck' width='1600' height='900'><section data-slide><h1>One</h1><aside>Speaker notes</aside><img src="assets/chart.svg"></section></deck-stage>`;
    const resized = resizeDeckSource(source, '4:3');
    expect(resized).toBe(source.replace("width='1600' height='900'", 'width="1600" height="1200"'));
    expect(readDeckDimensions(resized!)).toEqual({ width: 1600, height: 1200, aspect: '4:3' });
    expect(readDeckDimensions(resizeDeckSource(resized!, '16:9')!)).toEqual({ width: 1600, height: 900, aspect: '16:9' });
  });
  it('materializes runtime defaults when dimensions are absent', () => {
    expect(resizeDeckSource('<deck-stage><section>Slide</section></deck-stage>', '4:3')).toBe('<deck-stage width="1920" height="1440"><section>Slide</section></deck-stage>');
  });
  it('reads custom dimensions without pretending that they match a preset', () => {
    expect(readDeckDimensions('<deck-stage width="1000" height="1000"></deck-stage>')?.aspect).toBe('custom');
  });
  it('refuses missing or ambiguous stages and invalid preset inputs', () => {
    for (const source of ['<main>App</main>', '<deck-stage></deck-stage><deck-stage></deck-stage>', '<template><deck-stage></deck-stage></template>']) {
      expect(readDeckDimensions(source)).toBeNull();
      expect(resizeDeckSource(source, '4:3')).toBeNull();
    }
    expect(resizeDeckSource('<deck-stage></deck-stage>', 'square' as '4:3')).toBeNull();
  });
  it('matches runtime defaults for invalid authored dimensions', () => {
    expect(readDeckDimensions('<deck-stage width="NaN" height="-1"></deck-stage>')).toEqual({ width: 1920, height: 1080, aspect: '16:9' });
  });
});
