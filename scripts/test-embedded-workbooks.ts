import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ExcelJS from 'exceljs-community';
import JSZip from 'jszip';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { workbookPreviewSchema } from '../packages/contracts/src/runtime/workbook.js';

const exec = promisify(execFile), image = process.argv[2];
assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/, 'Pass an immutable, locally built renderer image identity');
const owner = randomUUID(), actor = userInfo();
const scratch = await mkdtemp(path.join(tmpdir(), 'od-workbook-container-'));
const source = path.join(scratch, 'source'); await mkdir(source);
const original = new ExcelJS.Workbook(), inputs = original.addWorksheet('Inputs'), summary = original.addWorksheet('Summary');
inputs.addTable({ name: 'Sales', ref: 'C4', headerRow: true, totalsRow: true, columns: [{ name: 'Amount', totalsRowFunction: 'sum' }, { name: 'Label', totalsRowLabel: 'Total' }], rows: [[12.5, 'First'], [30, 'Second']] });
inputs.getCell('C5').numFmt = '$0.00'; inputs.getCell('C7').value = { formula: 'SUM(Sales[Amount])' };
summary.getCell('A1').value = { formula: 'SUM(Sales[Amount])', result: 999 };
summary.getCell('A2').value = { formula: 'A1*2', result: 999 };
const zip = await JSZip.loadAsync(await original.xlsx.writeBuffer());
zip.file('custom/opaque.bin', Buffer.from([0, 255, 1, 2]));
const bytes = await zip.generateAsync({ type: 'nodebuffer' }), sourceSha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(path.join(source, 'book.xlsx'), bytes);
await writeFile(path.join(source, 'edits.json'), JSON.stringify({ sourceSha256, edits: [{ sheetId: '1', cell: { row: 5, column: 2, kind: 'number', value: 38 } }] }));
await writeFile(path.join(source, 'stale.json'), JSON.stringify({ sourceSha256: '0'.repeat(64), edits: [] }));
const hostile = await JSZip.loadAsync(bytes), sheet = await hostile.file('xl/worksheets/sheet1.xml')!.async('string');
hostile.file('xl/worksheets/sheet1.xml', sheet.replace('</sheetData>', '</sheetData><mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells>'));
await writeFile(path.join(source, 'hostile.xlsx'), await hostile.generateAsync({ type: 'nodebuffer' }));
// Qualify new blank-leading ownership and imported fixed-array followers in
// the actual isolated worker, independently reopening its output archives.
const arrayBook = new ExcelJS.Workbook(), arraySheet = arrayBook.addWorksheet('Inputs');
arraySheet.getCell('A2').value = 2; arraySheet.getCell('A3').value = 3;
arrayBook.addWorksheet('Untouched').getCell('A1').value = 'Keep this sheet';
const arrayZip = await JSZip.loadAsync(await arrayBook.xlsx.writeBuffer());
arrayZip.file('custom/array-opaque.bin', Buffer.from([7, 0, 255, 9]));
const arrayBytes = await arrayZip.generateAsync({ type: 'nodebuffer' });
await writeFile(path.join(source, 'array.xlsx'), arrayBytes);
await writeFile(path.join(source, 'array-edits.json'), JSON.stringify({ sourceSha256: createHash('sha256').update(arrayBytes).digest('hex'), edits: [{ sheetId: '1', cell: { row: 0, column: 4, kind: 'blank', value: null, formula: '=A1:A3' } }] }));
arraySheet.getCell('A1').value = 10;
arraySheet.getCell('D3').value = { formula: 'SEQUENCE(3,1,A1)', result: 10 };
arraySheet.getCell('D4').value = 11; arraySheet.getCell('D5').value = 12;
arrayBook.getWorksheet('Untouched')!.getCell('B1').value = { formula: 'Inputs!D4+100', result: 111 };
const fixedZip = await JSZip.loadAsync(await arrayBook.xlsx.writeBuffer());
fixedZip.file('xl/worksheets/sheet1.xml', (await fixedZip.file('xl/worksheets/sheet1.xml')!.async('string')).replace('<f>', '<f t="array" ref="D3:D5">'));
const fixedBytes = await fixedZip.generateAsync({ type: 'nodebuffer' });
await writeFile(path.join(source, 'fixed-array.xlsx'), fixedBytes);
await writeFile(path.join(source, 'fixed-array-edits.json'), JSON.stringify({ sourceSha256: createHash('sha256').update(fixedBytes).digest('hex'), edits: [{ sheetId: '1', cell: { row: 0, column: 0, kind: 'number', value: 20 } }] }));
const containers = new Set<string>();
async function removeOwned(name: string) {
  const inspected = await exec('docker', ['inspect', '--format', '{{json .Config.Labels}}', name], { timeout: 10_000 }).catch(error => {
    // Listing distinguishes confirmed absence from a failed daemon/inspect call.
    return exec('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], { timeout: 10_000 }).then(result => { if (result.stdout.trim()) throw error; return null; });
  });
  if (inspected) {
    assert.equal(JSON.parse(inspected.stdout)['evebot.workbook-test'], owner, 'Refuse cleanup of an unrelated container');
    await exec('docker', ['rm', '-f', name], { timeout: 15_000 });
  }
  containers.delete(name);
}
async function run(label: string, input: object, success = true) {
  const directory = path.join(scratch, label), job = path.join(directory, 'job'), output = path.join(directory, 'output');
  await mkdir(job, { recursive: true }); await mkdir(output);
  await writeFile(path.join(job, 'input.json'), JSON.stringify(input));
  const name = `od-workbook-test-${randomUUID()}`; containers.add(name);
  try {
    let failure: unknown;
    try {
      await exec('docker', ['run', '--pull', 'never', '--name', name, '--label', `evebot.workbook-test=${owner}`, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '1g', '--cpus', '1', '--shm-size', '128m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m', '--user', `${actor.uid}:${actor.gid}`, '--mount', `type=bind,src=${source},dst=/source,readonly`, '--mount', `type=bind,src=${job},dst=/job,readonly`, '--mount', `type=bind,src=${output},dst=/output`, image!], { timeout: 60_000, maxBuffer: 128 * 1024 });
    } catch (error) { failure = error; }
    if (success && failure) throw failure;
    const result = JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8')) as { ok: boolean; file?: string; mime?: string; error?: string };
    assert.equal(result.ok, success, `${label}: ${result.error ?? 'Unexpected status'}`);
    const inspected = JSON.parse((await exec('docker', ['inspect', '--format', '{{json .HostConfig}}', name])).stdout) as { NetworkMode: string; ReadonlyRootfs: boolean; Memory: number };
    assert.equal(inspected.NetworkMode, 'none'); assert.equal(inspected.ReadonlyRootfs, true); assert.equal(inspected.Memory, 1024 ** 3);
    process.stdout.write(`${label}: ${success ? 'completed' : 'refused'}\n`);
    return { result, body: result.file ? await readFile(path.join(output, result.file)) : Buffer.alloc(0) };
  } finally { await removeOwned(name); }
}
try {
  const preview = await run('typed-preview', { fileName: 'book.xlsx', format: 'workbook' });
  const parsed = workbookPreviewSchema.parse(JSON.parse(preview.body.toString('utf8')));
  assert.equal(parsed.sourceSha256, sourceSha256); assert.equal(parsed.model.tables?.[0]?.name, 'Sales');
  const edited = await run('calculated-xlsx', { fileName: 'book.xlsx', format: 'xlsx', dataFile: 'edits.json' });
  const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(Uint8Array.from(edited.body).buffer);
  assert.equal(reopened.getWorksheet('Inputs')!.getCell('C6').value, 38);
  assert.equal(reopened.getWorksheet('Inputs')!.getCell('C5').numFmt, '$0.00');
  assert.equal(reopened.getWorksheet('Summary')!.getCell('A1').result, 50.5);
  assert.equal(reopened.getWorksheet('Summary')!.getCell('A2').result, 101);
  assert.deepEqual(await (await JSZip.loadAsync(edited.body)).file('custom/opaque.bin')!.async('nodebuffer'), Buffer.from([0, 255, 1, 2]));
  const copy = await run('recalculated-original', { fileName: 'book.xlsx', format: 'xlsx' });
  const originalCopy = new ExcelJS.Workbook(); await originalCopy.xlsx.load(Uint8Array.from(copy.body).buffer);
  assert.equal(originalCopy.getWorksheet('Summary')!.getCell('A1').result, 42.5);
  const stale = await run('stale-edit-refused', { fileName: 'book.xlsx', format: 'xlsx', dataFile: 'stale.json' }, false);
  assert.match(stale.result.error ?? '', /changed after/);
  const refused = await run('expansion-refused', { fileName: 'hostile.xlsx', format: 'workbook' }, false);
  assert.match(refused.result.error ?? '', /merge.*limit/i);
  const array = await run('blank-leading-array', { fileName: 'array.xlsx', format: 'xlsx', dataFile: 'array-edits.json' });
  const arrayOutput = await JSZip.loadAsync(array.body);
  const arrayXml = await arrayOutput.file('xl/worksheets/sheet1.xml')!.async('string');
  assert.match(arrayXml, /<c\b[^>]*\br="E1"[^>]*\bcm="1"[^>]*>\s*<f\b[^>]*\bt="array"[^>]*\bref="E1:E3"[^>]*>A1:A3<\/f>\s*<\/c>/);
  assert.ok(arrayOutput.file('xl/metadata.xml'), 'New array ownership needs real workbook metadata');
  const arrayReopened = new ExcelJS.Workbook(); await arrayReopened.xlsx.load(Uint8Array.from(array.body).buffer);
  assert.equal(arrayReopened.getWorksheet('Inputs')!.getCell('E1').formula, 'A1:A3');
  assert.equal(arrayReopened.getWorksheet('Inputs')!.getCell('E2').value, 2);
  assert.equal(arrayReopened.getWorksheet('Inputs')!.getCell('E3').value, 3);
  for (const part of ['custom/array-opaque.bin', 'xl/worksheets/sheet2.xml', 'xl/styles.xml']) assert.deepEqual(await arrayOutput.file(part)!.async('nodebuffer'), await arrayZip.file(part)!.async('nodebuffer'), `${part} must remain byte-identical`);
  const fixed = await run('fixed-array-followers', { fileName: 'fixed-array.xlsx', format: 'xlsx', dataFile: 'fixed-array-edits.json' });
  const fixedReopened = new ExcelJS.Workbook(); await fixedReopened.xlsx.load(Uint8Array.from(fixed.body).buffer);
  assert.equal(fixedReopened.getWorksheet('Inputs')!.getCell('D3').result, 20);
  assert.equal(fixedReopened.getWorksheet('Inputs')!.getCell('D4').value, 21);
  assert.equal(fixedReopened.getWorksheet('Inputs')!.getCell('D5').value, 22);
  assert.equal(fixedReopened.getWorksheet('Untouched')!.getCell('B1').result, 121);
  assert.deepEqual(await readFile(path.join(source, 'book.xlsx')), bytes);
  assert.deepEqual(await readFile(path.join(source, 'array.xlsx')), arrayBytes);
  assert.deepEqual(await readFile(path.join(source, 'fixed-array.xlsx')), fixedBytes);
  assert.equal((await exec('docker', ['ps', '-aq', '--filter', `label=evebot.workbook-test=${owner}`])).stdout.trim(), '');
  process.stdout.write('PASS: seven owned workbook workers, source preserved, all containers removed\n');
} finally {
  for (const name of containers) await removeOwned(name);
  await rm(scratch, { recursive: true, force: true });
}
