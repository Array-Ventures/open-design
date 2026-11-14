// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkbookRecovery } from '../../src/components/embedded/workbook/use-workbook-recovery';
import { WorkbookWriter } from '../../src/components/embedded/workbook/workbook-writer';
import { bindWorkbookSourceSnapshot } from '../../src/components/embedded/workbook/source-snapshot-binding';
import { workbookDraftKey } from '../../src/components/embedded/workbook/workbook-checkpoint';
import type { WorkbookDraftScope } from '../../src/components/embedded/workbook/workbook-checkpoint';
import { readWorkbookDraft, WORKBOOK_DRAFT_DATABASE } from '../../src/components/embedded/workbook/draft-store';
import { awaitRetiredWorkbookDrafts } from '../../src/components/embedded/workbook/draft-retirement';
import { Univer, LocaleType, ICommandService, IUniverInstanceService, UniverInstanceType, type Workbook, type IWorkbookData } from '@univerjs/core';
import { UniverSheetsPlugin, RemoveSheetCommand } from '@univerjs/sheets';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import English from '@univerjs/sheets/locale/en-US';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { seedWorkbookStructureIdentity } from '../../src/components/embedded/workbook/grid-structure-identity';
import { captureWorkbookSourceDeletion, stampWorkbookSourceDeletion } from '../../src/components/embedded/workbook/sheet-delete-context';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { checkedWorkbookSaveAcknowledgement } from '../../src/components/embedded/workbook/save-provenance';
import { workbookRecoveryFixture } from '../helpers/workbook-recovery-fixture';
const scope = { viewerId: 'saved-workbook-person', projectId: 'cbe6759a-187b-4ce4-b945-debb3440656d', fileName: 'Saved.xlsx' };

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  // Browser API stand-in only; the recovery hook, lease, writer and IDB store
  // are their real production implementations throughout this lifecycle.
  const held = new Set<string>();
  vi.stubGlobal('navigator', { locks: { request: async (key: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
    await Promise.resolve(); if (held.has(key)) return callback(null);
    held.add(key); try { await callback({ name: key, mode: 'exclusive' } as Lock); } finally { held.delete(key); }
  } } });
});
afterEach(async () => { cleanup(); await awaitRetiredWorkbookDrafts(scope); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function savedOrdinaryWorkbook() {
  let writer: WorkbookWriter | undefined;
  const first = renderHook(() => useWorkbookRecovery(scope, true, () => writer?.close() ?? Promise.resolve()));
  await waitFor(() => expect(first.result.current.session).not.toBeNull());
  const session = first.result.current.session!, original = workbookRecoveryFixture(scope.projectId, scope.fileName);
  const target = structuredClone(original.source); target.sourceSha256 = 'b'.repeat(64); target.model.sheets[0]!.cells = [{ row: 0, column: 0, kind: 'number', value: 20 }];
  writer = new WorkbookWriter(original.source, original.acknowledged, async (intent, checkpoint) => {
    intent.renderId = crypto.randomUUID(); await checkpoint();
    return { preview: target, acknowledgement: checkedWorkbookSaveAcknowledgement({ id: intent.id, projectId: scope.projectId, fileName: scope.fileName, renderId: intent.renderId, state: 'applied', sourceSha256: original.source.sourceSha256, targetSha256: target.sourceSha256, actualSha256: target.sourceSha256, sourceVersionId: 'before-save', versionId: 'saved-target' },
      { ...intent, operationId: intent.id, projectId: scope.projectId, fileName: scope.fileName, renderId: intent.renderId }, target.sourceSha256) };
  }, () => {}, undefined, session.journal);
  const changed = structuredClone(original.desired); changed.sheets.s!.cellData = { 0: { 0: { v: 20, t: 2 } } };
  await act(async () => { writer!.update(changed); await writer!.flush(); });
  return { first, writer, session, target, original };
}
it('opens the saved workbook normally after Save, close and reopen rather than asking to recover an unsaved draft', async () => {
  const { first, writer, session, target } = await savedOrdinaryWorkbook();
  expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
  expect((await readWorkbookDraft(session.scope))?.sourceAcknowledgement?.kind).toBe('history');
  first.unmount(); await awaitRetiredWorkbookDrafts(scope);
  const reopened = renderHook(() => useWorkbookRecovery(scope, true, async () => {}, target));
  await waitFor(() => expect(reopened.result.current.busy).toBe(false));
  expect(reopened.result.current.drafts).toEqual([]);
  await waitFor(() => expect(reopened.result.current.session).not.toBeNull());
});

it.each(['unsaved', 'pending', 'quarantined'] as const)('still offers the actual %s branch for recovery after close and reopen', async kind => {
  let writer: WorkbookWriter | undefined, sdk: Univer | undefined;
  const first = renderHook(() => useWorkbookRecovery(scope, true, () => writer?.close() ?? Promise.resolve()));
  await waitFor(() => expect(first.result.current.session).not.toBeNull());
  const session = first.result.current.session!;
  if (kind === 'quarantined') {
    const fixture = sdkWorkbook(); sdk = fixture.univer;
    writer = new WorkbookWriter(fixture.source, fixture.data, async () => { throw Error('No remote write'); }, () => {}, undefined, session.journal);
    const checkpoint = writer.checkpoint(), context = captureWorkbookSourceDeletion(session.scope, checkpoint, '2');
    const prospective = structuredClone(checkpoint.desired); delete prospective.sheets['2']; prospective.sheetOrder = ['1'];
    await expect(writer.protectSheetDeletion(context, prospective, () => {
      stampWorkbookSourceDeletion(fixture.worksheet('2')!, context.descriptor);
      fixture.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: fixture.data.id, subUnitId: '2' });
      fixture.book.getSheetBySheetId('1')!.getRange('A1').setValue(99); return fixture.book.save();
    })).rejects.toThrow('recovery');
    expect(fixture.book.getSheetBySheetId('2')).toBeNull(); expect(fixture.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(99);
  } else {
    const original = workbookRecoveryFixture(scope.projectId, scope.fileName);
    writer = new WorkbookWriter(original.source, original.acknowledged, async () => { throw Error('Lost transport result'); }, () => {}, undefined, session.journal);
    const desired = structuredClone(original.desired); desired.sheets.s!.cellData = { 0: { 0: { v: 20, t: 2 } } }; writer.update(desired);
    if (kind === 'pending') await writer.flush();
  }
  await writer.close(); const expected = writer.checkpoint(); first.unmount(); await awaitRetiredWorkbookDrafts(scope); sdk?.dispose();
  await mutateStored(session.scope, 'heads', raw => ({ ...(raw as Record<string, unknown>), needsRecovery: false }));
  const reopened = renderHook(() => useWorkbookRecovery(scope, true, async () => {}, expected.source));
  await waitFor(() => expect(reopened.result.current.busy).toBe(false));
  expect(reopened.result.current.drafts.map(head => head.draftId)).toEqual([session.scope.draftId]); expect(reopened.result.current.session).toBeNull();
  await act(async () => { await reopened.result.current.restore(session.scope.draftId); });
  expect(reopened.result.current.session?.journal.restored).toEqual(expected);
});

function sdkWorkbook() {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: '1', styles: [{}], worksheetStructureEditable: true, calculationMetadata: 'verified', features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: ['1','2'].map(id => ({ id, name: `Sheet ${id}`, visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: 12, style: 0 }], merges: [], rowDimensions: [], columnDimensions: [], frozenRows: 0, frozenColumns: 0, arrayFormulas: [] })) };
  const source = { sourceSha256: 'a'.repeat(64), model }, data = seedWorkbookStructureIdentity(gridWorkbook(model, `${scope.projectId}:${scope.fileName}`, 'Workbook').data as IWorkbookData, source.sourceSha256);
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English } }); univer.registerPlugin(UniverSheetsPlugin);
  const unit = FUniver.newAPI(univer), book = unit.createWorkbook(data), instances = univer.__getInjector().get(IUniverInstanceService); instances.focusUnit(book.getId());
  const raw = instances.getUnit<Workbook>(book.getId(), UniverInstanceType.UNIVER_SHEET)!;
  return { source, data: book.save(), univer, unit, book, worksheet: (id: string) => raw.getSheetBySheetId(id), commands: univer.__getInjector().get(ICommandService) };
}
it('retires completed Delete/Save history context only after its live editor lease ends', async () => {
  const f = sdkWorkbook(); let writer: WorkbookWriter | undefined;
  const first = renderHook(() => useWorkbookRecovery(scope, true, () => writer?.close() ?? Promise.resolve()));
  await waitFor(() => expect(first.result.current.session).not.toBeNull());
  const session = first.result.current.session!, target = structuredClone(f.source); target.sourceSha256 = 'b'.repeat(64); target.model.sheets = target.model.sheets.filter(sheet => sheet.id === '1');
  writer = new WorkbookWriter(f.source, f.data, async (intent, checkpoint) => {
    intent.renderId = crypto.randomUUID(); await checkpoint();
    return { preview: target, acknowledgement: checkedWorkbookSaveAcknowledgement({ id: intent.id, projectId: scope.projectId, fileName: scope.fileName, renderId: intent.renderId, state: 'applied', sourceSha256: f.source.sourceSha256, targetSha256: target.sourceSha256, actualSha256: target.sourceSha256, sourceVersionId: 'before-delete', versionId: 'after-delete' },
      { ...intent, operationId: intent.id, projectId: scope.projectId, fileName: scope.fileName, renderId: intent.renderId }, target.sourceSha256) };
  }, () => {}, undefined, session.journal);
  const original = writer.checkpoint(), context = captureWorkbookSourceDeletion(session.scope, original, '2');
  const prospective = structuredClone(original.desired); delete prospective.sheets['2']; prospective.sheetOrder = ['1'];
  await act(async () => {
    await writer!.protectSheetDeletion(context, prospective, () => {
      stampWorkbookSourceDeletion(f.worksheet('2')!, context.descriptor);
      f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.data.id, subUnitId: '2' }); return f.book.save();
    });
    await writer!.flush();
  });
  expect(writer.state().dirty).toBe(false);
  expect((await readWorkbookDraft(session.scope))?.sheetDeletions?.[0]?.receiptAssociation?.sourceVersionId).toBe('before-delete');
  // Another tab must not clear the first live editor's history ownership.
  const another = renderHook(() => useWorkbookRecovery(scope, true, async () => {}, target));
  await waitFor(() => expect(another.result.current.busy).toBe(false));
  expect(another.result.current.drafts).toEqual([]); await waitFor(() => expect(another.result.current.session).not.toBeNull());
  expect(session.journal.isCurrent?.()).toBe(true); expect(await readWorkbookDraft(session.scope)).not.toBeNull();
  another.unmount(); first.unmount(); await awaitRetiredWorkbookDrafts(scope); f.univer.dispose();
  const reopened = renderHook(() => useWorkbookRecovery(scope, true, async () => {}, target));
  await waitFor(() => expect(reopened.result.current.busy).toBe(false));
  expect(reopened.result.current.drafts).toEqual([]); await waitFor(() => expect(reopened.result.current.session).not.toBeNull());
  expect(await readWorkbookDraft(session.scope)).toBeNull();
});

async function mutateStored(scope: WorkbookDraftScope, storeName: 'workbooks' | 'heads', change: (raw: unknown) => unknown): Promise<void> {
  const request = indexedDB.open(WORKBOOK_DRAFT_DATABASE, 1);
  const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite'), store = transaction.objectStore(storeName), get = store.get(workbookDraftKey(scope));
      get.onsuccess = () => { try { const value = change(get.result); if (store.keyPath) store.put(value); else store.put(value, workbookDraftKey(scope)); } catch { transaction.abort(); } };
      transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}
async function replaceDraft(scope: WorkbookDraftScope, change: (raw: string) => string): Promise<void> {
  await mutateStored(scope, 'workbooks', raw => change(raw as string));
}
it.each(['model-style', 'ack-style', 'proof', 'unknown-version', 'self-consistent-model', 'corrupt-json'] as const)('keeps a %s changed metadata-clean record visible instead of deleting it', async change => {
  const { first, session, target } = await savedOrdinaryWorkbook(); first.unmount(); await awaitRetiredWorkbookDrafts(scope);
  await replaceDraft(session.scope, raw => {
    if (change === 'corrupt-json') return '{broken json';
    const record = JSON.parse(raw), checkpoint = record.checkpoint;
    if (change === 'model-style' || change === 'self-consistent-model') checkpoint.source.model.styles[0] = { font: { size: 22.25 } };
    if (change === 'ack-style') checkpoint.acknowledged.styles['0'] = { fs: 99 };
    if (change === 'proof') checkpoint.sourceSnapshotBinding.modelSha256 = '0'.repeat(64);
    if (change === 'unknown-version') checkpoint.sourceSnapshotBinding.version = 2;
    if (change === 'self-consistent-model') checkpoint.sourceSnapshotBinding = bindWorkbookSourceSnapshot(session.scope, checkpoint.source, checkpoint.acknowledged, checkpoint.sourceAcknowledgement);
    return JSON.stringify(record);
  });
  const reopened = renderHook(() => useWorkbookRecovery(scope, true, async () => {}, target));
  await waitFor(() => expect(reopened.result.current.busy).toBe(false));
  expect(reopened.result.current.drafts.map(head => head.draftId)).toEqual([session.scope.draftId]); expect(reopened.result.current.session).toBeNull();
});
it.each(['bytes', 'model'] as const)('does not retire saved metadata against a changed current preview %s identity', async change => {
  const { first, session, target } = await savedOrdinaryWorkbook(); first.unmount(); await awaitRetiredWorkbookDrafts(scope);
  const fresh = structuredClone(target); if (change === 'bytes') fresh.sourceSha256 = 'c'.repeat(64); else fresh.model.styles[0] = { font: { size: 22.25 } };
  const reopened = renderHook(() => useWorkbookRecovery(scope, true, async () => {}, fresh));
  await waitFor(() => expect(reopened.result.current.busy).toBe(false));
  expect(reopened.result.current.drafts.map(head => head.draftId)).toEqual([session.scope.draftId]); expect(await readWorkbookDraft(session.scope)).not.toBeNull();
});
it('rereads the actual record after the index and exact cleanup lease, preserving a newly dirty branch', async () => {
  const { first, writer, session, target } = await savedOrdinaryWorkbook();
  const request = navigator.locks.request.bind(navigator.locks); let raced = false;
  vi.spyOn(navigator.locks, 'request').mockImplementation(async (key: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    if (!raced && key.includes(session.scope.draftId)) {
      raced = true; const newer = writer.recoveredSnapshot(); newer.sheets.s!.cellData![0]![0]!.v = 21; writer.update(newer);
      first.unmount(); await awaitRetiredWorkbookDrafts(scope);
    }
    return request(key, options, callback);
  });
  const reopened = renderHook(() => useWorkbookRecovery(scope, true, async () => {}, target));
  await waitFor(() => expect(reopened.result.current.busy).toBe(false)); expect(raced).toBe(true);
  expect(reopened.result.current.drafts.map(head => head.draftId)).toEqual([session.scope.draftId]);
  expect((await readWorkbookDraft(session.scope))?.desired.sheets.s!.cellData![0]![0]!.v).toBe(21);
});

it('leaves a historical unclassified head visible until the person chooses recovery', async () => {
  const { first, session, target } = await savedOrdinaryWorkbook(); first.unmount(); await awaitRetiredWorkbookDrafts(scope);
  await mutateStored(session.scope, 'heads', raw => { const old = { ...(raw as Record<string, unknown>) }; delete old.needsRecovery; return old; });
  const reopened = renderHook(() => useWorkbookRecovery(scope, true, async () => {}, target));
  await waitFor(() => expect(reopened.result.current.busy).toBe(false));
  expect(reopened.result.current.drafts.map(head => head.draftId)).toEqual([session.scope.draftId]); expect(await readWorkbookDraft(session.scope)).not.toBeNull();
});
it('allows a new independent editor when cleanup acquisition is unavailable, without deleting the clean branch', async () => {
  const { first, session, target } = await savedOrdinaryWorkbook(); first.unmount(); await awaitRetiredWorkbookDrafts(scope);
  const request = navigator.locks.request.bind(navigator.locks);
  vi.spyOn(navigator.locks, 'request').mockImplementation(async (key: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    if (key.includes(session.scope.draftId)) throw Error('Cleanup lease unavailable'); return request(key, options, callback);
  });
  const reopened = renderHook(() => useWorkbookRecovery(scope, true, async () => {}, target));
  await waitFor(() => expect(reopened.result.current.session).not.toBeNull());
  expect(reopened.result.current.drafts).toEqual([]); expect(reopened.result.current.session!.scope.draftId).not.toBe(session.scope.draftId); expect(await readWorkbookDraft(session.scope)).not.toBeNull();
});
it('fences a cleanup release failure through existing retirement before explicit continuation', async () => {
  const { first, session, target } = await savedOrdinaryWorkbook(); first.unmount(); await awaitRetiredWorkbookDrafts(scope);
  const request = navigator.locks.request.bind(navigator.locks);
  vi.spyOn(navigator.locks, 'request').mockImplementation(async (key: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    const result = await request(key, options, callback); if (key.includes(session.scope.draftId)) throw Error('Browser cleanup release failed'); return result;
  });
  const reopened = renderHook(() => useWorkbookRecovery(scope, true, async () => {}, target));
  await waitFor(() => expect(reopened.result.current.error).toContain('release its branch safely'));
  expect(reopened.result.current.session).toBeNull();
  await act(async () => { await reopened.result.current.continueCurrent(); });
  expect(reopened.result.current.session).not.toBeNull(); expect(reopened.result.current.session!.scope.draftId).not.toBe(session.scope.draftId);
});
