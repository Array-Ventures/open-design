import { expect, it } from 'vitest';
import { IUniverInstanceService, UniverInstanceType, type Workbook, type ICommand } from '@univerjs/core';
import { InsertSheetCommand, InsertSheetMutation, RemoveSheetCommand, RemoveSheetMutation } from '@univerjs/sheets';
import { createWorkbookBirthFixture } from '../helpers/workbook-birth-fixture';

// Prototype only: no application registration/control consumes this seam yet.
// Tickets stand in for the existing Writer's awaited protection callback.
it('updates real Workbook metadata before mutation observers and follows official Delete/Undo/Redo without extra history', async () => {
  const fixture = createWorkbookBirthFixture();
  const { univer, book, commands, api, history } = fixture;
  const instances = univer.__getInjector().get(IUniverInstanceService);
  const unit = instances.getUnit<Workbook>(book.getId(), UniverInstanceType.UNIVER_SHEET)!;
  const originals: ICommand[] = [InsertSheetMutation, RemoveSheetMutation];
  const registrations: Array<{ dispose(): void }> = [];
  let ticket: { id: string; sheetId: string; token: string; before: string[] } | undefined;
  let calls = 0;
  const seen: Array<{ id: string; present: boolean; token: unknown }> = [];
  unit.setCustomMetadata({ ...unit.getCustomMetadata(), unrelated: { keep: 17 } });
  try {
    expect(commands.syncExecuteCommand(InsertSheetCommand.id, {
      unitId: book.getId(), sheet: { id: '2', name: 'Second' }, index: 1,
    })).toBe(true);
    for (const original of originals) {
      commands.unregisterCommand(original.id);
      registrations.push(commands.registerCommand({ ...original,
        handler: (accessor, params, options) => {
          const expected = ticket;
          ticket = undefined;
          if (!expected || expected.id !== original.id || !params || typeof params !== 'object') {
            throw Error('Unprotected sheet mutation');
          }
          const input = params as { unitId: string; subUnitId?: string; sheet?: { id: string } };
          const selected = input.subUnitId ?? input.sheet?.id;
          if (input.unitId !== unit.getUnitId() || selected !== expected.sheetId ||
              instances.getUnit<Workbook>(input.unitId, UniverInstanceType.UNIVER_SHEET) !== unit ||
              instances.getFocusedUnit() !== unit ||
              JSON.stringify(unit.getSheetOrders()) !== JSON.stringify(expected.before)) {
            throw Error('Stale sheet mutation ticket');
          }
          calls++;
          const result = original.handler(accessor, params, options);
          if (result !== true) throw Error('Sheet mutation failed; owner must quarantine');
          const custom = unit.getCustomMetadata() ?? {};
          const map = { ...(custom.removals as Record<string, string> | undefined) };
          if (original.id === RemoveSheetMutation.id) map[selected!] = expected.token;
          else delete map[selected!];
          unit.setCustomMetadata({ ...custom, removals: map });
          expect(Boolean(unit.getSheetBySheetId(selected!))).toBe(original.id === InsertSheetMutation.id);
          return result;
        },
      }));
    }
    const observer = commands.onCommandExecuted(command => {
      if (!originals.some(original => original.id === command.id)) return;
      seen.push({ id: command.id, present: Boolean(unit.getSheetBySheetId('2')),
        token: (unit.getCustomMetadata()?.removals as Record<string, string>)?.['2'] });
    });
    registrations.push(observer);
    const arm = (id: string, token = 'protected-first-removal') => {
      ticket = { id, sheetId: '2', token, before: [...unit.getSheetOrders()] };
    };
    const before = history.getUndoRedoStatus(book.getId());
    arm(RemoveSheetMutation.id);
    expect(commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: book.getId(), subUnitId: '2' })).toBe(true);
    const frozenPending = structuredClone(book.save());
    arm(InsertSheetMutation.id);
    await api.undo();
    arm(RemoveSheetMutation.id, 'protected-second-removal');
    await api.redo();
    expect(seen).toEqual([
      { id: RemoveSheetMutation.id, present: false, token: 'protected-first-removal' },
      { id: InsertSheetMutation.id, present: true, token: undefined },
      { id: RemoveSheetMutation.id, present: false, token: 'protected-second-removal' },
    ]);
    expect(frozenPending.custom?.removals).toEqual({ '2': 'protected-first-removal' });
    expect(unit.getCustomMetadata()?.unrelated).toEqual({ keep: 17 });
    expect(history.getUndoRedoStatus(book.getId())).toEqual({ undos: before.undos + 1, redos: before.redos });
    expect(calls).toBe(3);
    expect(() => commands.syncExecuteCommand(InsertSheetMutation.id, {
      unitId: book.getId(), index: 1, sheet: { id: '2', name: 'Unprotected' },
    })).toThrow('Unprotected sheet mutation');
    expect(unit.getSheetBySheetId('2')).toBeUndefined();
    expect(calls).toBe(3);
  } finally {
    for (const registration of registrations.reverse()) registration.dispose();
    for (const original of originals) if (!commands.hasCommand(original.id)) commands.registerCommand(original);
    univer.dispose();
  }
});
