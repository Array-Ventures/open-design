import { expect, it } from 'vitest';
import { IUniverInstanceService } from '@univerjs/core';
import { RemoveSheetCommand } from '@univerjs/sheets';
import { createSourceDeleteHistoryFixture as fixture } from '../helpers/workbook-source-delete-fixture';

it('admits the pinned confirmed Delete shape through the resolved private workbook', async () => {
  const f = fixture(true);
  try {
    // RemoveSheetConfirmCommand dispatches subUnitId after confirmation.
    await expect(f.commands.executeCommand(RemoveSheetCommand.id, { subUnitId: '2' })).resolves.toBe(true);
    expect(f.book.save().sheets['2']).toBeUndefined();
    expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(21);
    await f.api.undo();
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(17);
    await f.api.redo();
    expect(f.book.save().sheets['2']).toBeUndefined();
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await f.close(); }
});

it('delegates implicit confirmed Delete and native Undo for another focused workbook', async () => {
  const f = fixture(true);
  try {
    const before = f.book.save();
    const other = f.api.createWorkbook({ id: 'confirmed-other', sheetOrder: ['x', 'y'], sheets: {
      x: { id: 'x', name: 'Other X', rowCount: 10, columnCount: 10 },
      y: { id: 'y', name: 'Other Y', rowCount: 10, columnCount: 10 },
    } });
    f.univer.__getInjector().get(IUniverInstanceService).focusUnit(other.getId());
    await expect(f.commands.executeCommand(RemoveSheetCommand.id, { subUnitId: 'x' })).resolves.toBe(true);
    expect(other.save().sheets.x).toBeUndefined();
    await f.api.undo();
    expect(other.save().sheets.x!.name).toBe('Other X');
    expect(f.book.save()).toEqual(before);
  } finally { await f.close(); }
});

it('rejects an explicit missing-unit target and preserves exact private data/history', async () => {
  const f = fixture(true);
  try {
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    await expect(f.commands.executeCommand(RemoveSheetCommand.id, { unitId: 'missing', subUnitId: '2' })).rejects.toThrow('The source Delete target is invalid.');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
  } finally { await f.close(); }
});
