import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, deletePreviewComment, deleteProject, getPreviewComment, insertConversation, insertProject, openDatabase, updatePreviewCommentAnchor, updatePreviewCommentStatus, upsertPreviewComment } from '../src/db.js';
import { migratePreviewCommentWrites, previewCommentEditToken, writePreviewCommentOnce } from '../src/storage/preview-comment-writes.js';
let directory: string | undefined;
afterEach(() => { closeDatabase(); if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });
const target = { filePath: 'index.html', elementId: 'heading', selector: 'h1', label: 'Heading', text: '', position: { x: 1, y: 2, width: 100, height: 20 }, htmlHint: '' };
function fixture() {
  directory = mkdtempSync(path.join(os.tmpdir(), 'od-root-writes-'));
  const db = openDatabase(directory);
  insertProject(db, { id: 'project', name: 'Fixture', createdAt: 1, updatedAt: 1 });
  insertConversation(db, { id: 'conversation', projectId: 'project', title: 'Fixture', createdAt: 1, updatedAt: 1 });
  const input = { projectId: 'project', conversationId: 'conversation', author: 'person', operationId: 'create-once', target, note: 'Root' };
  const read = (id: string) => getPreviewComment(db, 'project', 'conversation', id);
  const create = () => upsertPreviewComment(db, 'project', 'conversation', { target, note: input.note, authorMemberId: input.author }, { preserveStatus: true })!;
  return { db, input, read, create };
}
it('rolls back both the root and receipt when downstream intent creation fails', () => {
  const { db, input, read, create } = fixture();
  expect(() => writePreviewCommentOnce(db, input, read, () => { create(); throw Error('intent failed'); })).toThrow('intent failed');
  expect(db.prepare('SELECT COUNT(*) AS count FROM preview_comments').get()).toEqual({ count: 0 });
  expect(db.prepare('SELECT COUNT(*) AS count FROM preview_comment_writes').get()).toEqual({ count: 0 });
  const saved = writePreviewCommentOnce(db, input, read, create);
  expect(writePreviewCommentOnce(db, input, read, () => { throw Error('must not run'); })).toEqual(saved);
});
it('does not replay an old edit over a later edit and retains deletion receipts', () => {
  const { db, input, read, create } = fixture();
  const root = writePreviewCommentOnce(db, input, read, create);
  const edit = { ...input, id: root.id, operationId: 'edit-once', expectedEditToken: root.editToken!, note: 'First edit' };
  const first = writePreviewCommentOnce(db, edit, read, () => upsertPreviewComment(db, 'project', 'conversation', edit, { preserveStatus: true })!);
  const later = { ...edit, operationId: 'edit-later', expectedEditToken: first.editToken!, note: 'Later edit' };
  const latest = writePreviewCommentOnce(db, later, read, () => upsertPreviewComment(db, 'project', 'conversation', later, { preserveStatus: true })!);
  expect(writePreviewCommentOnce(db, edit, read, () => { throw Error('must not run'); })).toEqual(latest);
  deletePreviewComment(db, 'project', 'conversation', root.id);
  expect(() => writePreviewCommentOnce(db, input, read, create)).toThrow('COMMENT_DELETED');
  expect(db.prepare('SELECT COUNT(*) AS count FROM preview_comment_writes').get()).toEqual({ count: 3 });
  deleteProject(db, 'project');
  expect(db.prepare('SELECT COUNT(*) AS count FROM preview_comment_writes').get()).toEqual({ count: 0 });
});
it('scopes receipts to the authenticated author and hashes image intent and target content', () => {
  const { db, input, read, create } = fixture();
  const first = writePreviewCommentOnce(db, input, read, create);
  for (const patch of [{ note: 'Other' }, { attachments: [] }, { target: { ...target, label: 'Other' } }]) {
    expect(() => writePreviewCommentOnce(db, { ...input, ...patch }, read, create)).toThrow('COMMENT_OPERATION_CONFLICT');
  }
  const second = writePreviewCommentOnce(db, { ...input, author: 'other' }, read, create);
  expect(second.id).not.toBe(first.id);
});
it('ignores anchor bookkeeping but rejects an edit after status changes', () => {
  const { db, input, read, create } = fixture();
  const root = writePreviewCommentOnce(db, input, read, create);
  updatePreviewCommentAnchor(db, 'project', 'conversation', root.id, { anchorState: 'reanchored', anchoredVersion: 8, lastGoodPosition: { x: 20, y: 30, width: 100, height: 20 } });
  expect(read(root.id)!.editToken).toBe(root.editToken);
  updatePreviewCommentStatus(db, 'project', 'conversation', root.id, 'resolved');
  expect(read(root.id)!.editToken).not.toBe(root.editToken);
  expect(() => writePreviewCommentOnce(db, { ...input, id: root.id, operationId: 'edit', expectedEditToken: root.editToken! }, read, create)).toThrow('COMMENT_EDIT_CONFLICT');
});
it('adds the receipt table to the preceding schema without changing roots or edit tokens', () => {
  const { db, input, read, create } = fixture();
  const root = writePreviewCommentOnce(db, input, read, create);
  db.exec('DROP TABLE preview_comment_writes');
  migratePreviewCommentWrites(db); migratePreviewCommentWrites(db);
  expect(read(root.id)).toEqual(root);
  expect(previewCommentEditToken({ ...root, updatedAt: root.updatedAt + 100, authorDisplayName: 'Renamed' })).toBe(root.editToken);
});
for (const external of [false, true]) it(`rechecks author authority inside the transaction after ${external ? 'external author' : 'member author'} changes`, () => {
  const { db, input, read, create } = fixture();
  const root = writePreviewCommentOnce(db, input, read, create);
  db.prepare('UPDATE preview_comments SET author_member_id=?, author_kind=? WHERE id=?').run(external ? 'person' : 'other', external ? 'user' : 'member', root.id);
  const current = read(root.id)!;
  expect(current.editToken).not.toBe(root.editToken);
  expect(() => writePreviewCommentOnce(db, { ...input, id: root.id, operationId: 'edit', expectedEditToken: current.editToken! }, read, () => { throw Error('mutation must not run'); })).toThrow('COMMENT_FORBIDDEN');
  expect(read(root.id)).toEqual(current);
  expect(db.prepare('SELECT COUNT(*) AS count FROM preview_comment_writes').get()).toEqual({ count: 1 });
});
