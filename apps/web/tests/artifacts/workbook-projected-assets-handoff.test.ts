import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { expect, it } from 'vitest';
import { workbookEditPlanSchema } from '@open-design/contracts/runtime/workbook';
import fixture from '../fixtures/workbook-projected-assets-handoff.json';

// Public reader models from the actual independent native ZIP fixture and
// source writer, with a stand-in receipt. No server/asset grant is implied.
const checkout = resolve(process.cwd(), '../..');
const helper = resolve(process.cwd(), 'tests/helpers/workbook-restored-projection-handoff.cts');
async function run(input: unknown, success = true) {
  const directory = await mkdtemp(join(tmpdir(), 'od-projected-handoff-test-'));
  try {
    const source = join(directory, 'input.json'), output = join(directory, 'output.json');
    await writeFile(source, JSON.stringify(input));
    const result = spawnSync(process.execPath, ['--import', 'tsx', helper, source, output], { cwd: checkout, timeout: 15_000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    if (!success) {
      expect(result.status).toBe(1);
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
      return result.stderr;
    }
    expect(result.status, result.stderr).toBe(0);
    return workbookEditPlanSchema.parse(JSON.parse(await readFile(output, 'utf8')));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
it('exports only the exact declared native deletion and checked restored projection through the real entrypoint', async () => {
  const deleted = await run({ phase: 'delete', historical: fixture.historical, scope: fixture.scope });
  expect(deleted).toEqual(fixture.deletionPlan);
  const restored = await run(fixture);
  if (typeof restored === 'string') throw Error('The positive handoff must return a strict plan.');
  expect(restored.sheets?.map(sheet => [sheet.sheetId, sheet.origin, sheet.name])).toEqual([
    ['1', 'restore', 'Rich cells'], ['2', 'source', 'Current survivor'],
  ]);
  expect(restored.edits).toEqual([
    { sheetId: '1', cell: { row: 1, column: 1, style: 1, kind: 'number', value: 19 } },
    { sheetId: '1', cell: { row: 3, column: 3, formula: "='Current survivor'!A1+1", kind: 'blank', value: null } },
  ]);
  const selected = restored.sheets?.[0];
  expect(selected).toMatchObject({ template: { versionId: fixture.receipt.sourceVersionId, versionSha256: fixture.historical.sourceSha256 }, baselineIdentity: { version: 1 } });
}, 15_000);
it.each([
  ['changed declared plan', (input: typeof fixture) => { input.deletionPlan.edits[0]!.cell.value = 21; }, /exactly match/],
  ['changed current source inputs', (input: typeof fixture) => { input.current.model.sheets[0]!.cells[0]!.value = 999; }, /Saved source inputs/],
  ['wrong receipt source', (input: typeof fixture) => { input.receipt.sourceSha256 = '0'.repeat(64); }, /save identity/],
  ['wrong refreshed target', (input: typeof fixture) => { input.current.sourceSha256 = '0'.repeat(64); }, /refreshed target/],
  ['wrong project receipt', (input: typeof fixture) => { input.receipt.projectId = crypto.randomUUID(); }, /save identity/],
])('refuses %s without publishing any output plan', async (_label, mutate, reason) => {
  const input = structuredClone(fixture); mutate(input);
  expect(await run(input, false)).toMatch(reason);
}, 15_000);
it('refuses a legacy receipt rather than inventing a retained historical version', async () => {
  const input = { ...structuredClone(fixture), receipt: { ...fixture.receipt, sourceVersionId: null } };
  expect(await run(input, false)).toMatch(/source-history/);
}, 15_000);
