import { getPreviewComment, openDatabase, upsertPreviewComment } from '../../src/db.js';
import { writePreviewCommentOnce } from '../../src/storage/preview-comment-writes.js';
const db = openDatabase(process.argv[2]!);
const target = { filePath: 'index.html', elementId: 'heading', selector: 'h1', label: 'Heading', text: '', position: { x: 1, y: 2, width: 100, height: 20 }, htmlHint: '' };
function crashPoint() { process.stdout.write('ROOT_WRITE_CRASH_READY\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
writePreviewCommentOnce(db, { projectId: 'project', conversationId: 'conversation', author: 'person', operationId: 'root-once', target, note: 'Durable root' },
  id => getPreviewComment(db, 'project', 'conversation', id), () => {
    const root = upsertPreviewComment(db, 'project', 'conversation', { target, note: 'Durable root', authorMemberId: 'person' }, { preserveStatus: true })!;
    if (process.argv[3] === 'before') crashPoint();
    return root;
  });
crashPoint();
