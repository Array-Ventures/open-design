import { expect, it, vi } from 'vitest';
import { CellValueType, type IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { WorkbookWriter, type WorkbookWriteIntent } from '../../src/components/embedded/workbook/workbook-writer';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
function fixture() {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: 's', styles: [{}], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false }, sheets: [{ id: 's', name: 'Sheet', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 1 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0 }] };
  const initial = gridWorkbook(model, 'grid', 'Forecast').data as IWorkbookData;
  const snapshot = (value: number) => { const next = structuredClone(initial); next.sheets.s!.cellData![0]![0] = { v: value, t: CellValueType.NUMBER }; return next; };
  return { source: { sourceSha256: 'a'.repeat(64), model }, initial, snapshot };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
it('keeps a clean workbook clean and clears dirty state after an acknowledged write', async () => {
  const { source, initial, snapshot } = fixture(), changed = vi.fn(), write = vi.fn(async () => ({ ...source, sourceSha256: 'b'.repeat(64) }));
  const writer = new WorkbookWriter(source, initial, write, changed);
  expect(writer.state().dirty).toBe(false); writer.update(snapshot(2)); expect(writer.state().dirty).toBe(true);
  await writer.flush(); expect(writer.state()).toEqual({ dirty: false, saving: false, error: null }); expect(write).toHaveBeenCalledTimes(1);
});
it('reuses the frozen intent after uncertainty while retaining newer edits for a second save', async () => {
  const { source, initial, snapshot } = fixture(), intents: WorkbookWriteIntent[] = [];
  let calls = 0;
  const writer = new WorkbookWriter(source, initial, async intent => { intents.push(intent); if (++calls === 1) throw new Error('Response lost'); return { ...source, sourceSha256: calls === 2 ? 'b'.repeat(64) : 'c'.repeat(64) }; }, () => {});
  writer.update(snapshot(2)); await writer.flush(); writer.update(snapshot(3)); await writer.flush();
  expect(intents).toHaveLength(3); expect(intents[0]).toBe(intents[1]); expect(intents[2]!.id).not.toBe(intents[0]!.id);
  expect(intents[1]!.plan.edits[0]!.cell.value).toBe(2); expect(intents[2]!.plan.edits[0]!.cell.value).toBe(3); expect(intents[2]!.plan.sourceSha256).toBe('b'.repeat(64));
  expect(writer.state().dirty).toBe(false);
});
it('serializes a concurrent flush and does not clear edits made while saving', async () => {
  const { source, initial, snapshot } = fixture(), first = deferred<typeof source>(), second = deferred<typeof source>();
  const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const writer = new WorkbookWriter(source, initial, write, () => {});
  writer.update(snapshot(2)); const running = writer.flush(); expect(writer.flush()).toBe(running); await Promise.resolve();
  writer.update(snapshot(3)); first.resolve({ ...source, sourceSha256: 'b'.repeat(64) }); await Promise.resolve(); await Promise.resolve();
  expect(writer.state()).toMatchObject({ dirty: true, saving: true }); second.resolve({ ...source, sourceSha256: 'c'.repeat(64) }); await running;
  expect(write).toHaveBeenCalledTimes(2); expect(writer.state().dirty).toBe(false);
});
it('blocks unsupported changes without losing them and permits undo to the original', async () => {
  const { source, initial } = fixture(), write = vi.fn(), writer = new WorkbookWriter(source, initial, write, () => {});
  const changed = structuredClone(initial); changed.sheetOrder.push('new'); writer.update(changed); await writer.flush();
  expect(write).not.toHaveBeenCalled(); expect(writer.state()).toMatchObject({ dirty: true, error: expect.stringContaining('structure') });
  writer.update(initial); expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
});
it('ignores late acknowledgements and publishes nothing after disposal', async () => {
  const { source, initial, snapshot } = fixture(), response = deferred<typeof source>(), changed = vi.fn(), accepted = vi.fn();
  const writer = new WorkbookWriter(source, initial, () => response.promise, changed, accepted);
  writer.update(snapshot(2)); const running = writer.flush(); await Promise.resolve(); writer.dispose(); changed.mockClear(); response.resolve(source); await running;
  expect(changed).not.toHaveBeenCalled(); expect(accepted).not.toHaveBeenCalled();
});
