import { expect, it } from 'vitest';
import { RemoveSheetCommand } from '@univerjs/sheets';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import { captureWorkbookSourceDeletion, workbookSourceDeleteContextSchema } from '../../src/components/embedded/workbook/sheet-delete-context';

it('captures the exact selected desired configuration and position independently from its historical baseline', async () => {
  const second = blankWorkbookSheet('2', 'Second');
  second.cells.push({ row: 0, column: 0, kind: 'number', value: 17 });
  const f = createWorkbookBirthFixture('1', 100, [second]);
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    const desired = f.book.save();
    const context = captureWorkbookSourceDeletion(scope, { ...f.checkpoint, desired }, '2');
    expect(context.removedIndex).toBe(1);
    expect(context.removedSheet).toEqual(desired.sheets['2']);
    expect(context.baseline.sheet.cells[0]?.value).toBe(17);
    expect(context.acknowledgedSheet.cellData?.[0]?.[0]?.v).toBe(17);
    expect(f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' })).toBe(true);
    await f.api.undo();
    expect(f.book.save().sheets['2']).toEqual(context.removedSheet);
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(20);
    expect(context.removedSheet?.cellData?.[0]?.[0]?.v).toBe(19);
    expect(desired.sheets['2']?.cellData?.[0]?.[0]?.v).toBe(19);
  } finally { f.univer.dispose(); }
});

it('requires paired, identity-consistent, bounded removed geometry while retaining explicit legacy data', () => {
  const f = createWorkbookBirthFixture('1', 100, [blankWorkbookSheet('2', 'Second')]);
  try {
    const context = captureWorkbookSourceDeletion(scope, f.checkpoint, '2');
    for (const mutate of [
      (value: typeof context) => { delete value.removedIndex; },
      (value: typeof context) => { delete value.removedSheet; },
      (value: typeof context) => { value.removedIndex = 64; },
      (value: typeof context) => { value.removedSheet!.id = '1'; },
      (value: typeof context) => { value.removedSheet!.cellData = { 100: { 0: { v: 12 } } }; },
      (value: typeof context) => { value.removedSheet!.rowCount = 1_000_000; },
    ]) {
      const copy = structuredClone(context); mutate(copy);
      expect(() => workbookSourceDeleteContextSchema.parse(copy)).toThrow();
    }
    const legacy = structuredClone(context); delete legacy.removedSheet; delete legacy.removedIndex;
    expect(workbookSourceDeleteContextSchema.parse(legacy)).toEqual(legacy);
  } finally { f.univer.dispose(); }
});
