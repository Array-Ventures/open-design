import { expect, it } from 'vitest';
import { IUniverInstanceService } from '@univerjs/core';
import { SetWorksheetNameCommand } from '@univerjs/sheets';
import { createSourceDeleteHistoryFixture as fixture } from '../helpers/workbook-source-delete-fixture';

it('admits the pinned sheet-bar inline Rename shape through its resolved private workbook owner', async () => {
  const f = fixture(true);
  try {
    // SheetBarTabs.onEdit supplies subUnitId/name, with no explicit unitId.
    await expect(f.commands.executeCommand(SetWorksheetNameCommand.id, { subUnitId: '2', name: 'Footer renamed' })).resolves.toBe(true);
    expect(f.book.save().sheets['2']!.name).toBe('Footer renamed');
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.f).toContain("'Footer renamed'!A1");
    await f.api.undo();
    expect(f.book.save().sheets['2']!.name).toBe('Sheet 2');
    await f.api.redo();
    expect(f.book.save().sheets['2']!.name).toBe('Footer renamed');
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await f.close(); }
});

it('keeps implicit-target Rename and its history ordinary for another focused workbook', async () => {
  const f = fixture(true);
  try {
    const before = f.book.save();
    const other = f.api.createWorkbook({ id: 'inline-other', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Other', rowCount: 10, columnCount: 10 } } });
    f.univer.__getInjector().get(IUniverInstanceService).focusUnit(other.getId());
    await expect(f.commands.executeCommand(SetWorksheetNameCommand.id, { subUnitId: 'x', name: 'Other renamed' })).resolves.toBe(true);
    expect(other.save().sheets.x!.name).toBe('Other renamed');
    await f.api.undo();
    expect(other.save().sheets.x!.name).toBe('Other');
    expect(f.book.save()).toEqual(before);
  } finally { await f.close(); }
});

it('refuses an explicit missing workbook without borrowing the private owner', async () => {
  const f = fixture(true);
  try {
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    // The pinned public permission interceptor refuses a missing unit before
    // entering the scoped handler; false is its ordinary veto contract.
    await expect(f.commands.executeCommand(SetWorksheetNameCommand.id, { unitId: 'missing', subUnitId: '2', name: 'Refused' })).resolves.toBe(false);
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
  } finally { await f.close(); }
});
