import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { documentCommentAnchorHint, readDocumentCommentAnchorHint } from '@open-design/contracts';
import { closeDatabase, openDatabase, insertProject, insertConversation, upsertPreviewComment, getPreviewComment } from '../src/db.js';
import { writePreviewCommentOnce } from '../src/storage/preview-comment-writes.js';
let directory: string | undefined;
afterEach(() => { closeDatabase(); if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });
function fixture() {
  directory = mkdtempSync(path.join(os.tmpdir(), 'od-document-comment-'));
  const db = openDatabase(directory); insertProject(db, { id: 'project', name: 'Fixture', createdAt: 1, updatedAt: 1 }); insertConversation(db, { id: 'conversation', projectId: 'project', title: 'Fixture', createdAt: 1, updatedAt: 1 });
  const quote = ' exact  spaces\nUnicode 😀 & "quotes" <text> '.repeat(20);
  const anchor = { version: 1 as const, start: { block: 'block-first', offset: 0 }, end: { block: 'block-last', offset: quote.length }, quote };
  const target = { filePath: 'report.md', elementId: 'block-first', selector: '[data-od-id="block-first"]', label: 'Selected text', text: quote, position: { x: 0, y: 0, width: 0, height: 0 }, htmlHint: documentCommentAnchorHint(anchor) };
  const read = (id: string) => getPreviewComment(db, 'project', 'conversation', id);
  const input = { projectId: 'project', conversationId: 'conversation', author: 'person', operationId: 'create', target, note: 'Review this' };
  const create = () => upsertPreviewComment(db, 'project', 'conversation', { ...input, authorMemberId: input.author })!;
  return { db, anchor, target, read, input, create };
}
it('roundtrips full structured anchors through actual SQLite, replay, CAS and database reopen', () => {
  const { db, anchor, target, read, input, create } = fixture();
  const saved = writePreviewCommentOnce(db, input, read, create);
  expect(saved.htmlHint.length).toBeGreaterThan(180); expect(saved.htmlHint).toBe(target.htmlHint); expect(readDocumentCommentAnchorHint(saved.htmlHint)).toEqual(anchor);
  expect(writePreviewCommentOnce(db, input, read, () => { throw Error('must not write twice'); })).toEqual(saved);
  const edit = { ...input, id: saved.id, operationId: 'edit', expectedEditToken: saved.editToken!, note: 'Edited note' };
  const updated = writePreviewCommentOnce(db, edit, read, () => upsertPreviewComment(db, 'project', 'conversation', { ...edit, authorMemberId: input.author })!);
  expect(updated.htmlHint).toBe(saved.htmlHint); expect(updated.editToken).not.toBe(saved.editToken);
  expect(() => writePreviewCommentOnce(db, { ...edit, operationId: 'stale' }, read, create)).toThrow('COMMENT_EDIT_CONFLICT');
  expect(() => writePreviewCommentOnce(db, { ...edit, operationId: 'foreign', author: 'other', expectedEditToken: updated.editToken! }, read, create)).toThrow('COMMENT_FORBIDDEN');
  expect(db.prepare('SELECT COUNT(*) AS count FROM preview_comment_writes').get()).toEqual({ count: 2 });
  closeDatabase(); const reopened = openDatabase(directory!); expect(getPreviewComment(reopened, 'project', 'conversation', saved.id)?.htmlHint).toBe(target.htmlHint);
});
it('rejects invalid structured hints atomically and preserves generic HTML normalization', () => {
  const { db, target, read, input } = fixture();
  for (const hint of ['eve-document-anchor:{', documentCommentAnchorHint({ version: 1, start: { block: 'a', offset: 0 }, end: { block: 'a', offset: 1 }, quote: 'x' }).replace('"version":1', '"version":2'), 'eve-document-anchor:' + 'x'.repeat(30_001)]) {
    const invalid = { ...input, operationId: hint.slice(-20), target: { ...target, htmlHint: hint } };
    expect(() => writePreviewCommentOnce(db, invalid, read, () => upsertPreviewComment(db, 'project', 'conversation', invalid)!)).toThrow('Invalid structured');
  }
  expect(db.prepare('SELECT COUNT(*) AS count FROM preview_comments').get()).toEqual({ count: 0 }); expect(db.prepare('SELECT COUNT(*) AS count FROM preview_comment_writes').get()).toEqual({ count: 0 });
  const html = ' <h1>\n' + 'generic '.repeat(40) + '</h1> ';
  const saved = upsertPreviewComment(db, 'project', 'conversation', { target: { ...target, htmlHint: html }, note: 'Legacy' })!;
  expect(saved.htmlHint).toBe(html.replace(/\s+/g, ' ').trim().slice(0, 180));
});
