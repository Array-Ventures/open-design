import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('next/package.json'))('postcss');
const plugin = require('../../postcss-embedded-fonts.cjs');
const policy = require('../../embedded-fonts.json');
const embeddedFonts = (options: { basePath: string }) => plugin({ ...options, fonts: policy.fonts });

describe('embedded reviewed font assets', () => {
  it('processes the actual UI stylesheet with approved mounted font faces and a system mono fallback', async () => {
    const css = await readFile(new URL('../../src/styles/base.css', import.meta.url), 'utf8');
    const result = await postcss([embeddedFonts({ basePath: '/studio' })]).process(css, { from: undefined });
    const sources: string[] = [];
    result.root.walkAtRules('font-face', (rule: { walkDecls: (name: string, read: (declaration: { value: string }) => void) => void }) => rule.walkDecls('src', declaration => sources.push(declaration.value)));
    expect(sources).toHaveLength(2);
    expect(sources.every(source => source.includes('/studio/fonts/AlbertSans-'))).toBe(true);
    expect(sources.some(source => source.includes('JiduMono'))).toBe(false);
  });
  it('mounts every Inter subset used by the embedded workspace and retains its notice', async () => {
    const css = await readFile(new URL('../../src/components/embedded/EmbeddedStudio.module.css', import.meta.url), 'utf8');
    const result = await postcss([embeddedFonts({ basePath: '/studio' })]).process(css, { from: undefined });
    const sources: string[] = [];
    result.root.walkAtRules('font-face', (rule: { walkDecls: (name: string, read: (declaration: { value: string }) => void) => void }) => rule.walkDecls('src', declaration => sources.push(declaration.value)));
    expect(sources).toHaveLength(4);
    for (const subset of ['latin', 'latin-ext', 'cyrillic', 'greek']) {
      const name = `inter-${subset}.woff2`;
      expect(policy.fonts).toContain(name);
      expect(sources.some(source => source.includes(`/studio/fonts/${name}`))).toBe(true);
      const bytes = await readFile(new URL(`../../public/fonts/${name}`, import.meta.url));
      expect(bytes.subarray(0, 4).toString()).toBe('wOF2');
    }
    expect(policy.notices).toContain('LICENSE-Inter.txt');
    expect(await readFile(new URL('../../public/fonts/LICENSE-Inter.txt', import.meta.url), 'utf8')).toContain('SIL OPEN FONT LICENSE');
  });
  it('supports nested mounts, is idempotent and leaves ordinary CSS alone', async () => {
    const css = '@font-face{font-family:Albert;src:url(/fonts/AlbertSans-VariableFont_wght.ttf)} .code{font-family:"JiduMono Pro",monospace}';
    const first = await postcss([embeddedFonts({ basePath: '/app/studio' })]).process(css, { from: undefined });
    expect(first.css).toContain('/app/studio/fonts/AlbertSans-VariableFont_wght.ttf');
    expect(first.css).toContain('font-family:"JiduMono Pro",monospace');
    const second = await postcss([embeddedFonts({ basePath: '/app/studio' })]).process(first.css, { from: undefined });
    expect(second.css).toBe(first.css);
  });
  it('omits font assets when no reviewed list is supplied', async () => {
    const result = await postcss([plugin()]).process('@font-face{font-family:Unknown;src:url(/fonts/unknown.ttf)}', { from: undefined });
    expect(result.css).toBe('');
  });
  it('refuses an invalid mount rather than generating an external or escaped font URL', () => {
    for (const basePath of ['//other.example', '/../studio', '/studio/"bad']) expect(() => embeddedFonts({ basePath })).toThrow('Invalid embedded font mount');
  });
});
