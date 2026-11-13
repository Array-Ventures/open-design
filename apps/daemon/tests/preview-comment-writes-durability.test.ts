import { afterEach, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, getPreviewComment, insertConversation, insertProject, listPreviewComments, openDatabase, upsertPreviewComment } from '../src/db.js';
import { writePreviewCommentOnce } from '../src/storage/preview-comment-writes.js';
let directory: string | undefined;
let child: ChildProcess | undefined;
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
  closeDatabase(); if (directory) rmSync(directory, { recursive: true, force: true }); child = undefined; directory = undefined;
});
for (const phase of ['before', 'after']) it(`keeps roots and receipts atomic across SIGKILL ${phase} commit`, async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'od-root-write-crash-'));
  const initial = openDatabase(directory);
  insertProject(initial, { id: 'project', name: 'Fixture', createdAt: 1, updatedAt: 1 });
  insertConversation(initial, { id: 'conversation', projectId: 'project', title: 'Fixture', createdAt: 1, updatedAt: 1 });
  closeDatabase();
  child = spawn(process.execPath, ['--import', 'tsx', path.resolve('tests/fixtures/preview-root-write-crash.ts'), directory, phase], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    child!.once('error', reject); child!.once('exit', code => reject(Error(`root writer exited before crash point: ${code}`)));
    child!.stdout!.on('data', data => { output += String(data); if (output.includes('ROOT_WRITE_CRASH_READY')) resolve(); });
  });
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const db = openDatabase(directory);
  expect(listPreviewComments(db, 'project', 'conversation')).toHaveLength(phase === 'after' ? 1 : 0);
  expect(db.prepare('SELECT COUNT(*) AS count FROM preview_comment_writes').get()).toEqual({ count: phase === 'after' ? 1 : 0 });
  const target = { filePath: 'index.html', elementId: 'heading', selector: 'h1', label: 'Heading', text: '', position: { x: 1, y: 2, width: 100, height: 20 }, htmlHint: '' };
  const saved = writePreviewCommentOnce(db, { projectId: 'project', conversationId: 'conversation', author: 'person', operationId: 'root-once', target, note: 'Durable root' },
    id => getPreviewComment(db, 'project', 'conversation', id), () => upsertPreviewComment(db, 'project', 'conversation', { target, note: 'Durable root', authorMemberId: 'person' }, { preserveStatus: true })!);
  expect(listPreviewComments(db, 'project', 'conversation')).toEqual([saved]);
  expect(db.prepare('SELECT COUNT(*) AS count FROM preview_comment_writes').get()).toEqual({ count: 1 });
}, 15000);
