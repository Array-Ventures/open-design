import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { ICommandService, IUndoRedoService, IUniverInstanceService, LocaleType, RedoCommand, UndoCommand, Univer } from '@univerjs/core';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it.each(['undo', 'redo'] as const)('awaits protection for scoped %s, refuses without popping, then retries the original handler once', async direction => {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer);
  const book = api.createWorkbook({ id: 'owned-history', sheetOrder: ['1'], sheets: {
    '1': { id: '1', name: 'Sheet 1', rowCount: 100, columnCount: 26, cellData: { 0: { 0: { v: 12 } } } },
  } });
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  const commands = univer.__getInjector().get(ICommandService);
  const history = univer.__getInjector().get(IUndoRedoService);
  const original = direction === 'undo' ? UndoCommand : RedoCommand;
  const started = gate(), protectedStorage = gate();
  let wrapper: ReturnType<typeof commands.registerCommand> | undefined;
  let execution: Promise<unknown> | undefined;
  let admitted = false, originalCalls = 0;
  try {
    book.getActiveSheet().getRange('A1').setValue(17);
    if (direction === 'redo') await api.undo();
    const before = history.getUndoRedoStatus(book.getId());
    const oldValue = direction === 'undo' ? 17 : 12;
    commands.unregisterCommand(original.id);
    wrapper = commands.registerCommand({
      id: original.id, type: original.type, asyncOnly: true,
      handler: async accessor => {
        started.resolve();
        await protectedStorage.promise;
        if (!admitted) throw Error('Protection refused');
        originalCalls++;
        return original.handler(accessor);
      },
    });
    execution = direction === 'undo' ? api.undo() : api.redo();
    await started.promise;
    expect(book.save().sheets['1']!.cellData![0]![0]!.v).toBe(oldValue);
    expect(history.getUndoRedoStatus(book.getId())).toEqual(before);
    protectedStorage.resolve();
    await expect(execution).rejects.toThrow('Protection refused');
    expect(book.save().sheets['1']!.cellData![0]![0]!.v).toBe(oldValue);
    expect(history.getUndoRedoStatus(book.getId())).toEqual(before);
    expect(originalCalls).toBe(0);
    admitted = true;
    execution = direction === 'undo' ? api.undo() : api.redo();
    await execution;
    expect(originalCalls).toBe(1);
    expect(book.save().sheets['1']!.cellData![0]![0]!.v).toBe(direction === 'undo' ? 12 : 17);
    expect(history.getUndoRedoStatus(book.getId())).toEqual(direction === 'undo'
      ? { undos: before.undos - 1, redos: before.redos + 1 }
      : { undos: before.undos + 1, redos: before.redos - 1 });
  } finally {
    protectedStorage.resolve();
    await execution?.catch(() => {});
    wrapper?.dispose();
    if (!commands.hasCommand(original.id)) commands.registerCommand(original);
    univer.dispose();
  }
});

it('refuses an explicitly async-only history command before invocation and never performs a delayed Undo', async () => {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } });
  univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer);
  const book = api.createWorkbook({ id: 'owned-sync-history', sheetOrder: ['1'], sheets: {
    '1': { id: '1', name: 'Sheet 1', rowCount: 100, columnCount: 26, cellData: { 0: { 0: { v: 12 } } } },
  } });
  univer.__getInjector().get(IUniverInstanceService).focusUnit(book.getId());
  const commands = univer.__getInjector().get(ICommandService);
  const history = univer.__getInjector().get(IUndoRedoService);
  const protection = gate();
  let wrapper: ReturnType<typeof commands.registerCommand> | undefined;
  let delayed: Promise<boolean> | undefined;
  let handlerCalls = 0, originalCalls = 0;
  try {
    book.getActiveSheet().getRange('A1').setValue(17);
    const before = book.save(), status = history.getUndoRedoStatus(book.getId());
    commands.unregisterCommand(UndoCommand.id);
    const command = {
      id: UndoCommand.id, type: UndoCommand.type, asyncOnly: true,
      handler: (accessor: Parameters<typeof UndoCommand.handler>[0]) => {
        handlerCalls++;
        delayed = protection.promise.then(() => {
          originalCalls++;
          return UndoCommand.handler(accessor);
        });
        return delayed;
      },
    };
    wrapper = commands.registerCommand(command);
    expect.soft(() => commands.syncExecuteCommand(UndoCommand.id)).toThrow(/cannot be executed synchronously/);
    expect.soft(handlerCalls).toBe(0);
    protection.resolve();
    await delayed;
    expect.soft(originalCalls).toBe(0);
    expect.soft(book.save()).toEqual(before);
    expect.soft(history.getUndoRedoStatus(book.getId())).toEqual(status);
  } finally {
    protection.resolve();
    await delayed?.catch(() => {});
    wrapper?.dispose();
    if (!commands.hasCommand(UndoCommand.id)) commands.registerCommand(UndoCommand);
    univer.dispose();
  }
});


it.each(['lib/es/index.js', 'lib/cjs/index.js', 'lib/index.js'])('enforces async registration before listeners in the actual pinned %s entry', entry => {
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(require.resolve('@univerjs/core')), '../..');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const entry = process.argv[1];
const core = entry.includes('/cjs/') ? createRequire(import.meta.url)(entry) : await import(pathToFileURL(entry).href);
const univer = new core.Univer();
const commands = univer.__getInjector().get(core.ICommandService);
let calls = 0, before = 0, refused = false;
commands.beforeCommandExecuted(() => { before++; });
commands.registerCommand({ id: 'owned.command.async', type: core.CommandType.COMMAND, asyncOnly: true,
  handler: async () => { calls++; await Promise.resolve(); return true; } });
try { commands.syncExecuteCommand('owned.command.async'); }
catch (error) { refused = /cannot be executed synchronously/.test(error.message); }
await Promise.resolve();
if (!refused || calls !== 0 || before !== 0) throw Error('Synchronous refusal invoked command state');
if (!await commands.executeCommand('owned.command.async') || calls !== 1 || before !== 1) throw Error('Async handler did not run exactly once');
commands.registerCommand({ id: 'owned.command.sync', type: core.CommandType.COMMAND, handler: () => 23 });
if (commands.syncExecuteCommand('owned.command.sync') !== 23 || before !== 2) throw Error('Ordinary synchronous command changed');
univer.dispose();
process.stdout.write(JSON.stringify({ refused, calls, before }));
`, resolve(root, entry)], { encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual({ refused: true, calls: 1, before: 2 });
});
