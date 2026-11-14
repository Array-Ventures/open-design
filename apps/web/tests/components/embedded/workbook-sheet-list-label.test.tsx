// @vitest-environment jsdom
import { createRequire, Module } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import ts from 'typescript';

const require = createRequire(realpathSync(resolve(process.cwd(), 'node_modules/@univerjs/preset-sheets-core/package.json')));
const core = require('@univerjs/core');
const sheets = require('@univerjs/sheets');
const ui = require('@univerjs/ui');
const packagePath = require.resolve('@univerjs/sheets-ui');
function entryMenu(entry: 'cjs' | 'es' | 'compat') {
  const filename = resolve(dirname(packagePath), entry === 'compat' ? '../index.js' : `../${entry}/index.js`);
  // Expose the real private producer only to this isolated DOM fixture. ESM
  // entries are transformed to CJS syntax; no dependency/implementation is mocked.
  const source = readFileSync(filename, 'utf8');
  const cjs = entry === 'cjs' ? source : ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(filename);
  Object.assign(loaded, { filename, paths: (Module as unknown as { _nodeModulePaths(path: string): string[] })._nodeModulePaths(dirname(filename)) });
  (loaded as unknown as { _compile(source: string, filename: string): void })._compile(cjs + '\nexports.TestSheetBarMenu = SheetBarMenu;', filename);
  return loaded.exports;
}
const closes: (() => void)[] = [];
afterEach(() => { cleanup(); for (const close of closes.splice(0)) close(); });

for (const entry of ['cjs', 'es', 'compat'] as const) for (const [locale, label] of [['en-US', 'Sheet tabs'], ['fr-FR', 'Onglets de feuilles']] as const) it(`names the actual ${entry} SDK sheet-list button in ${locale} and switches the same two sheets without editing their data`, async () => {
  const sdk = entryMenu(entry);
  const language = locale === 'en-US' ? core.LocaleType.EN_US : core.LocaleType.FR_FR;
  const messages = require(`@univerjs/sheets-ui/locale/${locale}`);
  const univer = new core.Univer({ locale: language, locales: { [language]: messages } });
  closes.push(() => univer.dispose());
  univer.registerPlugin(sheets.UniverSheetsPlugin);
  const book = univer.createUnit(core.UniverInstanceType.UNIVER_SHEET, { id: 'label-book', name: 'Label fixture', sheetOrder: ['first', 'second'], styles: {}, sheets: {
    first: { id: 'first', name: 'Rich cells', rowCount: 20, columnCount: 10, cellData: { 0: { 0: { v: 'Keep first' } } } },
    second: { id: 'second', name: 'Retained sheet', rowCount: 20, columnCount: 10, cellData: { 0: { 0: { v: 'Keep second' } } } },
  } });
  const injector = univer.__getInjector();
  injector.get(core.IUniverInstanceService).focusUnit(book.getUnitId());
  injector.add([sdk.ISheetBarService, { useClass: sdk.SheetBarService }]);
  const before = JSON.stringify(book.getSnapshot().sheets);
  const Menu = ui.connectInjector(sdk.TestSheetBarMenu, injector) as ComponentType;
  render(<Menu />);
  const button = screen.getByRole('button', { name: label });
  expect(button).toHaveAccessibleName(label);
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.click(await screen.findByText('Retained sheet', { exact: true }));
  await act(async () => { await Promise.resolve(); });
  await waitFor(() => expect(book.getActiveSheet().getSheetId()).toBe('second'));
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.click(await screen.findByText('Rich cells', { exact: true }));
  await act(async () => { await Promise.resolve(); });
  await waitFor(() => expect(book.getActiveSheet().getSheetId()).toBe('first'));
  expect(JSON.stringify(book.getSnapshot().sheets)).toBe(before);
});
