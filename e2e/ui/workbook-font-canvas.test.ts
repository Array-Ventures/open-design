// This canvas-only regression intentionally uses the base browser fixture:
// it does not start a daemon/web stack or touch a persistent browser session.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { workbookFontFamily } from '../../apps/web/src/components/embedded/workbook/grid-fonts.ts';
const require = createRequire(realpathSync(fileURLToPath(new URL('../../apps/web/node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url))));
const renderer = require('@univerjs/engine-render') as { getFontStyleString(style: { ff: string; fs: number }): { fontString: string } };
const executablePath = process.env.OD_WORKBOOK_CANVAS_CHROMIUM;
if (executablePath) test.use({ launchOptions: { executablePath } });

test('source-declared Swiss, Roman and Modern fallback survive the pinned renderer and native canvas', async ({ page }) => {
  const values = [1, 2, 3].map(family => {
    const ff = workbookFontFamily({ name: 'Workbook Missing Test Face', family }).value!;
    return { family, font: renderer.getFontStyleString({ ff, fs: 11 }).fontString };
  });
  const result = await page.evaluate(values => {
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    const sample = 'WWW iii 0123456789 Forecast';
    const measure = (font: string) => { context.font = font; return { font: context.font, width: context.measureText(sample).width }; };
    return { values: values.map(value => ({ ...value, measured: measure(value.font) })), serif: measure('11pt serif'), sans: measure('11pt sans-serif'), mono: measure('11pt monospace') };
  }, values);
  expect(result.values[0]!.measured.width).toBe(result.serif.width);
  expect(result.values[1]!.measured.width).toBe(result.sans.width);
  expect(result.values[2]!.measured.width).toBe(result.mono.width);
  expect(result.sans.width).not.toBe(result.serif.width);
  for (const value of result.values) expect(value.measured.font).not.toBe('10px sans-serif');
});

test('a safely quoted authored local face still wins over its generic fallback', async ({ page }) => {
  const name = 'Workbook Source Face; color: red';
  const font = renderer.getFontStyleString({ ff: workbookFontFamily({ name, family: 1 }).value!, fs: 11 }).fontString;
  const bytes = (await readFile(new URL('../../apps/web/public/fonts/inter-latin.woff2', import.meta.url))).toString('base64');
  const result = await page.evaluate(async ({ name, font, bytes }) => {
    const face = new FontFace(name, Uint8Array.from(atob(bytes), character => character.charCodeAt(0)).buffer);
    document.fonts.add(await face.load());
    const context = document.createElement('canvas').getContext('2d')!, sample = 'WWW iii 0123456789 Forecast';
    const width = (font: string) => { context.font = font; return context.measureText(sample).width; };
    return { actual: width(font), source: width(`11pt "${name}"`), generic: width('11pt serif') };
  }, { name, font, bytes });
  expect(result.actual).toBe(result.source); expect(result.actual).not.toBe(result.generic);
});
