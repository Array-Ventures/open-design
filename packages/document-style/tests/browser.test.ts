// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { documentTextInk, documentContrast, documentColorReader, type DocumentColor } from '../src/browser.js';
const colors: Record<string, DocumentColor> = { black: [0,0,0,1], white: [255,255,255,1], 'rgb(0, 0, 0)': [0,0,0,1], 'rgb(255, 255, 255)': [255,255,255,1], 'rgb(242, 243, 245)': [242,243,245,1], 'rgba(255, 255, 255, 0.5)': [255,255,255,.5], 'rgba(0, 0, 0, 0)': [0,0,0,0], 'rgb(30, 30, 30)': [30,30,30,1] };
const read = (value: string) => colors[value] ?? null;
afterEach(() => { document.body.replaceChildren(); document.body.removeAttribute('style'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('uses gamma-correct WCAG contrast, not a brightness heuristic', () => {
  expect(documentContrast([0,0,0,1], [255,255,255,1])).toBe(21);
  expect(documentContrast([128,128,128,1], [255,255,255,1])).toBeCloseTo(3.95, 2);
  expect(documentContrast([128,128,128,1], [0,0,0,1])).toBeCloseTo(5.32, 2);
});
it.each([
  ['white', 'rgb(242, 243, 245)', 'black'], ['black', 'rgb(30, 30, 30)', 'white'],
  ['black', 'rgb(242, 243, 245)', null], ['white', 'rgb(30, 30, 30)', null],
] as const)('only repairs inadequate inherited %s ink on %s', (ink, background, expected) => {
  document.body.style.backgroundColor = 'white';
  document.body.innerHTML = `<table><tr><th style="color:${ink};background-color:${background}">Header</th></tr></table>`;
  expect(documentTextInk(document.querySelector('th')!, read)).toBe(expected);
});
it('composites translucent cell and ancestor backgrounds before measuring contrast', () => {
  document.body.style.backgroundColor = 'black';
  document.body.innerHTML = '<table><tr><th style="color:white;background-color:rgba(255,255,255,.5)">Header</th></tr></table>';
  expect(documentTextInk(document.querySelector('th')!, read)).toBe('black');
});
it('does not guess unknown colors or an unowned transparent canvas', () => {
  document.body.innerHTML = '<table><tr><th style="color:white">Header</th></tr></table>';
  const cell = document.querySelector('th')!;
  expect(documentTextInk(cell, read)).toBe(null);
  cell.style.backgroundColor = 'red'; expect(documentTextInk(cell, read)).toBe(null);
});

it('treats unavailable or failing canvas color reads as a cosmetic no-op', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('No canvas'); });
  expect(documentColorReader(document)('white')).toBe(null);
});

it('does not throw when a canvas exists but pixel extraction fails', () => {
  vi.stubGlobal('CSS', { supports: () => true });
  const context = { clearRect() {}, fillRect() {}, fillStyle: '', getImageData() { throw new Error('Pixel read failed'); } };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  expect(documentColorReader(document)('white')).toBe(null);
});
