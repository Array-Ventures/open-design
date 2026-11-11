// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const write = vi.hoisted(() => vi.fn());
vi.mock('../../../src/providers/registry', () => ({ projectFileUrl: (id: string, name: string) => `/api/projects/${id}/raw/${name}`, writeProjectTextFileDetailed: write }));
import { readDocumentFile, saveDocumentFile } from '../../../src/components/embedded/document/document-file';
import { encodeMarkdownDocument } from '../../../src/components/embedded/document/markdown-document';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it('reads exact Markdown bytes and conditionally saves Markdown with a verifiable identity receipt', async () => {
  const bytes = new TextEncoder().encode('\uFEFF# Report\r\n\r\nReady.\r\n');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
  const observed = await readDocumentFile('fixture', 'report.md');
  expect(observed.format).toBe('markdown');
  expect(observed.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(new DOMParser().parseFromString(observed.html, 'text/html').querySelector('h1')?.textContent).toBe('Report');
  const content = encodeMarkdownDocument('# Report\n\nReviewed.', { version: 1, fonts: { text: 'sans', headings: 'serif' }, ids: { heading: ['title'], paragraph: ['body'] } });
  write.mockResolvedValue({ ok: true, version: { id: 'revision' } });
  const saved = await saveDocumentFile('fixture', 'report.md', content, observed);
  const stored = write.mock.calls[0]![2] as string;
  expect(stored).toContain('\n\n# Report\n\nReviewed.'); expect(stored).not.toContain('<!doctype');
  expect(write.mock.calls[0]![3]).toMatchObject({ expectedContentSha256: observed.sha256, versionSource: 'manual' });
  expect(saved.sha256).toBe(createHash('sha256').update(stored).digest('hex'));
  expect(saved.identities).toEqual({ heading: ['title'], paragraph: ['body'] });
  expect(saved.versionId).toBe('revision');
  await saveDocumentFile('fixture', 'report.md', content, observed);
  expect(write.mock.calls[1]![2]).toBe(stored);
});
