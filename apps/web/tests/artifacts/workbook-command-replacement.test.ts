import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { CommandType, type ICommand } from '@univerjs/core';
import { RemoveSheetMutation } from '@univerjs/sheets';
import { createWorkbookBirthFixture } from '../helpers/workbook-birth-fixture';

it('replaces only the exact registered SDK command and restores it once without changing exported objects', () => {
  const f = createWorkbookBirthFixture();
  const originalHandler = RemoveSheetMutation.handler;
  const replacement: ICommand = { ...RemoveSheetMutation, handler: () => false };
  try {
    const handle = f.commands.replaceCommand(RemoveSheetMutation, replacement);
    expect(handle.isCurrent()).toBe(true);
    expect(RemoveSheetMutation.handler).toBe(originalHandler);
    expect(f.commands.syncExecuteCommand(RemoveSheetMutation.id, { unitId: f.book.getId(), subUnitId: '1' })).toBe(false);
    expect(f.book.save().sheetOrder).toEqual(['1']);
    handle.dispose();
    expect(handle.isCurrent()).toBe(false);
    // Exact original was restored, so another expected-original acquisition works.
    const next = f.commands.replaceCommand(RemoveSheetMutation, replacement);
    handle.dispose();
    expect(next.isCurrent()).toBe(true);
    next.dispose();
  } finally { f.univer.dispose(); }
});

it('refuses unknown previous registration and malformed replacements without invoking or replacing them', () => {
  const f = createWorkbookBirthFixture();
  let calls = 0;
  const unknown: ICommand = { ...RemoveSheetMutation, handler: () => { calls++; return false; } };
  try {
    f.commands.unregisterCommand(RemoveSheetMutation.id);
    const registration = f.commands.registerCommand(unknown);
    expect(() => f.commands.replaceCommand(RemoveSheetMutation, { ...RemoveSheetMutation })).toThrow(/registration/);
    expect(() => f.commands.replaceCommand(unknown, unknown)).toThrow(/replacement/);
    expect(() => f.commands.replaceCommand(unknown, { ...unknown, id: 'other.command' })).toThrow(/replacement/);
    expect(() => f.commands.replaceCommand(unknown, { ...unknown, type: CommandType.COMMAND })).toThrow(/replacement/);
    expect(f.commands.syncExecuteCommand(unknown.id, { unitId: f.book.getId(), subUnitId: '1' })).toBe(false);
    expect(calls).toBe(1);
    const exact = f.commands.replaceCommand(unknown, { ...unknown });
    exact.dispose();
    expect(f.commands.syncExecuteCommand(unknown.id, { unitId: f.book.getId(), subUnitId: '1' })).toBe(false);
    expect(calls).toBe(2);
    registration.dispose();
  } finally { f.univer.dispose(); }
});

it('refuses nested scoped replacement and never overwrites a later unknown registration on disposal', () => {
  const f = createWorkbookBirthFixture();
  const a = RemoveSheetMutation;
  const b: ICommand = { ...a, handler: () => false };
  const c: ICommand = { ...a, handler: () => true };
  try {
    const owner = f.commands.replaceCommand(a, b);
    expect(() => f.commands.replaceCommand(b, c)).toThrow(/active/);
    f.commands.unregisterCommand(a.id);
    f.commands.registerCommand(c);
    expect(owner.isCurrent()).toBe(false);
    owner.dispose();
    expect(owner.isCurrent()).toBe(false);
    const current = f.commands.replaceCommand(c, b);
    owner.dispose();
    expect(current.isCurrent()).toBe(true);
    current.dispose();
    expect(f.commands.syncExecuteCommand(a.id, { unitId: f.book.getId(), subUnitId: '1' })).toBe(true);
  } finally { f.univer.dispose(); }
});

it('revokes an old registration even when the same replacement object is removed and reinserted', () => {
  const f = createWorkbookBirthFixture();
  const replacement: ICommand = { ...RemoveSheetMutation, handler: () => false };
  try {
    const owner = f.commands.replaceCommand(RemoveSheetMutation, replacement);
    f.commands.unregisterCommand(replacement.id);
    f.commands.registerCommand(replacement);
    expect(owner.isCurrent()).toBe(false);
    owner.dispose();
    expect(owner.isCurrent()).toBe(false);
    const current = f.commands.replaceCommand(replacement, { ...replacement });
    current.dispose();
  } finally { f.univer.dispose(); }
});

it('rechecks scoped registration after durability waiting before native Undo can pop history', async () => {
  const { UndoCommand } = await import('@univerjs/core');
  const f = createWorkbookBirthFixture();
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  let originalCalls = 0, laterCalls = 0;
  const owner = f.commands.replaceCommand(UndoCommand, {
    ...UndoCommand, asyncOnly: true,
    handler: async accessor => {
      started();
      await waiting;
      if (!owner.isCurrent()) throw Error('History command owner changed');
      originalCalls++;
      return UndoCommand.handler(accessor);
    },
  });
  let undo: Promise<unknown> | undefined;
  try {
    f.book.getActiveSheet().getRange('A1').setValue(17);
    const before = f.history.getUndoRedoStatus(f.book.getId());
    undo = f.api.undo();
    await entered;
    f.commands.unregisterCommand(UndoCommand.id);
    f.commands.registerCommand({ ...UndoCommand, handler: () => { laterCalls++; return false; } });
    release();
    await expect(undo).rejects.toThrow('History command owner changed');
    expect(originalCalls).toBe(0);
    expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual(before);
    expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(17);
    owner.dispose();
    await f.api.undo();
    expect(laterCalls).toBe(1);
    expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual(before);
  } finally {
    release();
    await undo?.catch(() => {});
    owner.dispose();
    f.univer.dispose();
  }
});


it.each(['lib/es/index.js', 'lib/cjs/index.js', 'lib/index.js'])('retains identity-aware ownership in the actual pinned %s entry', entry => {
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(require.resolve('@univerjs/core')), '../..');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const path = process.argv[1];
const core = path.includes('/cjs/') ? createRequire(import.meta.url)(path) : await import(pathToFileURL(path).href);
const univer = new core.Univer();
const commands = univer.__getInjector().get(core.ICommandService);
const expected = {id:'owned.command.registration',type:core.CommandType.COMMAND,handler:()=>17};
const replacement = {...expected,handler:()=>23};
commands.registerCommand(expected);
const owner = commands.replaceCommand(expected,replacement);
if (!Object.isFrozen(owner) || !owner.isCurrent() || commands.syncExecuteCommand(expected.id)!==23) throw Error('Replacement not current');
commands.unregisterCommand(expected.id);
commands.registerCommand(replacement);
if (owner.isCurrent()) throw Error('Same-object registration ABA retained authority');
owner.dispose();
if (owner.isCurrent() || commands.syncExecuteCommand(expected.id)!==23) throw Error('Disposal overwrote later registration');
const next = commands.replaceCommand(replacement,{...replacement});
next.dispose();
owner.dispose();
if (commands.syncExecuteCommand(expected.id)!==23) throw Error('Disposed owner resurrected');
univer.dispose();
process.stdout.write(JSON.stringify({replacement:23,disposedCurrent:owner.isCurrent()}));
`, resolve(root, entry)], { encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual({ replacement: 23, disposedCurrent: false });
});
