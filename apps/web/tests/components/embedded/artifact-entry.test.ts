import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '../../../src/types';
import type { EmbeddedDashboardSummary } from '../../../src/components/embedded/dashboards';
import { artifactEntry, artifactDashboard } from '../../../src/components/embedded/artifact-entry';
const file = (name: string, primary?: boolean): ProjectFile => ({ name, kind: name.endsWith('.md') ? 'text' : 'html', size: 1, mtime: 1, mime: 'text/html', ...(primary === undefined ? {} : { artifactManifest: { version: 1, kind: 'markdown-document', title: 'Report', entry: name, renderer: 'markdown', exports: ['md'], primary } }) });
const dashboard = (hostTemplatePath: string) => ({ id: 'snapshot', hostTemplatePath, status: 'active' }) as EmbeddedDashboardSummary;
describe('artifact entry intent', () => {
  it('opens a typed workbook before supporting HTML and preserves a selected XLSX type', () => {
    const files = [file('index.html'), { ...file('reports/book.xlsx'), kind: 'spreadsheet' as const }];
    expect(artifactEntry(files, null, 'workbook')).toMatchObject({ kind: 'workbook', file: { name: 'reports/book.xlsx' } });
    expect(artifactEntry(files, 'reports/book.xlsx', 'deck')?.kind).toBe('workbook');
  });
  it('uses a declared primary document ahead of a supporting HTML app', () => {
    const files = [file('index.html'), file('report.md', true)];
    expect(artifactEntry(files, null)).toMatchObject({ file: { name: 'report.md' }, kind: 'document', title: 'Report' });
    expect(artifactDashboard(files, [dashboard('index.html')], null)).toBeUndefined();
  });
  it('keeps a declared template on its scriptless rendered snapshot', () => {
    const files = [file('index.html'), file('template.html', true)];
    expect(artifactDashboard(files, [dashboard('template.html')], null)?.id).toBe('snapshot');
  });
  it('preserves explicit user file selection ahead of manifest intent', () => {
    expect(artifactEntry([file('index.html'), file('report.md', true)], 'index.html')?.file.name).toBe('index.html');
  });
  it.each(['.env', '../index.html', 'nested/.private.html', 'a\\b.html', '/index.html'])('does not expose an invalid or private entry %s', name => {
    expect(artifactEntry([file(name, true)], name)).toBeNull();
  });
  it('never selects a directory as an artifact', () => {
    expect(artifactEntry([{ ...file('index.html', true), type: 'dir' }], null)).toBeNull();
  });
});

it('opens the actual media for a typed media project instead of a supporting index page', () => {
  for (const kind of ['image', 'video', 'audio'] as const) {
    const media = { ...file(`assets/output.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`), kind };
    const supporting = file('index.html');
    expect(artifactEntry([supporting, media], null, kind)).toMatchObject({ kind, file: { name: media.name } });
    // Declared primary intent and explicit selection continue to win.
    const declared = file('report.md', true);
    expect(artifactEntry([supporting, media, declared], null, kind)?.file.name).toBe('report.md');
    expect(artifactEntry([supporting, media], 'index.html', kind)?.file.name).toBe('index.html');
  }
});

it('never treats captured feedback images as the artifact primary', () => {
  const captured = { ...file('_studio-comments/mark.png'), kind: 'image' as const };
  const image = { ...file('assets/hero.png'), kind: 'image' as const };
  expect(artifactEntry([captured, image], null, 'image')?.file.name).toBe('assets/hero.png');
  expect(artifactEntry([captured], null, 'image')).toBeNull();
  expect(artifactEntry([captured, file('index.html')], captured.name)?.file.name).toBe('index.html');
});


it('keeps supporting document images out of primary selection and prefers a typed document', () => {
  const uploaded = { ...file('_studio-document-assets/image.png'), kind: 'image' as const };
  expect(artifactEntry([uploaded, file('report.md')], null)?.file.name).toBe('report.md');
  expect(artifactEntry([{ ...file('images/photo.png'), kind: 'image' }, file('report.md'), file('index.html')], null, 'document')?.file.name).toBe('report.md');
  expect(artifactEntry([{ ...file('report.markdown'), kind: 'text' }], null)?.kind).toBe('document');
});

it('opens CSV as the existing Sheets artifact without pretending it is HTML or converting its source', () => {
  const csv = { ...file('reports/literal.csv'), kind: 'spreadsheet' as const, mime: 'text/csv' };
  expect(artifactEntry([file('index.html'), csv], null, 'workbook')).toMatchObject({ kind: 'workbook', file: { name: 'reports/literal.csv' } });
  expect(artifactEntry([csv], csv.name, 'document')).toMatchObject({ kind: 'workbook', file: { mime: 'text/csv' } });
});
