import { expect, it } from 'vitest';
import { deckCaptureViewport, settleDeckCaptureViewport } from '../src/embedded-render/deck-capture-viewport.js';
const current = { width: 800, height: 450 };
const stage = (width: object, height: object) => [{ width, height }];
it('fits canonical default logical dimensions without rewriting authored slide size', () => {
  expect(deckCaptureViewport(current, stage({ logical: 1920, attribute: null, layout: 800 }, { logical: 1080, attribute: null, layout: 450 }))).toEqual({ width: 1920, height: 1080 });
});
it('preserves valid stage dimensions and a larger requested viewport', () => {
  const geometry = stage({ logical: 800, attribute: '800', layout: 320 }, { logical: 450, attribute: '450', layout: 240 });
  expect(deckCaptureViewport({ width: 320, height: 240 }, geometry)).toEqual(current);
  expect(deckCaptureViewport({ width: 2560, height: 1440 }, geometry)).toEqual({ width: 2560, height: 1440 });
});
it('supports custom stages with attributes or public layout but no logical getters', () => {
  expect(deckCaptureViewport(current, stage({ attribute: '1200', layout: 800 }, { attribute: '700', layout: 450 }))).toEqual({ width: 1200, height: 700 });
  expect(deckCaptureViewport(current, stage({ attribute: null, layout: 1000 }, { attribute: null, layout: 600 }))).toEqual({ width: 1000, height: 600 });
  expect(deckCaptureViewport(current, stage({ attribute: null, layout: 0 }, { attribute: null, layout: 0 }))).toEqual(current);
  expect(deckCaptureViewport(current, [])).toEqual(current);
});
it.each([0, -1, NaN, Infinity, 3841, '1920'])('refuses unbounded or malformed public logical width %s', logical => {
  expect(() => deckCaptureViewport(current, stage({ logical, attribute: null, layout: 800 }, { logical: 1080, attribute: null, layout: 450 }))).toThrow('export limit');
});
it('refuses excessive heights, malformed attributes and excessive stage counts', () => {
  expect(() => deckCaptureViewport(current, stage({ logical: 1920 }, { logical: 2161 }))).toThrow('export limit');
  expect(() => deckCaptureViewport(current, stage({ attribute: 'wrong', layout: 800 }, { attribute: null, layout: 450 }))).toThrow('export limit');
  expect(() => deckCaptureViewport(current, Array(201).fill({}))).toThrow('Invalid');
});

it('rounds a valid fractional canvas outward without permitting oversized authored slide layout', () => {
  expect(deckCaptureViewport(current, stage({ logical: 1920.5, attribute: null, layout: 800 }, { logical: 1080.5, attribute: null, layout: 450 }))).toEqual({ width: 1921, height: 1081 });
  expect(() => deckCaptureViewport(current, stage({ logical: 1920, layout: 5000 }, { logical: 1080, layout: 450 }))).toThrow('export limit');
});

it('remeasures after resize and refuses responsive growth beyond the capture bounds', async () => {
  let viewport = { width: 800, height: 450 };
  const resized: number[] = [];
  await expect(settleDeckCaptureViewport(async () => ({ viewport, stages: stage({ logical: 1920, layout: viewport.width * 2 }, { logical: 1080, layout: 450 }) }), async fitted => { viewport = fitted; resized.push(fitted.width); })).rejects.toThrow('export limit');
  expect(resized).toEqual([1920, 3840]);
});
it('accepts a stable remeasurement and refuses a nonsettling layout after four resizes', async () => {
  let viewport = { width: 800, height: 450 }, reads = 0;
  await settleDeckCaptureViewport(async () => { reads++; return { viewport, stages: stage({ logical: 1920, layout: 800 }, { logical: 1080, layout: 450 }) }; }, async fitted => { viewport = fitted; });
  expect(viewport).toEqual({ width: 1920, height: 1080 }); expect(reads).toBe(2);
  viewport = { width: 800, height: 450 }; let changes = 0;
  await expect(settleDeckCaptureViewport(async () => ({ viewport, stages: stage({ layout: viewport.width + 1, attribute: null }, { logical: 450 }) }), async fitted => { viewport = fitted; changes++; })).rejects.toThrow('did not settle');
  expect(changes).toBe(4);
});
