// @vitest-environment jsdom
import { createRequire, Module } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import ts from 'typescript';
const require = createRequire(realpathSync(resolve(process.cwd(), 'node_modules/@univerjs/preset-sheets-core/package.json')));
const core = require('@univerjs/core'), sheets = require('@univerjs/sheets'), ui = require('@univerjs/ui'), sheetUI = require('@univerjs/sheets-ui');
// Compile the unchanged consumer to the same CJS dependency boundary as the
// actual SDK fixture; mixing ESM/CJS core tokens creates a different injector.
const filename = resolve(dirname(require.resolve('@univerjs/sheets-ui')), 'test-grid-navigation.cjs');
const loaded = new Module(filename);
Object.assign(loaded, { filename, paths: (Module as unknown as { _nodeModulePaths(path: string): string[] })._nodeModulePaths(dirname(filename)) });
(loaded as unknown as { _compile(source: string, filename: string): void })._compile(ts.transpileModule(readFileSync(resolve(process.cwd(), 'src/components/embedded/workbook/grid-navigation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { attachWorkbookNavigation } = loaded.exports as typeof import('../../../src/components/embedded/workbook/grid-navigation');
const closes: (() => void)[] = [];
afterEach(() => { for (const close of closes.splice(0).reverse()) close(); document.body.replaceChildren(); });
function fixture(sheetMenu = true) {
  const univer = new core.Univer(); closes.push(() => univer.dispose()); univer.registerPlugin(sheets.UniverSheetsPlugin);
  const book = univer.createUnit(core.UniverInstanceType.UNIVER_SHEET, { id: 'navigation-book', name: 'Navigation', sheetOrder: ['one'], styles: {}, sheets: { one: { id: 'one', name: 'One', rowCount: 10, columnCount: 10, cellData: { 0: { 0: { v: 42 } } } } } });
  const injector = univer.__getInjector(), context = injector.get(core.IContextService), commands = injector.get(core.ICommandService);
  injector.get(core.IUniverInstanceService).focusUnit(book.getUnitId());
  injector.add([sheetUI.ISheetBarService, { useClass: sheetUI.SheetBarService }]);
  const show = vi.fn(); injector.get(sheetUI.ISheetBarService).registerSheetBarMenuHandler({ handleSheetBarMenu: show });
  commands.registerCommand(sheetUI.ShowMenuListCommand);
  const root = document.createElement('div'), canvas = document.createElement('canvas'); root.append(canvas); document.body.append(root);
  // Real shortcut service/window listener; public layout containment and absent
  // child-runtime lookup stand in for the full rendered grid in this DOM fixture.
  const shortcuts = new ui.ShortcutService(commands, { isMac: false, isWindows: false, isLinux: true }, context, { get: () => undefined }, { checkElementInCurrentContainers: (target: Node) => root.contains(target) });
  closes.push(() => shortcuts.dispose()); injector.add([ui.IShortcutService, { useValue: shortcuts }]);
  const state = { ready: true };
  context.setContextValue(core.FOCUSING_SHEET, true); context.setContextValue(core.FOCUSING_UNIVER_EDITOR, true);
  const before = JSON.stringify(book.getSnapshot());
  const navigation = attachWorkbookNavigation(univer, { getActiveWorkbook: () => { throw Error('Sheet navigation must not acquire edit APIs'); } } as never, () => state.ready, { ...ui, ...sheetUI }, sheetMenu);
  closes.push(() => navigation.dispose());
  const press = (target: HTMLElement = canvas) => { const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'K', keyCode: 75, altKey: true, shiftKey: true }); target.dispatchEvent(event); return event; };
  return { navigation, shortcuts, state, context, press, show, book, before };
}
it('opens the real public sheet-menu operation from the scoped chord without editing data', async () => {
  const f = fixture(); expect(f.press().defaultPrevented).toBe(true); await Promise.resolve();
  expect(f.show).toHaveBeenCalledTimes(1); expect(JSON.stringify(f.book.getSnapshot())).toBe(f.before);
});
it('does not consume editing, stale, paused or outside-owner keyboard events', async () => {
  const f = fixture();
  f.context.setContextValue(core.EDITOR_ACTIVATED, true); expect(f.press().defaultPrevented).toBe(false);
  f.context.setContextValue(core.EDITOR_ACTIVATED, false); f.state.ready = false; expect(f.press().defaultPrevented).toBe(false);
  f.state.ready = true; f.context.setContextValue(core.FOCUSING_SHEET, false); expect(f.press().defaultPrevented).toBe(false);
  f.context.setContextValue(core.FOCUSING_SHEET, true); const outside = document.createElement('textarea'); document.body.append(outside); expect(f.press(outside).defaultPrevented).toBe(false);
  await Promise.resolve(); expect(f.show).not.toHaveBeenCalled(); expect(JSON.stringify(f.book.getSnapshot())).toBe(f.before);
});
it('withdraws the binding and display when the grid navigation owner disposes', async () => {
  const f = fixture(); expect(f.shortcuts.getShortcutDisplayOfCommand(sheetUI.ShowMenuListCommand.id)).toBeTruthy();
  f.navigation.dispose(); expect(f.press().defaultPrevented).toBe(false);
  expect(f.shortcuts.getShortcutDisplayOfCommand(sheetUI.ShowMenuListCommand.id)).toBeNull();
  await Promise.resolve(); expect(f.show).not.toHaveBeenCalled();
});

it('does not install a sheet-menu chord for a CSV view without a sheet bar', async () => {
  const f = fixture(false); expect(f.shortcuts.getShortcutDisplayOfCommand(sheetUI.ShowMenuListCommand.id)).toBeNull();
  expect(f.press().defaultPrevented).toBe(false); await Promise.resolve(); expect(f.show).not.toHaveBeenCalled();
});
