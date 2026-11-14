import { afterEach, expect, it } from 'vitest';
import { mergeWorksheetSnapshotWithDefault } from '@univerjs/core';
import { InsertSheetCommand } from '@univerjs/sheets';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { seedWorkbookNewSheetIdentity, assertWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { prepareWorkbookSheetBirth, checkedWorkbookSheetBirths } from '../../src/components/embedded/workbook/sheet-birth-context';
import { workbookGridPlan, workbookPlanHasChanges } from '../../src/components/embedded/workbook/grid-plan';
import { WorkbookWriter, type WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';
import { checkedWorkbookSaveAcknowledgement } from '../../src/components/embedded/workbook/save-provenance';
import { decodeWorkbookDraft } from '../../src/components/embedded/workbook/workbook-checkpoint';

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).reverse().forEach(close => close()));
function fixture(id = '1', rows = 100) {
  const f = createWorkbookBirthFixture(id, rows);
  closers.push(() => f.univer.dispose());
  return f;
}

it('predicts the actual native blank insertion snapshot and preserves only the new axes through native redo', async () => {
  const f = fixture();
  const blank = seedWorkbookNewSheetIdentity(f.book.save(), mergeWorksheetSnapshotWithDefault({
    id: '2', name: 'New worksheet', rowCount: 100, columnCount: 26,
    defaultStyle: '0', cellData: {}, rowData: {}, columnData: {},
  }));
  expect(f.commands.syncExecuteCommand(InsertSheetCommand.id, {
    unitId: f.book.getId(), index: 1, sheet: structuredClone(blank),
  })).toBe(true);
  expect(f.book.save().sheets['2']).toEqual(blank);
  expect(() => assertWorkbookStructureIdentity(f.book.save())).not.toThrow();
  f.book.getSheetBySheetId('2')!.getRange('A1').setValue(17);
  await f.api.undo(); await f.api.undo();
  expect(f.book.save().sheets['2']).toBeUndefined();
  await f.api.redo();
  expect(f.book.save().sheets['2']).toEqual(blank);
  await f.api.redo();
  expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(17);
  expect(blank.cellData).toEqual({});
  expect(() => assertWorkbookStructureIdentity(f.book.save())).not.toThrow();
  expect(f.book.save().sheets['1']!.rowData).toEqual(f.initial.sheets['1']!.rowData);
  expect(f.book.save().sheets['1']!.columnData).toEqual(f.initial.sheets['1']!.columnData);
  expect(f.book.save().custom).toEqual(f.initial.custom);
});

it('derives only an owned blank source origin and authored edits from actual SDK Insert and Undo/Redo', async () => {
  const f = fixture();
  const prepared = prepareWorkbookSheetBirth(scope, f.checkpoint, 'Born worksheet', 1);
  const plan = () => workbookGridPlan(f.source.model, f.source.sourceSha256, f.checkpoint.acknowledged, f.book.save(), { births: prepared.state });
  expect(prepared.entry.descriptor.sheetId).toBe('2');
  expect(prepared.state.highWaterId).toBe(2);
  expect(f.commands.syncExecuteCommand(InsertSheetCommand.id, {
    unitId: f.book.getId(), index: 1, sheet: structuredClone(prepared.entry.initialSheet),
  })).toBe(true);
  expect(f.book.save()).toEqual(prepared.snapshot);
  expect(plan().sheets).toEqual([{ sheetId: '1', name: 'Existing', origin: 'source' }, { sheetId: '2', name: 'Born worksheet', origin: 'new' }]);
  expect(plan().edits).toEqual([]);
  f.book.getSheetBySheetId('2')!.getRange('A1').setValue(17);
  expect(plan().edits).toEqual([{ sheetId: '2', cell: { row: 0, column: 0, kind: 'number', value: 17 } }]);
  await f.api.undo(); await f.api.undo();
  expect(workbookPlanHasChanges(plan())).toBe(false);
  const next = prepareWorkbookSheetBirth(scope, { ...f.checkpoint, desired: f.book.save() }, 'Later birth', 1, prepared.state);
  expect(next.entry.descriptor.sheetId).toBe('3');
  expect(next.state.highWaterId).toBe(3);
  expect(next.state.entries.map(item => item.descriptor.sheetId)).toEqual(['2', '3']);
  await f.api.redo();
  expect(f.book.save().sheets['2']).toEqual(prepared.entry.initialSheet);
  expect(plan().edits).toEqual([]);
  await f.api.redo();
  expect(plan().edits[0]?.cell.value).toBe(17);
  expect(f.checkpoint.acknowledged.sheets['2']).toBeUndefined();
  expect(f.source.model.sheets.map(sheet => sheet.id)).toEqual(['1']);
});

it('refuses numeric exhaustion and prospective area before invoking a native birth', () => {
  for (const [id, rows, reason] of [['65535', 100, 'exhausted'], ['1', 3800, 'calculation budget']] as const) {
    const f = fixture(id, rows), before = f.book.save(), history = f.history.getUndoRedoStatus(f.book.getId());
    expect(() => prepareWorkbookSheetBirth(scope, f.checkpoint, 'No birth', 1)).toThrow(reason);
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual(history);
  }
});

it('refuses changed blank content, generation, scope and imported markers as a protected origin', () => {
  const f = fixture(), prepared = prepareWorkbookSheetBirth(scope, f.checkpoint, 'Born worksheet', 1);
  const wrongBlank = structuredClone(prepared.state);
  wrongBlank.entries[0]!.initialSheet.cellData = { 0: { 0: { v: 999 } } };
  expect(() => checkedWorkbookSheetBirths(wrongBlank, f.checkpoint.acknowledged)).toThrow('blank baseline');
  const wrongGeneration = structuredClone(prepared.state);
  wrongGeneration.axisOwner.generation = crypto.randomUUID();
  expect(() => checkedWorkbookSheetBirths(wrongGeneration, f.checkpoint.acknowledged)).toThrow();
  expect(() => prepareWorkbookSheetBirth({ ...scope, viewerId: 'another-person' }, f.checkpoint, 'Next', 1, prepared.state)).toThrow('scope');
  f.commands.syncExecuteCommand(InsertSheetCommand.id, { unitId: f.book.getId(), index: 1, sheet: structuredClone(prepared.entry.initialSheet) });
  expect(() => workbookGridPlan(f.source.model, f.source.sourceSha256, f.checkpoint.acknowledged, f.book.save())).toThrow('protected owner');
  expect(() => prepareWorkbookSheetBirth(scope, { ...f.checkpoint, desired: f.book.save() }, 'Next', 1)).toThrow('no protected birth origin');
  const changed = f.book.save();
  changed.sheets['2']!.custom = { evebotSheetBirth: { ...prepared.entry.descriptor, token: crypto.randomUUID() } };
  expect(() => workbookGridPlan(f.source.model, f.source.sourceSha256, f.checkpoint.acknowledged, changed, { births: prepared.state })).toThrow('protected owner');
});


it('durably protects the exact birth before native insertion and drops only clean unacknowledged storage after Undo', async () => {
  const f = fixture();
  let release!: () => void, started!: () => void;
  const durable = new Promise<void>(done => { release = done; });
  const storageStarted = new Promise<void>(done => { started = done; });
  const records: (WorkbookCheckpoint | null)[] = [];
  let held = false, calls = 0;
  const writer = new WorkbookWriter(f.source, f.checkpoint.acknowledged, async () => { throw Error('No remote write expected'); }, () => {}, undefined, {
    scope, isCurrent: () => true,
    validate: candidate => { serializeWorkbookDraft(scope, candidate); },
    save: async candidate => {
      if (candidate) serializeWorkbookDraft(scope, candidate);
      records.push(structuredClone(candidate));
      if (candidate?.sheetBirths && !held) { held = true; started(); await durable; }
    },
  });
  const before = f.history.getUndoRedoStatus(f.book.getId());
  const inserting = writer.protectSheetBirth('Protected birth', 1, entry => {
    calls++;
    expect(records.at(-1)?.sheetBirths?.entries[0]).toEqual(entry);
    f.commands.syncExecuteCommand(InsertSheetCommand.id, { unitId: f.book.getId(), index: 1, sheet: structuredClone(entry.initialSheet) });
    return f.book.save();
  });
  try {
    await storageStarted;
    expect(calls).toBe(0);
    expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual(before);
    expect(f.book.save().sheets['2']).toBeUndefined();
    release();
    const entry = await inserting;
    expect(calls).toBe(1);
    const restored = decodeWorkbookDraft(JSON.parse(serializeWorkbookDraft(scope, writer.checkpoint())), scope);
    expect(restored.sheetBirths?.entries[0]).toEqual(entry);
    expect(writer.state()).toMatchObject({ dirty: true, error: null });
    await f.api.undo();
    writer.update(f.book.save());
    await writer.close();
    expect(records.at(-1)).toBeNull();
    expect(writer.checkpoint().sheetBirths?.highWaterId).toBe(2);
    expect(writer.checkpoint().sheetBirths?.entries[0]).toEqual(entry);
    await f.api.redo();
    expect(f.book.save().sheets['2']).toEqual(entry.initialSheet);
  } finally { release(); await inserting.catch(() => {}); await writer.close(); }
});

it('keeps the blank native birth origin through a checked first-save ACK and validates its protected checkpoint', async () => {
  const f = fixture();
  const target = structuredClone(f.source);
  target.sourceSha256 = 'b'.repeat(64);
  target.model.sheets.push({ id: '2', name: 'Saved birth', visibility: 'visible', rowCount: 100, columnCount: 26,
    cells: [{ row: 0, column: 0, kind: 'number', value: 17 }], merges: [], rowDimensions: [], columnDimensions: [],
    frozenRows: 0, frozenColumns: 0, arrayFormulas: [] });
  const records: WorkbookCheckpoint[] = [];
  let writes = 0;
  const writer = new WorkbookWriter(f.source, f.checkpoint.acknowledged, async intent => {
    writes++;
    expect(intent.plan.sheets).toEqual([{ sheetId: '1', name: 'Existing', origin: 'source' }, { sheetId: '2', name: 'Saved birth', origin: 'new' }]);
    expect(intent.plan.edits).toEqual([{ sheetId: '2', cell: { row: 0, column: 0, kind: 'number', value: 17 } }]);
    intent.renderId = crypto.randomUUID();
    const acknowledgement = checkedWorkbookSaveAcknowledgement({ id: intent.id, projectId: scope.projectId,
      fileName: scope.fileName, renderId: intent.renderId, state: 'applied', sourceSha256: f.source.sourceSha256,
      targetSha256: target.sourceSha256, actualSha256: target.sourceSha256, sourceVersionId: 'before-birth', versionId: 'saved-birth' },
    { ...intent, operationId: intent.id, projectId: scope.projectId, fileName: scope.fileName }, target.sourceSha256);
    return { preview: target, acknowledgement };
  }, () => {}, undefined, { scope, isCurrent: () => true,
    validate: candidate => { serializeWorkbookDraft(scope, candidate); },
    save: async candidate => { if (candidate) { serializeWorkbookDraft(scope, candidate); records.push(structuredClone(candidate)); } },
  });
  try {
    const entry = await writer.protectSheetBirth('Saved birth', 1, entry => {
      f.commands.syncExecuteCommand(InsertSheetCommand.id, { unitId: f.book.getId(), index: 1, sheet: structuredClone(entry.initialSheet) });
      return f.book.save();
    });
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(17);
    writer.update(f.book.save());
    await writer.flush();
    expect(writes).toBe(1);
    expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
    expect(writer.checkpoint().source.sourceSha256).toBe(target.sourceSha256);
    expect(writer.checkpoint().acknowledged.sheets['2']!.cellData![0]![0]!.v).toBe(17);
    expect(writer.checkpoint().sheetBirths?.entries[0]).toEqual(entry);
    expect(entry.initialSheet.cellData).toEqual({});
    expect(decodeWorkbookDraft(JSON.parse(serializeWorkbookDraft(scope, writer.checkpoint())), scope).sheetBirths?.entries[0]).toEqual(entry);
    expect(records.find(record => record.pending?.acknowledgement)?.source.sourceSha256).toBe(f.source.sourceSha256);
    expect(f.source.model.sheets.map(sheet => sheet.id)).toEqual(['1']);
  } finally { await writer.close(); }
});

it('quarantines native Insert divergence and retains the protected pre-command branch through later updates', async () => {
  const f = fixture(), records: WorkbookCheckpoint[] = [];
  let writes = 0;
  const writer = new WorkbookWriter(f.source, f.checkpoint.acknowledged, async () => { writes++; throw Error('No write'); }, () => {}, undefined, {
    scope, isCurrent: () => true, validate: candidate => { serializeWorkbookDraft(scope, candidate); },
    save: async candidate => { if (candidate) records.push(structuredClone(candidate)); },
  });
  try {
    await expect(writer.protectSheetBirth('Uncertain birth', 1, entry => {
      f.commands.syncExecuteCommand(InsertSheetCommand.id, { unitId: f.book.getId(), index: 1, sheet: structuredClone(entry.initialSheet) });
      f.book.getSheetBySheetId('1')!.getRange('A1').setValue(999);
      throw Error('After actual SDK mutation');
    })).rejects.toThrow('needs recovery');
    writer.update(f.book.save()); await writer.flush();
    expect(writes).toBe(0);
    expect(writer.state().dirty).toBe(true);
    expect(writer.checkpoint().sheetActionConflict).toBe(true);
    expect(writer.checkpoint().desired).toEqual(f.checkpoint.desired);
    expect(writer.checkpoint().sheetBirths?.entries).toHaveLength(1);
    expect(records.at(-1)?.sheetActionConflict).toBe(true);
    expect(decodeWorkbookDraft(JSON.parse(serializeWorkbookDraft(scope, writer.checkpoint())), scope).sheetActionConflict).toBe(true);
  } finally { await writer.close(); }
});

it('refuses exact prospective birth quota without poisoning later ordinary edits', async () => {
  const f = fixture();
  let calls = 0, writes = 0;
  const writer = new WorkbookWriter(f.source, f.checkpoint.acknowledged, async () => { writes++; throw Error('Ordinary transport remains callable'); }, () => {}, undefined, {
    scope, isCurrent: () => true,
    validate: candidate => { serializeWorkbookDraft(scope, candidate); if (candidate.desired.sheets['2']) throw Error('Exact device quota'); },
    save: async () => {},
  });
  try {
    await expect(writer.protectSheetBirth('Denied birth', 1, () => { calls++; return f.book.save(); })).rejects.toThrow('quota');
    expect(calls).toBe(0); expect(writes).toBe(0);
    expect(writer.checkpoint().sheetBirths).toBeUndefined();
    expect(writer.checkpoint().sheetActionConflict).toBeUndefined();
    expect(f.book.save()).toEqual(f.checkpoint.acknowledged);
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(20);
    writer.update(f.book.save()); await writer.flush();
    expect(writes).toBe(1);
    expect(writer.checkpoint().desired.sheets['1']!.cellData![0]![0]!.v).toBe(20);
    expect(writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await writer.close(); }
});


it.each([false, undefined])('refuses birth with missing or false dedicated membership capability (%s)', capability => {
  const f = fixture();
  f.source.model.worksheetMembershipEditable = capability;
  const before = f.book.save(), history = f.history.getUndoRedoStatus(f.book.getId());
  expect(() => prepareWorkbookSheetBirth(scope, f.checkpoint, 'No membership authority', 1)).toThrow(/qualified/);
  expect(f.book.save()).toEqual(before);
  expect(f.history.getUndoRedoStatus(f.book.getId())).toEqual(history);
});
