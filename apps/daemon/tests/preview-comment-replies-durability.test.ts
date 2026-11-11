import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, insertConversation, insertProject, openDatabase } from '../src/db.js';
import { createPreviewCommentReply, listPreviewCommentReplies, migratePreviewCommentReplies } from '../src/storage/preview-comment-replies.js';

let directory: string | undefined;
let child: ChildProcess | undefined;
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
  closeDatabase();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  child = undefined; directory = undefined;
});
function seed() {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'od-reply-crash-'));
  const db = openDatabase(directory);
  insertProject(db, { id: 'project', name: 'Fixture', createdAt: 1, updatedAt: 1 });
  insertConversation(db, { id: 'conversation', projectId: 'project', title: 'Fixture', createdAt: 1, updatedAt: 1 });
  db.prepare(`INSERT INTO preview_comments (id, project_id, conversation_id, file_path, element_id, selector, label, text, position_json, html_hint, note, status, created_at, updated_at)
    VALUES ('root','project','conversation','index.html','heading','h1','Heading','','{}','','Root','open',1,1)`).run();
  return db;
}
for (const phase of ['before', 'after']) it(`survives a real SIGKILL ${phase} reply transaction commit`, async () => {
  seed(); closeDatabase();
  child = spawn(process.execPath, ['--import', 'tsx', path.resolve('tests/fixtures/preview-reply-crash.ts'), directory!, phase], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    child!.once('error', reject);
    child!.once('exit', code => reject(new Error(`reply writer exited before crash point: ${code}`)));
    child!.stdout!.on('data', data => { output += String(data); if (output.includes('REPLY_CRASH_READY')) resolve(); });
  });
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const db = openDatabase(directory!);
  const restored = listPreviewCommentReplies(db, 'root');
  expect(restored).toHaveLength(phase === 'after' ? 1 : 0);
  const saved = createPreviewCommentReply(db, { commentId: 'root', authorMemberId: 'person', operationId: 'create-once', note: 'Durable reply' });
  expect(listPreviewCommentReplies(db, 'root')).toEqual([saved]);
  if (phase === 'after') expect(saved).toEqual(restored[0]);
}, 15000);

it('adds revisions to the preceding schema without changing persisted replies or receipts', () => {
  const db = seed();
  const saved = createPreviewCommentReply(db, { commentId: 'root', authorMemberId: 'person', operationId: 'once', note: 'Keep this' });
  db.exec('ALTER TABLE preview_comment_replies DROP COLUMN revision; ALTER TABLE preview_comment_replies DROP COLUMN attachments_json');
  migratePreviewCommentReplies(db);
  expect(listPreviewCommentReplies(db, 'root')).toEqual([saved]);
  expect(createPreviewCommentReply(db, { commentId: 'root', authorMemberId: 'person', operationId: 'once', note: 'Keep this' })).toEqual(saved);
});
