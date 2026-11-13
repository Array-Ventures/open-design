import { expect, it, vi } from 'vitest';
vi.mock('../../src/providers/registry', () => ({ projectFileUrl: (id: string, path: string) => `/projects/${id}/raw/${path.split('/').map(encodeURIComponent).join('/')}` }));
import { markdownDirectory, markdownImageProjectPath, markdownImageSourceUrl, markdownRelativeProjectPath } from '../../src/components/markdown-image-path';
it('resolves document-relative assets while preserving filename whitespace and URL escaping', () => {
  expect(markdownDirectory('notes/report .md')).toBe('notes');
  expect(markdownImageProjectPath('notes/report .md', '../images/%20figure%20.png')).toBe('images/ figure .png');
  expect(markdownImageSourceUrl('p', 'notes/report.md', '../images/a%23b.png?v=1')).toBe('/projects/p/raw/images/a%23b.png');
  expect(markdownRelativeProjectPath('notes/report.md', 'images/ figure .png')).toBe('../images/ figure .png');
});
it.each(['../../outside.png', '%2e%2e/%2e%2e/outside.png', '..\\outside.png', 'bad%GG.png'])('refuses an invalid or escaping image reference %s', src => {
  expect(markdownImageProjectPath('notes/report.md', src)).toBeNull();
});
it('keeps existing absolute image rendering separate from project path resolution', () => {
  expect(markdownImageSourceUrl('p', 'report.md', 'https://example.test/image.png')).toBe('https://example.test/image.png');
  expect(markdownImageProjectPath('report.md', 'https://example.test/image.png')).toBeNull();
  expect(() => markdownRelativeProjectPath('report.md', '../outside.png')).toThrow('outside');
});
