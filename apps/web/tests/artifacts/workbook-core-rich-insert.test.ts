import { createRequire, Module } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
const require = createRequire(realpathSync(resolve(process.cwd(), 'node_modules/@univerjs/preset-sheets-core/package.json')));
function entry(kind: 'cjs' | 'es' | 'compat') {
  const filename = resolve(dirname(require.resolve('@univerjs/core')), kind === 'compat' ? '../index.js' : `../${kind}/index.js`);
  const source = readFileSync(filename, 'utf8');
  const loaded = new Module(filename);
  Object.assign(loaded, { filename, paths: (Module as unknown as { _nodeModulePaths(path: string): string[] })._nodeModulePaths(dirname(filename)) });
  (loaded as unknown as { _compile(source: string, filename: string): void })._compile(kind === 'cjs' ? source : ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return loaded.exports as typeof import('@univerjs/core');
}
for (const kind of ['cjs', 'es', 'compat'] as const) it(`preserves inserted rich metadata without requiring a preexisting run array in ${kind}`, () => {
  const { TextX } = entry(kind);
  const insert = { dataStream: 'XY', textRuns: [{ st: 0, ed: 1, ts: { bl: 1 as const } }, { st: 1, ed: 2, ts: { it: 1 as const } }] };
  for (const body of [{ dataStream: 'ab\r\n' }, { dataStream: 'ab\r\n', textRuns: [] }]) {
    const before = structuredClone(body);
    const incoming = structuredClone(insert);
    const actions = new TextX().retain(1).insert(2, insert).serialize();
    const result = TextX.apply(structuredClone(body), actions);
    expect(result.dataStream).toBe('aXYb\r\n');
    expect(result.textRuns).toEqual([{ st: 1, ed: 2, ts: { bl: 1 } }, { st: 2, ed: 3, ts: { it: 1 } }]);
    expect(body).toEqual(before);
    expect(insert).toEqual(incoming);
  }
  const styled = TextX.apply({
    dataStream: 'ab\r\n',
    textRuns: [{ st: 0, ed: 2, ts: { ul: { s: 1 } } }],
  }, new TextX().retain(1).insert(2, insert).serialize());
  expect(styled.textRuns).toEqual([
    { st: 0, ed: 1, ts: { ul: { s: 1 } } },
    { st: 1, ed: 2, ts: { bl: 1 } },
    { st: 2, ed: 3, ts: { it: 1 } },
    { st: 3, ed: 4, ts: { ul: { s: 1 } } },
  ]);
  const plain = TextX.apply({ dataStream: 'ab\r\n' }, new TextX().retain(1).insert(1, { dataStream: 'X' }).serialize());
  expect(plain).toEqual({ dataStream: 'aXb\r\n', customRanges: [], customDecorations: [] });
  expect(Object.hasOwn(plain, 'textRuns')).toBe(false);
});
