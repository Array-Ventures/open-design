import { describe, expect, it } from 'vitest';
import { insertionPlacement, type InsertionSurface } from '../../src/edit-mode/insertion-placement';
const surface: InsertionSurface = {
  rect: { left: 100, top: 200, width: 500, height: 300 },
  offsetWidth: 1000, offsetHeight: 600, clientWidth: 980, clientHeight: 580,
  clientLeft: 10, clientTop: 10, scrollLeft: 0, scrollTop: 0,
};
const text = { kind: 'text', text: 'New text' } as const;
describe('insertion coordinates', () => {
  it('maps a scaled bordered canvas to authored CSS pixels', () => {
    expect(insertionPlacement(surface, { x: 155, y: 255 }, { x: 255, y: 305 }, text))
      .toEqual({ left: 100, top: 100, width: 200, height: 100 });
  });
  it('includes the containing block scroll exactly once', () => {
    expect(insertionPlacement({ ...surface, scrollLeft: 30, scrollTop: 240 }, { x: 155, y: 255 }, null, text))
      .toEqual({ left: 130, top: 340, width: 240, height: 48 });
  });
  it('keeps click defaults inside the visible canvas at its bottom right', () => {
    expect(insertionPlacement(surface, { x: 595, y: 495 }, null, text))
      .toEqual({ left: 740, top: 532, width: 240, height: 48 });
  });
  it('clamps a drag leaving the canvas without changing the container', () => {
    expect(insertionPlacement(surface, { x: 155, y: 255 }, { x: 900, y: 900 }, text))
      .toEqual({ left: 100, top: 100, width: 880, height: 480 });
  });
  it('preserves reversed arrow direction, including horizontal lines', () => {
    expect(insertionPlacement(surface, { x: 255, y: 305 }, { x: 155, y: 305 }, { kind: 'shape', shape: 'arrow' }))
      .toEqual({ left: 100, top: 200, width: 200, height: 1, flipX: true, flipY: false });
  });
  it('uses viewport pixels for the drag threshold at any zoom', () => {
    expect(insertionPlacement(surface, { x: 155, y: 255 }, { x: 156, y: 256 }, text)?.width).toBe(240);
  });
  it.each([{ x: 100, y: 200 }, { x: 99, y: 255 }, { x: 900, y: 255 }, { x: NaN, y: 255 }])('refuses a start outside the inner canvas: %j', start => {
    expect(insertionPlacement(surface, start, null, text)).toBeNull();
  });
  it.each([{ offsetWidth: 0 }, { clientHeight: 0 }, { scrollTop: -1 }, { scrollTop: Infinity }, { scrollTop: 100001 }])('refuses invisible or unrepresentable geometry: %j', change => {
    expect(insertionPlacement({ ...surface, ...change }, { x: 155, y: 255 }, null, text)).toBeNull();
  });
  it('sizes a table using its real rows and columns and fits small canvases', () => {
    expect(insertionPlacement(surface, { x: 155, y: 255 }, null, { kind: 'table', rows: 3, columns: 2 }))
      .toEqual({ left: 100, top: 100, width: 240, height: 120 });
    expect(insertionPlacement({ ...surface, clientWidth: 100, clientHeight: 80 }, { x: 105, y: 205 }, null, { kind: 'image', src: 'image.png', alt: '' }))
      .toEqual({ left: 0, top: 0, width: 100, height: 80 });
  });
});
