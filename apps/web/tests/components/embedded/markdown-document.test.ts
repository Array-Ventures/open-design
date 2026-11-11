// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encodeMarkdownDocument, finalizeMarkdownDocument, readMarkdownDocument } from '../../../src/components/embedded/document/markdown-document';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
it('renders real Markdown headings, GFM tables, checked items and code without changing the source body', async () => {
  const source = '# Report\n\n**Ready** for review.\n\n| Metric | Value |\n| --- | --- |\n| Customers | 24 |\n\n- [x] Complete\n- [ ] Pending\n\n```js\nconst count = 24;\n```\n';
  const result = await readMarkdownDocument(source, 'Report');
  const doc = new DOMParser().parseFromString(result.html, 'text/html');
  expect(doc.querySelector('h1')?.textContent).toBe('Report'); expect(doc.querySelector('strong')?.textContent).toBe('Ready');
  expect(doc.querySelectorAll('tr')).toHaveLength(2); expect(doc.querySelectorAll('input')).toHaveLength(0);
  expect([...doc.querySelectorAll('li')].map(item => item.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  expect(doc.querySelector('pre')?.getAttribute('data-language')).toBe('js'); expect(doc.querySelector('code')?.textContent).toContain('const count = 24;');
});
it('restores block identities only for a matching body receipt while retaining declared fonts', async () => {
  const pending = encodeMarkdownDocument('# Report\n\nReady.', { version: 1, fonts: { text: 'sans', headings: 'serif' }, ids: { heading: ['title'], paragraph: ['summary'] } });
  const saved = await finalizeMarkdownDocument(pending);
  expect((await readMarkdownDocument(saved, 'Report')).identities).toEqual({ heading: ['title'], paragraph: ['summary'] });
  const edited = await readMarkdownDocument(saved.replace('Ready.', 'Changed externally.'), 'Report');
  expect(edited.identities).toBeUndefined(); expect(edited.html).toContain('data-eve-document-heading-font="serif"');
  expect(await finalizeMarkdownDocument(pending)).toBe(saved);
});
it('rejects malformed metadata and escapes GFM-disallowed script tags', async () => {
  const result = await readMarkdownDocument('<!-- eve-document:!!! -->\n\n# Report\n\n<script>bad()</script>', 'Report');
  expect(result.identities).toBeUndefined();
  // GFM tag filtering escapes script tags before the document sanitizer runs.
  const doc = new DOMParser().parseFromString(result.html, 'text/html');
  expect(doc.querySelector('script')).toBeNull();
  expect(doc.body.textContent).toContain('<script>bad()</script>');
});
