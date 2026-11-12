import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs, { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs-community';

type History = typeof import('../apps/daemon/src/project-file-versions.js');
interface Configuration { root: string; projectId: string; fileName: string; bytes: string; checkpoint: string }
const moduleUrl = new URL('../apps/daemon/dist/project-file-versions.js', import.meta.url).href;
if (process.argv[2] === '--child') {
  const configuration = JSON.parse(await readFile(process.argv[3]!, 'utf8')) as Configuration;
  // Fault injection stays in this disposable test process. Production contains
  // no pause flag: intercept the actual filesystem commit calls before imports.
  let renamed = false;
  const pause = async () => { process.send?.({ checkpoint: configuration.checkpoint }); await new Promise(() => { setInterval(() => {}, 1000); }); };
  const rename = fs.rename.bind(fs), open = fs.open.bind(fs);
  fs.rename = async (from, to) => {
    const manifest = to.toString().endsWith('/manifest.json');
    if (manifest && configuration.checkpoint === 'before-manifest-rename') await pause();
    await rename(from, to); if (manifest) renamed = true;
  };
  fs.open = async (...args) => {
    const handle = await open(...args);
    if ((await handle.stat()).isDirectory()) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        await sync();
        if (renamed && configuration.checkpoint === 'after-manifest-sync') await pause();
      };
    }
    return handle;
  };
  syncBuiltinESMExports();
  const history = await import(moduleUrl) as History;
  await history.withProjectFileVersionBytesLock(configuration.root, configuration.projectId, configuration.fileName, undefined, lock => lock.ensureCurrentVersion(Buffer.from(configuration.bytes, 'base64'), { source: 'manual' }));
  throw new Error('The configured filesystem checkpoint was not reached');
} else {
  const history = await import(moduleUrl) as History;
  const root = await mkdtemp(path.join(tmpdir(), 'od-workbook-history-crash-')), projectId = 'history-crash';
  const children = new Set<ReturnType<typeof spawn>>();
  async function workbook(value: number) {
    const book = new ExcelJS.Workbook(); book.addWorksheet('Inputs').getCell('A1').value = value;
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  try {
    await mkdir(path.join(root, projectId));
    const original = await workbook(2), next = await workbook(8);
    for (const checkpoint of ['before-manifest-rename', 'after-manifest-sync']) {
      const fileName = `${checkpoint}.xlsx`;
      const first = await history.withProjectFileVersionBytesLock(root, projectId, fileName, undefined, lock => lock.ensureCurrentVersion(original, { source: 'manual' }));
      const configFile = path.join(root, `${checkpoint}.json`);
      await writeFile(configFile, JSON.stringify({ root, projectId, fileName, bytes: next.toString('base64'), checkpoint } satisfies Configuration));
      const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--child', configFile], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      children.add(child); let stderr = ''; child.stderr!.on('data', chunk => { stderr += chunk.toString(); });
      const exit = once(child, 'exit').then(result => { children.delete(child); return result; });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const message = await Promise.race([
          once(child, 'message').then(([message]) => message as { checkpoint: string }),
          exit.then(() => { throw new Error(`History child exited before its mark: ${stderr}`); }),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`History checkpoint timed out: ${stderr}`)), 10_000); }),
        ]);
        assert.equal(message.checkpoint, checkpoint); child.kill('SIGKILL');
        const [, signal] = await exit; children.delete(child); assert.equal(signal, 'SIGKILL');
      } finally { if (timer) clearTimeout(timer); }
      const afterCrash = await history.listProjectFileVersions(root, projectId, fileName);
      assert.equal(afterCrash.length, checkpoint === 'before-manifest-rename' ? 1 : 2);
      assert.deepEqual((await history.readProjectFileVersionBytes(root, projectId, fileName, first!.id)).content, original);
      const settled = await history.withProjectFileVersionBytesLock(root, projectId, fileName, undefined, lock => lock.ensureCurrentVersion(next, { source: 'manual' }));
      assert.equal((await history.listProjectFileVersions(root, projectId, fileName)).length, 2, 'Replay must settle the existing content rather than add an extra revision');
      assert.deepEqual((await history.readProjectFileVersionBytes(root, projectId, fileName, settled!.id)).content, next);
      const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from((await history.readProjectFileVersionBytes(root, projectId, fileName, settled!.id)).content).buffer);
      assert.equal(reopened.getWorksheet('Inputs')!.getCell('A1').value, 8);
      process.stdout.write(`PASS: ${checkpoint} preserves history and settles one new binary revision\n`);
    }
  } finally {
    for (const child of children) child.kill('SIGKILL');
    await Promise.all([...children].map(child => once(child, 'exit')));
    await rm(root, { recursive: true, force: true });
  }
}
