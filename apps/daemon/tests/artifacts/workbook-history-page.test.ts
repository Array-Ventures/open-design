import { expect, it } from 'vitest';
import { workbookHistoryPage } from '../../src/artifacts/workbook/history-page.js';
const scope = { projectId: 'project', fileName: 'book.xlsx', limit: 50 };
it('returns bounded explicit pages and stable cursors without admitting newer revisions into a previous snapshot', () => {
  const all = Array.from({ length: 201 }, (_, index) => ({ id: 'v' + (index + 1), version: index + 1, label: 'x'.repeat(4000) }));
  const seen: string[] = []; let cursor: string | null = null;
  do {
    const page = workbookHistoryPage(all, { ...scope, ...(cursor ? { cursor } : {}) });
    expect(page.versions.length).toBeLessThanOrEqual(50); seen.push(...page.versions.map(item => item.id)); cursor = page.nextCursor;
    if (seen.length === 50) all.push({ id: 'new', version: 202, label: 'new' });
  } while (cursor);
  expect(seen).toHaveLength(201); expect(new Set(seen).size).toBe(201); expect(seen).not.toContain('new'); expect(seen[0]).toBe('v201');
});
it('rejects malformed/cross-artifact cursors and unbounded page sizes', () => {
  const cursor = workbookHistoryPage([{ id: 'v1', version: 1 }, { id: 'v2', version: 2 }], { ...scope, limit: 1 }).nextCursor!;
  for (const options of [{ ...scope, fileName: 'other.xlsx', cursor }, { ...scope, projectId: 'other', cursor }, { ...scope, cursor: 'bad' }, { ...scope, limit: 101 }]) expect(() => workbookHistoryPage([], options)).toThrow('cursor');
  expect(workbookHistoryPage([], scope)).toEqual({ versions: [], nextCursor: null });
});
