import { openDatabase } from '../../src/db.js';
import { createPreviewCommentReply } from '../../src/storage/preview-comment-replies.js';

const db = openDatabase(process.argv[2]!);
const phase = process.argv[3];
function stopAtCrashPoint() {
  process.stdout.write('REPLY_CRASH_READY\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
db.transaction(() => {
  createPreviewCommentReply(db, { commentId: 'root', authorMemberId: 'person', operationId: 'create-once', note: 'Durable reply' });
  if (phase === 'before') stopAtCrashPoint();
})();
stopAtCrashPoint();
