// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { workbookGridTheme } from '../../src/components/embedded/workbook/grid-theme';
afterEach(() => { vi.restoreAllMocks(); document.documentElement.removeAttribute('style'); delete document.documentElement.dataset.theme; });
it('resolves CSS Color 4 values through sRGB and avoids double-inverting the dark palette', () => {
  const root = document.documentElement;
  root.style.setProperty('--color-background-primary-default', 'lab(15.204% 0 0)'); root.style.setProperty('--color-text-primary', 'lab(98.26% 0 0)');
  let fill = '';
  const context = { clearRect: vi.fn(), fillRect: vi.fn(), get fillStyle() { return fill; }, set fillStyle(value: string) { fill = value; },
    getImageData: () => ({ data: new Uint8ClampedArray(fill.startsWith('lab(15') ? [38, 38, 38, 255] : [250, 250, 250, 255]) }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  root.dataset.theme = 'dark'; const dark = workbookGridTheme(root);
  expect(dark.gray[0]).toBe('#fafafa'); expect(dark.gray[900]).toBe('#262626');
  root.dataset.theme = 'light'; const light = workbookGridTheme(root);
  expect(light.gray[0]).toBe('#262626'); expect(light.gray[900]).toBe('#fafafa');
  expect(context.clearRect).toHaveBeenCalled();
});
