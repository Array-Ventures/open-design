import { expect, it, vi } from 'vitest';
import { IUniverInstanceService } from '@univerjs/core';
import { createSourceDeleteHistoryFixture as fixture } from '../helpers/workbook-source-delete-fixture';

it('reports the live unsaved sheet list through Add, Rename, Delete and native Undo without rewriting the source model', async () => {
  const f = fixture(true);
  try {
    const initial = f.controller!.inspectManagement()!;
    expect(initial.snapshot.sheetOrder).toEqual(['1', '2', '3']);
    await f.controller!.add('Notes', 3);
    await f.controller!.rename('4', 'Research');
    const renamed = f.controller!.inspectManagement()!;
    expect(renamed.snapshot.sheetOrder).toEqual(['1', '2', '3', '4']);
    expect(renamed.snapshot.sheets['4']!.name).toBe('Research');
    expect(renamed.historyRevision).toBeGreaterThan(initial.historyRevision);
    expect(renamed.busy).toBe(false);
    expect(f.source.model.sheets.map(sheet => sheet.id)).toEqual(['1', '2', '3']);
    await f.controller!.remove('4');
    expect(f.controller!.inspectManagement()!.snapshot.sheetOrder).toEqual(['1', '2', '3']);
    await f.api.undo();
    expect(f.controller!.inspectManagement()!.snapshot.sheets['4']!.name).toBe('Research');
  } finally { await f.close(); }
});

it('returns detached read data without issuing history or writing a draft', async () => {
  const save = vi.fn(async () => {});
  const f = fixture(true, { save });
  try {
    const before = f.book.save(), checkpoint = f.history.getUndoRedoCheckpoint();
    const writer = f.writer.checkpoint();
    const view = f.controller!.inspectManagement()!;
    view.snapshot.sheets['1']!.name = 'Untrusted display change';
    view.snapshot.sheetOrder.pop();
    expect(f.book.save()).toEqual(before);
    expect(f.writer.checkpoint()).toEqual(writer);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(checkpoint);
    expect(save).not.toHaveBeenCalled();
    expect(f.controller!.inspectManagement()!.snapshot).toEqual(before);
  } finally { await f.close(); }
});

it('exposes the actual protected admission barrier while its durable Add preparation is held', async () => {
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(true, { save: async state => {
    if (state?.sheetBirths?.entries.length) { entered(); await gate; }
  } });
  let adding: Promise<unknown> | undefined;
  try {
    adding = f.controller!.add('Held admission', 3);
    await waiting;
    expect(f.controller!.inspectManagement()!.busy).toBe(true);
    release(); await adding;
    expect(f.controller!.inspectManagement()!.busy).toBe(false);
    expect(f.controller!.inspectManagement()!.snapshot.sheets['4']!.name).toBe('Held admission');
  } finally { release(); await adding; await f.close(); }
});

it('withdraws inspection for foreign focus, revoked ownership and disposal', async () => {
  let current = true;
  const f = fixture(true, { current: () => current });
  try {
    expect(f.controller!.inspectManagement()).not.toBeNull();
    const instances = f.univer.__getInjector().get(IUniverInstanceService);
    const other = f.api.createWorkbook({ id: 'inspection-other', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Other', rowCount: 10, columnCount: 10 } } });
    instances.focusUnit(other.getId());
    expect(f.controller!.inspectManagement()).toBeNull();
    instances.focusUnit(f.book.getId());
    expect(f.controller!.inspectManagement()).not.toBeNull();
    current = false;
    expect(f.controller!.inspectManagement()).toBeNull();
    current = true; f.controller!.dispose();
    expect(f.controller!.inspectManagement()).toBeNull();
  } finally { await f.close(); }
});
