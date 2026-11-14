import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createSourceDeleteHistoryFixture, sourceDeleteScope } from '../helpers/workbook-source-delete-fixture';
import { readWorkbookDraft, saveWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

it('retains the full birth and removal pool in real draft storage after clean native Add Undo without an ACK', async () => {
  const f = createSourceDeleteHistoryFixture(true, { save: state => saveWorkbookDraft(sourceDeleteScope, state) });
  try {
    const source = f.writer.checkpoint().source;
    await f.controller!.add('Durable native redo', 3);
    const birth = f.writer.checkpoint().sheetBirths!;
    await f.api.undo();
    const history = f.history.getUndoRedoEntryIds(f.book.getId());
    expect(history.redos).toHaveLength(1);
    const state = f.writer.checkpoint();
    expect(f.writer.state().dirty).toBe(false);
    expect(state.sourceAcknowledgement).toBeUndefined();
    expect(state.source).toEqual(source);
    expect(state.sheetBirths?.entries).toEqual(birth.entries);
    expect(state.sheetBirths?.removals).toHaveLength(1);
    expect(state.sheetBirths?.highWaterId).toBe(birth.highWaterId);
    expect(state.sheetBirths?.axisOwner).toEqual(birth.axisOwner);
    await expect.poll(() => readWorkbookDraft(sourceDeleteScope), { timeout: 300 }).toEqual(state);
    await f.api.redo();
    expect(f.book.save().sheets['4']!.name).toBe('Durable native redo');
  } finally { await f.close(); }
});
