import { expect, it } from 'vitest';
import { RemoveSheetCommand } from '@univerjs/sheets';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { standInWorkbookResult } from '../helpers/workbook-birth-transport';
import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import { captureWorkbookSourceDeletion } from '../../src/components/embedded/workbook/sheet-delete-context';
import { WorkbookWriter, type WorkbookCheckpoint } from '../../src/components/embedded/workbook/workbook-writer';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';

function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

it('never queues a pre-protection provider checkpoint that overwrites the durable root after the native mutation', async () => {
  const second = blankWorkbookSheet('2', 'Second'); second.cells.push({ row: 0, column: 0, kind: 'number', value: 17 });
  const f = createWorkbookBirthFixture('1', 100, [second]);
  const started = gate(), remote = gate(), beforeStore = gate(), allowBefore = gate(), afterStore = gate(), allowAfter = gate();
  const firstTarget = structuredClone(f.source); firstTarget.sourceSha256 = 'b'.repeat(64); firstTarget.model.sheets[0]!.cells[0]!.value = 20;
  const finalTarget = structuredClone(firstTarget); finalTarget.sourceSha256 = 'c'.repeat(64); finalTarget.model.sheets = finalTarget.model.sheets.filter(sheet => sheet.id !== '2');
  let providerCheckpoint: (() => Promise<void>) | undefined;
  let writes = 0, beforeBlocked = false, afterBlocked = false, nativeRemoved = false;
  const afterAttempt: { value: WorkbookCheckpoint | null } = { value: null };
  const writer = new WorkbookWriter(f.source, f.book.save(), async (intent, checkpoint) => {
    writes++;
    if (writes === 1) { providerCheckpoint = checkpoint; started.resolve(); await remote.promise; return standInWorkbookResult(scope, intent, firstTarget, 'before-literal', 'after-literal'); }
    return standInWorkbookResult(scope, intent, finalTarget, 'after-literal', 'after-delete');
  }, () => {}, undefined, { scope, isCurrent: () => true,
    validate: state => { serializeWorkbookDraft(scope, state); },
    save: async state => {
      if (state) serializeWorkbookDraft(scope, state);
      if (!beforeBlocked && state?.sheetDeletions?.length && state.desired.sheets['2']) {
        beforeBlocked = true; beforeStore.resolve(); await allowBefore.promise;
      } else if (nativeRemoved && !afterBlocked) {
        afterBlocked = true; afterAttempt.value = state ? structuredClone(state) : null;
        afterStore.resolve(); await allowAfter.promise;
      }
    },
  });
  let saving: Promise<void> | undefined, protecting: Promise<void> | undefined, checkpointing: Promise<void> | undefined;
  try {
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(20); writer.update(f.book.save());
    saving = writer.flush(); await started.promise;
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19); writer.update(f.book.save());
    const context = captureWorkbookSourceDeletion(scope, writer.checkpoint(), '2');
    const after = f.book.save(); delete after.sheets['2']; after.sheetOrder = ['1'];
    protecting = writer.protectSheetDeletion(context, after, () => {
      expect(f.commands.syncExecuteCommand(RemoveSheetCommand.id, { unitId: f.book.getId(), subUnitId: '2' })).toBe(true);
      nativeRemoved = true;
      return f.book.save();
    });
    await beforeStore.promise;
    checkpointing = providerCheckpoint!(); // Queued while the durable precommand candidate is blocked.
    allowBefore.resolve();
    await afterStore.promise;
    expect(nativeRemoved).toBe(true);
    expect(afterAttempt.value?.sheetDeletions?.map(value => value.descriptor.token)).toEqual([context.descriptor.token]);
    expect(afterAttempt.value?.desired.sheets['2']).toBeUndefined();
    allowAfter.resolve(); await checkpointing; await protecting;
    remote.resolve(); await saving;
    expect(writer.state()).toEqual({ dirty: false, saving: false, error: null });
    expect(writes).toBe(2);
  } finally {
    allowBefore.resolve(); allowAfter.resolve(); remote.resolve();
    await protecting?.catch(() => {}); await checkpointing?.catch(() => {}); await saving?.catch(() => {});
    await writer.close(); f.univer.dispose();
  }
});

it('drains the latest owned branch after an earlier storage failure and close without writing into the next generation', async () => {
  const f = createWorkbookBirthFixture();
  const first = gate(), releaseFirst = gate(), second = gate(), releaseSecond = gate();
  const stored: Array<{ owner: string; value: unknown }> = [];
  let calls = 0, closed = false;
  const writer = new WorkbookWriter(f.source, f.book.save(), async () => { throw Error('No remote save is admitted'); }, () => {}, undefined, {
    scope, isCurrent: () => true, validate: value => { serializeWorkbookDraft(scope, value); },
    save: async value => {
      calls++;
      if (value) serializeWorkbookDraft(scope, value);
      if (calls === 1) { first.resolve(); await releaseFirst.promise; throw Error('First storage write failed'); }
      second.resolve(); await releaseSecond.promise;
      stored.push({ owner: scope.draftId, value: value?.desired.sheets['1']!.cellData?.[0]?.[0]?.v });
    },
  });
  let closing: Promise<void> | undefined;
  try {
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(17); writer.update(f.book.save());
    await first.promise;
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(20); writer.update(f.book.save());
    closing = writer.close().then(() => { closed = true; });
    f.book.getSheetBySheetId('1')!.getRange('A1').setValue(99); writer.update(f.book.save());
    releaseFirst.resolve(); await second.promise;
    expect(closed).toBe(false);
    expect(writer.checkpoint().desired.sheets['1']!.cellData?.[0]?.[0]?.v).toBe(20);
    releaseSecond.resolve(); await closing;
    expect(calls).toBe(2); // Queued storage callbacks were drained, not silently dropped.
    const nextScope = { ...scope, draftId: crypto.randomUUID() };
    const next = new WorkbookWriter(f.source, f.initial, async () => { throw Error('No remote save is admitted'); }, () => {}, undefined, {
      scope: nextScope, isCurrent: () => true, save: async value => {
        if (value) serializeWorkbookDraft(nextScope, value);
        stored.push({ owner: nextScope.draftId, value: value?.desired.sheets['1']!.cellData?.[0]?.[0]?.v });
      },
    });
    try {
      const latest = structuredClone(f.initial); latest.sheets['1']!.cellData![0]![0]!.v = 30;
      next.update(latest); await next.close();
      writer.update(latest);
      expect(stored).toEqual([{ owner: scope.draftId, value: 20 }, { owner: nextScope.draftId, value: 30 }]);
    } finally { await next.close(); }
  } finally {
    releaseFirst.resolve(); releaseSecond.resolve(); await closing; await writer.close(); f.univer.dispose();
  }
});
