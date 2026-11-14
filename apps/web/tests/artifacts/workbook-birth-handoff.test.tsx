// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InsertSheetCommand } from '@univerjs/sheets';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { WorkbookWriter } from '../../src/components/embedded/workbook/workbook-writer';
import { useWorkbookEditor } from '../../src/components/embedded/workbook/use-workbook-editor';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { saveWorkbook } from '../../src/components/embedded/workbook/save-transport';
vi.mock('../../src/components/embedded/workbook/save-transport', async original => ({ ...await original<object>(), saveWorkbook: vi.fn(async () => { throw Error('Unexpected transport'); }) }));
const closers: (() => void)[] = [];
afterEach(() => { cleanup(); closers.splice(0).reverse().forEach(close => close()); vi.clearAllMocks(); });

it.each(['same', 'fresh'] as const)('keeps clean birth data only for the %s native generation during ready handoff', async generation => {
  const f = createWorkbookBirthFixture();
  closers.push(() => f.univer.dispose());
  const journal = { scope, isCurrent: () => true,
    validate: (checkpoint: ReturnType<WorkbookWriter['checkpoint']>) => { serializeWorkbookDraft(scope, checkpoint); },
    save: vi.fn(async () => {}),
  };
  const writer = new WorkbookWriter(f.source, f.checkpoint.acknowledged, async () => { throw Error('No transport'); }, () => {}, undefined, journal);
  await writer.protectSheetBirth('Live birth', 1, entry => {
    f.commands.syncExecuteCommand(InsertSheetCommand.id, { unitId: f.book.getId(), index: 1, sheet: structuredClone(entry.initialSheet) });
    return f.book.save();
  });
  await f.api.undo(); writer.update(f.book.save()); await writer.close();
  const restored = writer.checkpoint();
  expect(restored.sheetBirths?.highWaterId).toBe(2);
  const ownedJournal = { ...journal, restored };
  const hook = renderHook(() => useWorkbookEditor(scope.projectId, scope.fileName, f.source, vi.fn(), undefined, ownedJournal));
  await act(async () => { await hook.result.current.ready(f.book.save()); });
  if (generation === 'fresh') {
    const fresh = createWorkbookBirthFixture();
    closers.push(() => fresh.univer.dispose());
    await act(async () => { await hook.result.current.ready(fresh.book.save()); });
    expect(hook.result.current.checkpoint()?.sheetBirths).toBeUndefined();
    expect(fresh.history.getUndoRedoStatus(fresh.book.getId())).toEqual({ undos: 0, redos: 0 });
    expect(saveWorkbook).not.toHaveBeenCalled();
    return;
  }
  await act(async () => { await hook.result.current.ready(f.book.save()); });
  expect(hook.result.current.checkpoint()?.sheetBirths).toEqual(restored.sheetBirths);
  await act(async () => { await f.api.redo(); hook.result.current.snapshot(f.book.save()); });
  expect(hook.result.current.state).toMatchObject({ dirty: true, error: null });
  expect(hook.result.current.checkpoint()?.desired.sheets['2']).toEqual(restored.sheetBirths!.entries[0]!.initialSheet);
  expect(saveWorkbook).not.toHaveBeenCalled();
});
