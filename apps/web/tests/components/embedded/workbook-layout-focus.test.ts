// @vitest-environment jsdom
import { createRequire, Module } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';

const require = createRequire(realpathSync(resolve(process.cwd(), 'node_modules/@univerjs/preset-sheets-core/package.json')));
const core = require('@univerjs/core'), sheets = require('@univerjs/sheets');
const uiPath = require.resolve('@univerjs/ui');
type LayoutExports = Pick<typeof import('@univerjs/preset-sheets-core'), 'DesktopLayoutService' | 'DISABLE_AUTO_FOCUS_KEY'>;
const entries = new Map<string, LayoutExports>();
function entryService(entry: 'cjs' | 'es' | 'compat') {
  const cached = entries.get(entry); if (cached) return cached;
  const filename = resolve(dirname(uiPath), entry === 'compat' ? '../index.js' : `../${entry}/index.js`);
  const source = readFileSync(filename, 'utf8');
  const cjs = entry === 'cjs' ? source : ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(filename);
  Object.assign(loaded, { filename, paths: (Module as unknown as { _nodeModulePaths(path: string): string[] })._nodeModulePaths(dirname(filename)) });
  (loaded as unknown as { _compile(source: string, filename: string): void })._compile(cjs, filename);
  entries.set(entry, loaded.exports);
  return loaded.exports as LayoutExports;
}
const closes: (() => void)[] = [];
afterEach(() => { for (const close of closes.splice(0).reverse()) close(); document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture(entry: 'cjs' | 'es' | 'compat') {
  const ui = entryService(entry), univer = new core.Univer();
  closes.push(() => univer.dispose()); univer.registerPlugin(sheets.UniverSheetsPlugin);
  const book = univer.createUnit(core.UniverInstanceType.UNIVER_SHEET, { id: 'focus-owner', name: 'Focus fixture', sheetOrder: ['1'], styles: {}, sheets: { '1': { id: '1', name: 'One', rowCount: 20, columnCount: 10, cellData: { 0: { 0: { v: 12 } } } } } });
  const injector = univer.__getInjector(), instances = injector.get(core.IUniverInstanceService), context = injector.get(core.IContextService);
  instances.focusUnit(book.getUnitId());
  const layout = new ui.DesktopLayoutService(context, instances); closes.push(() => layout.dispose());
  const root = document.createElement('div'); document.body.append(root); layout.registerRootContainerElement(root);
  const editor = document.createElement('div'); editor.contentEditable = 'true'; editor.tabIndex = -1; editor.dataset.uComp = 'editor'; root.append(editor);
  // Public focus registration delegates to an actual DOM editor. This exercises
  // the real SDK window listener, not the complete canvas/render-engine stack.
  const delegate = vi.fn(() => editor.focus()); layout.registerFocusHandler(core.UniverInstanceType.UNIVER_SHEET, delegate);
  function control(tag: 'button' | 'canvas' | 'input', comp: string, keyboard: boolean) {
    const target = document.createElement(tag); target.tabIndex = 0; target.dataset.uComp = comp; root.append(target);
    const matches = target.matches.bind(target);
    // jsdom does not model trusted input modality. Only this one browser
    // predicate is modeled; native focus events and the SDK service stay real.
    vi.spyOn(target, 'matches').mockImplementation(selector => selector === ':focus-visible' ? keyboard : matches(selector));
    return target;
  }
  return { root, editor, delegate, context, control, ui };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
for (const entry of ['cjs', 'es', 'compat'] as const) {
  for (const activated of [false, true]) it(`${entry}: preserves keyboard control ownership ${activated ? 'after' : 'before'} canvas activation`, async () => {
    const f = fixture(entry); f.context.setContextValue(f.ui.DISABLE_AUTO_FOCUS_KEY, !activated);
    if (activated) { f.control('canvas', 'render-canvas', true).focus(); await settle(); expect(document.activeElement).toBe(f.editor); f.delegate.mockClear(); }
    const button = f.control('button', 'sheet-bar-append-button', true); button.focus(); await settle();
    expect(document.activeElement).toBe(button); expect(f.delegate).not.toHaveBeenCalled();
  });
  it(`${entry}: preserves a generic keyboard toolbar button, not only the sheet-list button`, async () => {
    const f = fixture(entry), button = f.control('button', 'button', true); button.focus(); await settle(); expect(document.activeElement).toBe(button); expect(f.delegate).not.toHaveBeenCalled();
  });
  it(`${entry}: rechecks keyboard ownership when the queued target gains focus visibility`, async () => {
    const f = fixture(entry), button = f.control('button', 'button', false), matches = Element.prototype.matches.bind(button); let keyboard = false;
    vi.spyOn(button, 'matches').mockImplementation(selector => selector === ':focus-visible' ? keyboard : matches(selector));
    button.focus(); keyboard = true; await settle(); expect(document.activeElement).toBe(button); expect(f.delegate).not.toHaveBeenCalled();
  });
  it(`${entry}: retains pointer toolbar and keyboard canvas editor delegation`, async () => {
    const f = fixture(entry); f.control('button', 'button', false).focus(); await settle(); expect(document.activeElement).toBe(f.editor);
    expect(f.delegate).toHaveBeenCalledTimes(1); f.control('canvas', 'render-canvas', true).focus(); await settle(); expect(document.activeElement).toBe(f.editor); expect(f.delegate).toHaveBeenCalledTimes(2);
  });
  it(`${entry}: does not steal a newer outside focus owner from a queued toolbar return`, async () => {
    const f = fixture(entry), button = f.control('button', 'button', false), outside = document.createElement('textarea'); document.body.append(outside);
    button.focus(); outside.focus(); await settle(); expect(document.activeElement).toBe(outside); expect(f.delegate).not.toHaveBeenCalled();
  });
  it(`${entry}: does not return focus for a removed queued target`, async () => {
    const f = fixture(entry), button = f.control('button', 'button', false); button.focus(); button.remove(); await settle(); expect(f.delegate).not.toHaveBeenCalled();
  });
  it(`${entry}: keeps a native input focused without an editor return`, async () => {
    const f = fixture(entry), input = f.control('input', 'editor', true); input.focus(); await settle(); expect(document.activeElement).toBe(input); expect(f.delegate).not.toHaveBeenCalled();
  });
}
