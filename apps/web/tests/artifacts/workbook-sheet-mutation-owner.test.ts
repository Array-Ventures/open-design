import { afterEach, expect, it, vi } from 'vitest';
import { IUniverInstanceService, UniverInstanceType, UndoCommand, RedoCommand, type IWorkbookData, type Workbook } from '@univerjs/core';
import { InsertSheetCommand, InsertSheetMutation, RemoveSheetCommand, RemoveSheetMutation } from '@univerjs/sheets';
import { createWorkbookBirthFixture } from '../helpers/workbook-birth-fixture';
import { WorkbookSheetMutationOwner } from '../../src/components/embedded/workbook/sheet-mutation-owner';
import { workbookSheetMutationSnapshot, WORKBOOK_SHEET_REMOVALS } from '../../src/components/embedded/workbook/sheet-removal-selection';
import type { WorkbookSheetActionDescriptor } from '../../src/components/embedded/workbook/sheet-action-descriptor';

const close: (() => void)[] = [];
afterEach(() => close.splice(0).reverse().forEach(dispose => dispose()));
function fixture() {
  const f = createWorkbookBirthFixture(); close.push(() => f.univer.dispose());
  expect(f.commands.syncExecuteCommand(InsertSheetCommand.id, {
    unitId: f.book.getId(), sheet: { id: '2', name: 'Second' }, index: 1,
  })).toBe(true);
  const pool = new Set<string>();
  let current = true;
  const generation = f.book.save().custom!.evebotStructureOwner.generation as string;
  const descriptor = (): WorkbookSheetActionDescriptor => ({ version: 1, generation, sheetId: '2', token: crypto.randomUUID() });
  const first = descriptor(); pool.add(first.token);
  const owner = new WorkbookSheetMutationOwner(f.univer, f.book.getId(), {
    snapshot: () => f.book.save(), isCurrent: () => current,
    owns: value => value.generation === generation && value.sheetId === '2' && pool.has(value.token),
  });
  close.push(() => owner.dispose());
  const remove = (before: IWorkbookData) => {
    const after = structuredClone(before);
    delete after.sheets['2']; after.sheetOrder = after.sheetOrder.filter(id => id !== '2');
    return after;
  };
  return { ...f, owner, first, pool, descriptor, remove, revoke: () => { current = false; } };
}

it('keeps repeated protected selections coherent in real command observers and immutable pending snapshots', () => {
  const f = fixture();
  const seen: unknown[] = [];
  const observer = f.commands.onCommandExecuted(command => {
    if ([RemoveSheetMutation.id, InsertSheetMutation.id].includes(command.id)) seen.push(structuredClone(f.book.save().custom?.[WORKBOOK_SHEET_REMOVALS]));
  }); close.push(() => observer.dispose());
  const before = f.book.save();
  f.owner.run('remove', f.first, before, f.remove(before), () => f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' }));
  const frozen = structuredClone(f.book.save());
  f.owner.run('insert', f.first, frozen, before, () => f.commands.syncExecuteCommand(UndoCommand.id));
  const second = f.descriptor(); f.pool.add(second.token);
  const restored = f.book.save();
  f.owner.run('remove', second, restored, f.remove(restored), () => f.commands.syncExecuteCommand(RedoCommand.id));
  expect(seen).toEqual([
    { version: 1, generation: f.first.generation, entries: { '2': f.first.token } },
    undefined,
    { version: 1, generation: second.generation, entries: { '2': second.token } },
  ]);
  expect(frozen.custom?.[WORKBOOK_SHEET_REMOVALS]).toEqual(seen[0]);
  expect(f.owner.isCurrent()).toBe(true);
});

it('refuses unarmed, unissued and stale pre-model actions before invoking the native mutation', () => {
  const f = fixture(), before = f.book.save(), after = f.remove(before);
  expect(f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' })).toBe(false);
  expect(() => f.owner.run('remove', f.descriptor(), before, after, () => true)).toThrow('not current');
  f.book.getSheetBySheetId('1')!.getRange('A1').setValue(20);
  expect(() => f.owner.run('remove', f.first, before, after, () => f.commands.syncExecuteCommand(RemoveSheetMutation.id, { unitId: f.book.getId(), subUnitId: '2' }))).toThrow('target changed');
  expect(f.book.save().sheetOrder).toEqual(['1', '2']);
  expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(20);
  expect(f.owner.isCurrent()).toBe(false); // Full protected callback mismatch must be quarantined by Writer too.
});

it('withdraws authority on native metadata failure without claiming rollback', () => {
  const f = fixture(), before = f.book.save(), after = f.remove(before);
  const unit = f.univer.__getInjector().get(IUniverInstanceService).getUnit<Workbook>(f.book.getId(), UniverInstanceType.UNIVER_SHEET)!;
  const setter = vi.spyOn(unit, 'setCustomMetadata').mockImplementation(() => { throw Error('metadata unavailable'); });
  try {
    expect(() => f.owner.run('remove', f.first, before, after, () => f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' }))).toThrow();
    expect(f.book.save().sheets['2']).toBeUndefined(); // No fictitious rollback after partial SDK mutation.
    expect(f.owner.isCurrent()).toBe(false);
  } finally { setter.mockRestore(); }
});

it('refuses mismatched generation, duplicate tokens and maps pointing to present sheets', () => {
  const f = fixture(), before = f.book.save(), after = f.remove(before);
  expect(() => workbookSheetMutationSnapshot(before, after, 'remove', { ...f.first, generation: crypto.randomUUID() })).toThrow('generation');
  before.custom![WORKBOOK_SHEET_REMOVALS] = { version: 1, generation: f.first.generation, entries: { '2': f.first.token } };
  expect(() => workbookSheetMutationSnapshot(before, after, 'remove', f.first)).toThrow('membership');
  before.custom![WORKBOOK_SHEET_REMOVALS] = { version: 1, generation: f.first.generation, entries: { '3': f.first.token, '4': f.first.token } };
  expect(() => workbookSheetMutationSnapshot(before, after, 'remove', f.first)).toThrow();
});


it('preserves unexpected metadata emitted during native removal and fences rather than overwriting it', () => {
  const f = fixture(), before = f.book.save(), after = f.remove(before);
  const unit = f.univer.__getInjector().get(IUniverInstanceService).getUnit<Workbook>(f.book.getId(), UniverInstanceType.UNIVER_SHEET)!;
  const observer = unit.sheetDisposed$.subscribe(() => unit.setCustomMetadata({ ...unit.getCustomMetadata(), unexpected: 'retain evidence' }));
  close.push(() => observer.unsubscribe());
  expect(() => f.owner.run('remove', f.first, before, after, () => f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' }))).toThrow();
  expect(f.book.save().custom?.unexpected).toBe('retain evidence');
  expect(f.owner.isCurrent()).toBe(false);
});

it('refuses withdrawn authority before invocation and leaves later unknown registrations intact on cleanup', () => {
  const f = fixture(), before = f.book.save(), after = f.remove(before);
  f.revoke();
  const execute = vi.fn(() => true);
  expect(() => f.owner.run('remove', f.first, before, after, execute)).toThrow('not current');
  expect(execute).not.toHaveBeenCalled();
  expect(f.book.save()).toEqual(before);
  const unknown = { ...InsertSheetMutation, handler: () => false };
  f.commands.unregisterCommand(InsertSheetMutation.id); f.commands.registerCommand(unknown);
  f.owner.dispose();
  const verify = f.commands.replaceCommand(unknown, { ...unknown }); verify.dispose();
  const original = f.commands.replaceCommand(RemoveSheetMutation, { ...RemoveSheetMutation }); original.dispose();
});

it('retains the real Writer precommand checkpoint and sticky quarantine after partial native failure', async () => {
  const { WorkbookWriter } = await import('../../src/components/embedded/workbook/workbook-writer');
  const { captureWorkbookSourceDeletion } = await import('../../src/components/embedded/workbook/sheet-delete-context');
  const { blankWorkbookSheet } = await import('../../src/components/embedded/workbook/sheet-birth-context');
  const { serializeWorkbookDraft } = await import('../../src/components/embedded/workbook/draft-store');
  const { birthScope: scope } = await import('../helpers/workbook-birth-fixture');
  const f = createWorkbookBirthFixture('1', 100, [blankWorkbookSheet('2', 'Second')]);
  close.push(() => f.univer.dispose());
  const context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
  const before = f.book.save(), after = structuredClone(before);
  delete after.sheets['2']; after.sheetOrder = ['1'];
  const prospective = workbookSheetMutationSnapshot(before, after, 'remove', context.descriptor);
  const remote = vi.fn(async () => { throw Error('A quarantined owner must never write'); });
  const protectedRecords: unknown[] = [];
  const writer = new WorkbookWriter(f.source, before, remote, () => {}, undefined, {
    scope, isCurrent: () => true, validate: candidate => { serializeWorkbookDraft(scope, candidate); },
    save: async candidate => { if (candidate) { serializeWorkbookDraft(scope, candidate); protectedRecords.push(structuredClone(candidate)); } },
  });
  const owner = new WorkbookSheetMutationOwner(f.univer, f.book.getId(), {
    isCurrent: () => true, snapshot: () => f.book.save(), owns: value => value.token === context.descriptor.token,
  });
  close.push(() => owner.dispose());
  const unit = f.univer.__getInjector().get(IUniverInstanceService).getUnit<Workbook>(f.book.getId(), UniverInstanceType.UNIVER_SHEET)!;
  const internalObserver = unit.sheetDisposed$.subscribe(() => writer.update(f.book.save()));
  const commandObserver = f.commands.onCommandExecuted(() => writer.update(f.book.save()));
  close.push(() => internalObserver.unsubscribe(), () => commandObserver.dispose());
  const setter = vi.spyOn(unit, 'setCustomMetadata').mockImplementation(() => { throw Error('metadata unavailable'); });
  try {
    await expect(writer.protectSheetDeletion(context, prospective, () => owner.run('remove', context.descriptor, before, after,
      () => f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' })))).rejects.toThrow();
    writer.update(f.book.save());
    await writer.flush();
    expect(remote).not.toHaveBeenCalled();
    expect(writer.checkpoint()).toMatchObject({ desired: before, source: f.source, sheetActionConflict: true, sheetDeletions: [context] });
    expect(writer.state()).toMatchObject({ dirty: true });
    expect(writer.state().error).not.toBeNull();
    expect(protectedRecords.length).toBeGreaterThan(0);
    expect(f.book.save().sheets['2']).toBeUndefined();
  } finally { setter.mockRestore(); await writer.close(); }
});


it('withdraws the owner when its protected callback throws after a successful native mutation', () => {
  const f = fixture(), before = f.book.save(), after = f.remove(before);
  expect(() => f.owner.run('remove', f.first, before, after, () => {
    expect(f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' })).toBe(true);
    throw Error('callback failed after mutation');
  })).toThrow('callback failed after mutation');
  expect(f.book.save().sheets['2']).toBeUndefined();
  expect(f.owner.isCurrent()).toBe(false);
});

it('does not accept a serialized removal token without live protected pool ownership', () => {
  const f = fixture();
  const unit = f.univer.__getInjector().get(IUniverInstanceService).getUnit<Workbook>(f.book.getId(), UniverInstanceType.UNIVER_SHEET)!;
  unit.setCustomMetadata({ ...unit.getCustomMetadata(), [WORKBOOK_SHEET_REMOVALS]: {
    version: 1, generation: f.first.generation, entries: { '3': crypto.randomUUID() },
  } });
  const before = f.book.save(), execute = vi.fn(() => true);
  expect(() => f.owner.run('remove', f.first, before, f.remove(before), execute)).toThrow('no live protected owner');
  expect(execute).not.toHaveBeenCalled();
  expect(f.book.save()).toEqual(before);
});

it.each(['focus', 'registration'] as const)('withdraws actual %s ownership before the native callback', reason => {
  const f = fixture(), before = f.book.save(), execute = vi.fn(() => true);
  if (reason === 'focus') {
    f.api.createWorkbook({ id: 'other-focused-unit', sheetOrder: ['1'], sheets: {
      '1': { id: '1', name: 'Other', rowCount: 100, columnCount: 26 },
    } });
    f.univer.__getInjector().get(IUniverInstanceService).focusUnit('other-focused-unit');
  } else {
    f.commands.unregisterCommand(RemoveSheetMutation.id);
    f.commands.registerCommand({ ...RemoveSheetMutation, handler: () => false });
  }
  expect(f.owner.isCurrent()).toBe(false);
  expect(() => f.owner.run('remove', f.first, before, f.remove(before), execute)).toThrow('not current');
  expect(execute).not.toHaveBeenCalled();
  expect(f.book.save()).toEqual(before);
});
