import { expect, it } from 'vitest';
import { InsertRowCommand } from '@univerjs/sheets';
import { createSourceDeleteHistoryFixture as fixture, sourceDeleteScope as scope } from '../helpers/workbook-source-delete-fixture';
import { standInWorkbookResult } from '../helpers/workbook-birth-transport';
import { ownWorkbookAxisIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import type { WorkbookCheckpoint, WorkbookWriteIntent } from '../../src/components/embedded/workbook/workbook-writer';
import { membershipResult } from '../helpers/workbook-membership-result';
import { WorkbookSheetHistoryController } from '../../src/components/embedded/workbook/sheet-history-controller';
import { assertDerivedWorkbookDeletion, deriveWorkbookRestoredDeletion } from '../../src/components/embedded/workbook/sheet-delete-derived';
import { IUniverInstanceService, UniverInstanceType, type Workbook } from '@univerjs/core';
import { WORKBOOK_SHEET_BIRTH_MARKER } from '../../src/components/embedded/workbook/sheet-birth-context';
import { InsertSheetMutation } from '@univerjs/sheets';

it('directly deletes a privately born unsaved sheet and native Undo restores its latest full configuration instead of the original blank', async () => {
  const f = fixture(true);
  try {
    const birth = await f.controller!.add('Unsaved private', 3);
    const id = birth.descriptor.sheetId;
    f.book.getSheetBySheetId(id)!.getRange('A1').setValue(23);
    f.book.getSheetBySheetId(id)!.getRange('A1').setFontWeight('bold');
    const removed = f.book.save().sheets[id]!;
    await f.controller!.remove(id);
    expect(f.book.save().sheets[id]).toBeUndefined();
    await f.api.undo();
    expect(f.book.save().sheets[id]!.cellData).toEqual(removed.cellData);
    expect(f.book.save().sheets[id]!.rowData).toEqual(removed.rowData);
    expect(f.writer.checkpoint().sheetBirths!.entries.find(value => value.descriptor.sheetId === id)!.initialSheet.cellData).toEqual({});
    await f.api.redo();
    expect(f.book.save().sheets[id]).toBeUndefined();
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await f.close(); }
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function absentOrigin(origin: 'birth' | 'restored', options: {
  save?: (state: WorkbookCheckpoint | null) => Promise<void>; current?: () => boolean;
} = {}) {
  let f!: ReturnType<typeof fixture>;
  f = fixture(true, { ...options, write: async (intent, checkpoint) => {
    intent.renderId ??= crypto.randomUUID(); await checkpoint();
    return membershipResult(f.source, intent, 'b'.repeat(64));
  } });
  try {
    const id = origin === 'birth' ? (await f.controller!.add('Absent private birth', 3)).descriptor.sheetId : '2';
    if (origin === 'restored') { await f.controller!.remove(id); await f.writer.flush(); await f.api.undo(); }
    f.book.getSheetBySheetId(id)!.getRange('A1').setValue(23);
    return { f, id };
  } catch (error) { await f.close(); throw error; }
}

it.each(['birth', 'restored'] as const)('renames a private source-absent %s and keeps that name and latest23 across direct Delete Undo', async origin => {
  const { f, id } = await absentOrigin(origin);
  try {
    const oldName = f.book.save().sheets[id]!.name;
    await f.controller!.rename(id, 'Renamed absent owner');
    await f.api.undo();
    expect(f.book.save().sheets[id]!.name).toBe(oldName);
    await f.api.redo();
    expect(f.book.save().sheets[id]!.name).toBe('Renamed absent owner');
    await f.controller!.remove(id);
    await f.api.undo();
    expect(f.book.save().sheets[id]!.name).toBe('Renamed absent owner');
    expect(f.book.save().sheets[id]!.cellData![0]![0]!.v).toBe(23);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await f.close(); }
});

it.each(['birth', 'restored'] as const)('keeps a source-absent %s and native history untouched when direct Delete storage fails and then retries latest23', async origin => {
  let denied = false;
  const { f, id } = await absentOrigin(origin, { save: async () => { if (denied) throw Error('Absent origin storage denied'); } });
  try {
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    denied = true;
    await expect(f.controller!.remove(id)).rejects.toThrow('Absent origin storage denied');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
    denied = false;
    await f.controller!.remove(id);
    await f.api.undo();
    expect(f.book.save().sheets[id]!.cellData![0]![0]!.v).toBe(23);
  } finally { await f.close(); }
});

for (const origin of ['birth', 'restored'] as const) for (const withdrawal of ['focus', 'lease'] as const) {
  it(`refuses ${withdrawal} withdrawal before source-absent ${origin} direct Delete enters native code`, async () => {
    const started = gate(), release = gate();
    let blocking = false, current = true;
    const { f, id } = await absentOrigin(origin, { current: () => current,
      save: async () => { if (blocking) { started.resolve(); await release.promise; } },
    });
    let deleting: Promise<void> | undefined;
    try {
      const before = f.book.save(), status = f.history.getUndoRedoStatus(f.book.getId());
      blocking = true;
      deleting = f.controller!.remove(id);
      void deleting.catch(() => {});
      await started.promise;
      if (withdrawal === 'lease') current = false;
      else {
        const other = f.api.createWorkbook({ id: 'absent-other-focus', sheetOrder: ['x'], sheets: { x: { id: 'x', name: 'Other', rowCount: 10, columnCount: 10 } } });
        f.univer.__getInjector().get(IUniverInstanceService).focusUnit(other.getId());
      }
      release.resolve();
      await expect(deleting).rejects.toThrow(/changed|lease/);
      expect(f.book.save()).toEqual(before);
      expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual(status);
      expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
    } finally { release.resolve(); await deleting?.catch(() => {}); await f.close(); }
  });
}

for (const origin of ['birth', 'restored'] as const) for (const phase of ['before', 'during'] as const) {
  it(`refuses native payload alias mutation ${phase} source-absent ${origin} Undo storage without pop`, async () => {
    const started = gate(), release = gate();
    let blocking = false;
    const { f, id } = await absentOrigin(origin, { save: async () => { if (blocking) { started.resolve(); await release.promise; } } });
    let undo: Promise<unknown> | undefined;
    try {
      await f.controller!.remove(id);
      const item = f.history.pitchTopUndoElement()!;
      const insert = item.undoMutations.find(value => value.id === InsertSheetMutation.id)!;
      const alias = insert.params as { sheet: { cellData: Record<number, Record<number, { v: number }>> } };
      const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
      if (phase === 'during') { blocking = true; undo = f.api.undo(); void undo.catch(() => {}); await started.promise; }
      alias.sheet.cellData[0]![0]!.v = 999;
      if (phase === 'before') { undo = f.api.undo(); void undo.catch(() => {}); }
      release.resolve();
      await expect(undo).rejects.toThrow('Delete payload changed');
      expect(f.book.save()).toEqual(before);
      expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
      expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
    } finally { release.resolve(); await undo?.catch(() => {}); await f.close(); }
  });
}

it('keeps the original pending creation while direct Delete Undo/Redo restores latest23 and later derives the exact saved-target template', async () => {
  const started = gate(), release = gate();
  let f!: ReturnType<typeof fixture>, writes = 0;
  f = fixture(true, { write: async (intent, checkpoint) => {
    writes++;
    intent.renderId ??= crypto.randomUUID();
    await checkpoint();
    if (writes === 1) { started.resolve(); await release.promise; }
    expect(writes).toBeLessThanOrEqual(2);
    return membershipResult(f.source, intent, (writes === 1 ? 'b' : 'c').repeat(64));
  } });
  let saving: Promise<void> | undefined;
  try {
    const birth = await f.controller!.add('Pending birth', 3), id = birth.descriptor.sheetId;
    f.book.getSheetBySheetId(id)!.getRange('A1').setValue(19);
    saving = f.writer.flush();
    await started.promise;
    const pending = structuredClone(f.writer.checkpoint().pending);
    f.book.getSheetBySheetId(id)!.getRange('A1').setValue(23);
    await f.controller!.remove(id);
    expect(f.writer.checkpoint().pending).toEqual(pending);
    await f.api.undo();
    expect(f.book.save().sheets[id]!.cellData![0]![0]!.v).toBe(23);
    expect(f.writer.checkpoint().pending).toEqual(pending);
    await f.api.redo();
    expect(f.book.save().sheets[id]).toBeUndefined();
    expect(f.writer.checkpoint().pending).toEqual(pending);
    release.resolve();
    await saving;
    expect(f.writer.state().error).toBeNull();
    expect(writes).toBe(2);
    expect(f.writer.checkpoint().source.sourceSha256).toBe('c'.repeat(64));
    const context = f.writer.checkpoint().sheetDeletions!.find(value => value.descriptor.sheetId === id)!;
    expect(context.templateSide).toBe('saved-target');
    expect(context.baseline.sheet.cells[0]!.value).toBe(19);
    expect(context.removedSheet!.cellData![0]![0]!.v).toBe(23);
    expect(context.receiptAssociation?.versionId).toBe('version-b');
    await f.api.undo();
    expect(f.book.save().sheets[id]!.cellData![0]![0]!.v).toBe(23);
    f.book.getSheetBySheetId(id)!.getRange('A1').setValue(25);
    await f.controller!.remove(id);
    await f.api.undo();
    expect(f.book.save().sheets[id]!.cellData![0]![0]!.v).toBe(25);
    expect(f.writer.checkpoint().sheetDeletions!.at(-1)!.baseline.sheet.cells[0]!.value).toBe(19);
  } finally { release.resolve(); await saving; await f.close(); }
});

it('preserves pending restoration through another direct Delete Undo/Redo and its checked ACK before re-restoring latest23', async () => {
  const started = gate(), release = gate();
  let f!: ReturnType<typeof fixture>, writes = 0;
  f = fixture(true, { write: async (intent, checkpoint) => {
    writes++;
    intent.renderId ??= crypto.randomUUID();
    await checkpoint();
    if (writes === 2) { started.resolve(); await release.promise; }
    expect(writes).toBeLessThanOrEqual(3);
    return membershipResult(f.source, intent, ['b', 'c', 'd'][writes - 1]!.repeat(64));
  } });
  let saving: Promise<void> | undefined;
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    await f.controller!.remove('2');
    await f.writer.flush();
    await f.api.undo();
    saving = f.writer.flush();
    await started.promise;
    const pending = structuredClone(f.writer.checkpoint().pending);
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(23);
    await f.controller!.remove('2');
    await f.api.undo();
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(23);
    await f.api.redo();
    expect(f.writer.checkpoint().pending).toEqual(pending);
    release.resolve();
    await saving;
    expect(f.writer.state().error).toBeNull();
    expect(writes).toBe(3);
    expect(f.writer.checkpoint().source.sourceSha256).toBe('d'.repeat(64));
    await f.api.undo();
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(23);
    expect(f.writer.checkpoint().sheetDeletions!.at(-1)!.baseline.sheet.cells[0]!.value).toBe(17);
  } finally { release.resolve(); await saving; await f.close(); }
});

it.each(['birth', 'restored'] as const)('does not promote retained %s markers or pool data to a new native issuer after controller replacement', async origin => {
  let f!: ReturnType<typeof fixture>;
  f = fixture(true, { write: async (intent, checkpoint) => {
    intent.renderId ??= crypto.randomUUID(); await checkpoint();
    return membershipResult(f.source, intent, 'b'.repeat(64));
  } });
  let replacement: WorkbookSheetHistoryController | undefined;
  try {
    const id = origin === 'birth' ? (await f.controller!.add('Retained birth', 3)).descriptor.sheetId : '2';
    if (origin === 'restored') { await f.controller!.remove(id); await f.writer.flush(); await f.api.undo(); }
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    f.controller!.dispose();
    replacement = new WorkbookSheetHistoryController(f.univer, f.writer, scope, () => f.book.save(), () => true);
    await expect(replacement.remove(id)).rejects.toThrow(/live.*issuer|live deletion ancestor/);
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { replacement?.dispose(); await f.close(); }
});

it('refuses a copied birth marker on a different privately created sheet before deletion', async () => {
  const f = fixture(true);
  try {
    const first = await f.controller!.add('First own birth', 3), second = await f.controller!.add('Second own birth', 4);
    const unit = f.univer.__getInjector().get(IUniverInstanceService).getUnit<Workbook>(f.book.getId(), UniverInstanceType.UNIVER_SHEET)!;
    const sheet = unit.getSheetBySheetId(first.descriptor.sheetId)!;
    sheet.setCustomMetadata({ ...sheet.getCustomMetadata(), [WORKBOOK_SHEET_BIRTH_MARKER]: second.descriptor });
    f.writer.update(f.book.save());
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    await expect(f.controller!.remove(first.descriptor.sheetId)).rejects.toThrow('live unsaved birth issuer');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
  } finally { await f.close(); }
});

it('keeps the immutable template/baseline while deriving latest selected removal data and rejects changed backing or stale selected data', async () => {
  let f!: ReturnType<typeof fixture>;
  f = fixture(true, { write: async (intent, checkpoint) => {
    intent.renderId ??= crypto.randomUUID(); await checkpoint();
    return membershipResult(f.source, intent, 'b'.repeat(64));
  } });
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    await f.controller!.remove('2'); await f.writer.flush(); await f.api.undo();
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(23);
    const state = f.writer.checkpoint(), ancestor = state.sheetDeletions![0]!;
    const derived = deriveWorkbookRestoredDeletion(state, ancestor.descriptor);
    expect(derived.descriptor.token).not.toBe(ancestor.descriptor.token);
    expect(derived.baseline).toEqual(ancestor.baseline);
    expect(derived.receiptAssociation).toEqual(ancestor.receiptAssociation);
    expect(derived.removedSheet!.cellData![0]![0]!.v).toBe(23);
    expect(() => assertDerivedWorkbookDeletion(state, derived, ancestor.descriptor)).not.toThrow();
    const baseline = structuredClone(derived);
    baseline.baseline.sheet.cells[0]!.value = 999;
    expect(() => assertDerivedWorkbookDeletion(state, baseline, ancestor.descriptor)).toThrow('immutable backing');
    const removed = structuredClone(derived);
    removed.removedSheet!.cellData![0]![0]!.v = 19;
    expect(() => assertDerivedWorkbookDeletion(state, removed, ancestor.descriptor)).toThrow('selected configuration');
    const receipt = structuredClone(derived);
    receipt.receiptAssociation!.sourceVersionId = 'forged-version';
    expect(() => assertDerivedWorkbookDeletion(state, receipt, ancestor.descriptor)).toThrow('immutable backing');
    expect(() => assertDerivedWorkbookDeletion(state, derived, { ...ancestor.descriptor, token: crypto.randomUUID() })).toThrow('unique retained ancestor');
  } finally { await f.close(); }
});

it('directly re-deletes a privately restored but unsaved sheet, preserving its latest values, styles and inserted axis through Undo', async () => {
  let f!: ReturnType<typeof fixture>;
  f = fixture(true, { write: async (intent: WorkbookWriteIntent, checkpoint) => {
    intent.renderId ??= crypto.randomUUID();
    await checkpoint();
    const target = structuredClone(f.source);
    target.sourceSha256 = 'b'.repeat(64);
    target.model.sheets = target.model.sheets.filter(sheet => sheet.id !== '2');
    for (const edit of intent.plan.edits) {
      const sheet = target.model.sheets.find(value => value.id === edit.sheetId)!;
      sheet.cells = sheet.cells.filter(cell => cell.row !== edit.cell.row || cell.column !== edit.cell.column);
      sheet.cells.push(structuredClone(edit.cell));
    }
    return standInWorkbookResult(scope, intent, target, 'before-restored-delete', 'after-restored-delete');
  } });
  const axes = ownWorkbookAxisIdentity(f.univer, () => f.book.save(), () => true);
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    await f.controller!.remove('2');
    await f.writer.flush();
    expect(f.writer.state().error).toBeNull();
    await f.api.undo();
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(23);
    f.book.getSheetBySheetId('2')!.getRange('A1').setFontWeight('bold');
    expect(await f.commands.executeCommand(InsertRowCommand.id, { unitId: f.book.getId(), subUnitId: '2',
      range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 25 } })).toBe(true);
    const removed = f.book.save().sheets['2']!;
    await f.controller!.remove('2');
    expect(f.book.save().sheets['2']).toBeUndefined();
    await f.api.undo();
    const restored = f.book.save().sheets['2']!;
    expect(restored.cellData).toEqual(removed.cellData);
    expect(restored.rowData).toEqual(removed.rowData);
    expect(restored.columnData).toEqual(removed.columnData);
    expect(restored.rowCount).toBe(removed.rowCount);
    expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(21);
    expect(f.writer.checkpoint().sheetDeletions!.at(-1)!.baseline.sheet.cells[0]!.value).toBe(17);
    expect(f.writer.checkpoint().sheetDeletions!.at(-1)!.removedSheet!.cellData![0]![0]!.v).toBe(23);
  } finally { axes.dispose(); await f.close(); }
});

