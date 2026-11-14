import { afterEach, expect, it } from 'vitest';
import { InsertSheetCommand } from '@univerjs/sheets';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { standInWorkbookResult } from '../helpers/workbook-birth-transport';
import { WorkbookWriter, type WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).reverse().forEach(close => close()));
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

it('protects a new birth during an unrelated pending save and rebases its own save without replacing that first intent', async () => {
  const f = createWorkbookBirthFixture(); closers.push(() => f.univer.dispose());
  const transport = gate(), started = gate();
  const first = structuredClone(f.source); first.sourceSha256 = 'b'.repeat(64); first.model.sheets[0]!.cells[0]!.value = 20;
  const second = structuredClone(first); second.sourceSha256 = 'c'.repeat(64);
  const born = blankWorkbookSheet('2', 'Concurrent birth'); born.cells.push({ row: 0, column: 0, kind: 'number', value: 17 }); second.model.sheets.push(born);
  const records: WorkbookCheckpoint[] = [], operations: string[] = [];
  const writer = new WorkbookWriter(f.source, f.checkpoint.acknowledged, async intent => {
    operations.push(intent.id);
    if (operations.length === 1) {
      expect(intent.plan.sheets).toBeUndefined();
      started.resolve(); await transport.promise;
      return standInWorkbookResult(scope, intent, first, 'before-scalar', 'after-scalar');
    }
    expect(intent.plan.sourceSha256).toBe(first.sourceSha256);
    expect(intent.plan.sheets).toEqual([{ sheetId: '1', name: 'Existing', origin: 'source' }, { sheetId: '2', name: 'Concurrent birth', origin: 'new' }]);
    expect(intent.plan.edits).toEqual([{ sheetId: '2', cell: { row: 0, column: 0, kind: 'number', value: 17 } }]);
    return standInWorkbookResult(scope, intent, second, 'after-scalar', 'after-birth');
  }, () => {}, undefined, { scope, isCurrent: () => true,
    validate: candidate => { serializeWorkbookDraft(scope, candidate); },
    save: async candidate => { if (candidate) { serializeWorkbookDraft(scope, candidate); records.push(structuredClone(candidate)); } },
  });
  f.book.getSheetBySheetId('1')!.getRange('A1').setValue(20); writer.update(f.book.save());
  const saving = writer.flush();
  await started.promise;
  const original = structuredClone(writer.checkpoint().pending!);
  try {
    const entry = await writer.protectSheetBirth('Concurrent birth', 1, entry => {
      expect(records.at(-1)?.pending).toEqual(original);
      f.commands.syncExecuteCommand(InsertSheetCommand.id, { unitId: f.book.getId(), index: 1, sheet: structuredClone(entry.initialSheet) });
      return f.book.save();
    });
    expect(writer.checkpoint().pending).toEqual(original);
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(17); writer.update(f.book.save());
    transport.resolve(); await saving;
    expect(operations).toHaveLength(2);
    expect(operations[0]).toBe(original.intent.id);
    expect(operations[1]).not.toBe(original.intent.id);
    expect(writer.checkpoint().source.sourceSha256).toBe(second.sourceSha256);
    expect(writer.checkpoint().sheetBirths?.entries[0]).toEqual(entry);
    expect(entry.initialSheet.cellData).toEqual({});
    expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
  } finally { transport.resolve(); await saving; await writer.close(); }
});
