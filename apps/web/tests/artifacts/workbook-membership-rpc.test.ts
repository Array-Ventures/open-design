import { afterEach, expect, it, vi } from 'vitest';
import { SetRangeValuesMutation, RemoveSheetMutation } from '@univerjs/sheets';
import { NodeWorkbookWorker } from '../helpers/workbook-node-worker';
import { createWorkbookMembershipRpcFixture } from '../helpers/workbook-membership-rpc-fixture';
import { WORKBOOK_MEMBERSHIP_OPTION } from '../../src/components/embedded/workbook/sheet-calculation-permit';
afterEach(() => vi.unstubAllGlobals());

it('preserves source17/removed19/survivor21 through real RPC Delete/#REF, Undo/fresh40 and Redo/#REF', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    await vi.waitFor(() => expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(40), { timeout: 5000 });
    await f.controller.remove('2');
    expect(f.writer.checkpoint().sheetDeletions![0]!.baseline.sheet.cells[0]!.value).toBe(17);
    expect(f.writer.checkpoint().sheetDeletions![0]!.removedSheet!.cellData![0]![0]!.v).toBe(19);
    await vi.waitFor(() => expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe('#REF!'), { timeout: 5000 });
    expect(f.owner.ready).toBe(true);
    await f.api.undo();
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(19);
    expect(f.book.save().sheets['1']!.cellData![0]![0]!.v).toBe(21);
    await vi.waitFor(() => expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(40), { timeout: 5000 });
    await f.api.redo();
    await vi.waitFor(() => expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe('#REF!'), { timeout: 5000 });
    expect(f.owner.ready).toBe(true); expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await f.close(); }
}, 20_000);

it('does not promote computed values or wrong-cell normalization during or after an owned sequence', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  let injected = false;
  const observer = f.commands.onCommandExecuted(command => {
    if (command.id !== RemoveSheetMutation.id || injected) return;
    injected = true;
    f.commands.syncExecuteCommand(SetRangeValuesMutation.id, { unitId: f.book.getId(), subUnitId: '3', cellValue: { 1: { 0: { f: "=#REF!+'Sheet 1'!A1", si: null, v: 999, t: 2 } }, 2: { 0: { f: '=999', v: null, t: null } } } }, { onlyLocal: true, fromFormula: true });
  });
  try {
    await f.controller.remove('2');
    await vi.waitFor(() => expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe('#REF!'), { timeout: 5000 });
    expect(injected).toBe(true); expect(f.book.save().sheets['3']!.cellData![2]?.[0]).toBeUndefined();
    f.commands.syncExecuteCommand(SetRangeValuesMutation.id, { unitId: f.book.getId(), subUnitId: '3', cellValue: { 1: { 0: { f: "=#REF!+'Sheet 1'!A1", si: null, v: null, t: null } } } }, { onlyLocal: true, fromFormula: true });
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe('#REF!');
    expect(f.owner.ready).toBe(true); expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { observer.dispose(); await f.close(); }
}, 15_000);

function alterPermits(raw: unknown, change: (permit: Record<string, unknown>) => void) {
  if (!raw || typeof raw !== 'object') return;
  const record = raw as Record<string, unknown>;
  if (typeof record[WORKBOOK_MEMBERSHIP_OPTION] === 'string') {
    const permit = JSON.parse(record[WORKBOOK_MEMBERSHIP_OPTION] as string) as Record<string, unknown>;
    change(permit); record[WORKBOOK_MEMBERSHIP_OPTION] = JSON.stringify(permit);
  }
  for (const child of Object.values(record)) alterPermits(child, change);
}
it.each(['capability', 'unit', 'kernel', 'epoch', 'after-count'] as const)('withdraws the actual worker for a tampered %s RPC proof', async attack => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  let changed = 0;
  f.worker.intercept = message => alterPermits(message, permit => {
    changed++;
    if (attack === 'capability') permit.sourceCapability = 'f'.repeat(64);
    else if (attack === 'unit') permit.unitId = 'another-kernel';
    else if (attack === 'kernel') permit.kernelGeneration = crypto.randomUUID();
    else if (attack === 'epoch') permit.inputEpoch = Number(permit.inputEpoch) + 1;
    else permit.count = 1; // second input's index1 must not extend a completed count1 sequence
  });
  try {
    await f.controller.remove('2');
    await vi.waitFor(() => expect(f.failed || f.book.save().sheets['3']!.cellData![1]![0]!.v === '#REF!').toBe(true), { timeout: 5000 });
    expect(changed).toBeGreaterThan(0); expect(f.failed).toBe(true); expect(f.owner.ready).toBe(false);
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).not.toBe('#REF!');
  } finally { await f.close(); }
}, 15_000);

it('keeps formula-free save admission pending for the latest real worker ACK while allowing queued native Undo/Redo', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(false);
  const held: unknown[] = [];
  let holding = true;
  f.worker.acceptIncoming = message => {
    if (holding && (message as { kind?: string })?.kind === 'membership-applied') { if (!held.includes(message)) held.push(message); return false; }
    return true;
  };
  try {
    await f.controller.remove('2');
    let settled = false;
    const wait = f.calculation.awaitMembership().then(() => { settled = true; }); void wait.catch(() => {});
    await f.api.undo(); await f.api.redo();
    await vi.waitFor(() => expect(held).toHaveLength(3), { timeout: 5000 });
    expect(settled).toBe(false); expect(f.owner.ready).toBe(true);
    holding = false;
    f.worker.thread.emit('message', held[0]); f.worker.thread.emit('message', held[1]);
    await Promise.resolve(); expect(settled).toBe(false);
    f.worker.thread.emit('message', held[2]);
    await wait;
    expect(settled).toBe(true); expect(f.owner.ready).toBe(true);
    expect(f.book.save().sheets['2']).toBeUndefined();
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
    f.worker.thread.emit('message', held[0]); // late older ACK cannot alter a settled owner
    expect(f.owner.ready).toBe(true);
  } finally { await f.close(); }
}, 15_000);

it('requires both fresh scalar calculation and the exact applied ACK without promoting either into the other', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  const held: unknown[] = [];
  let holding = true;
  f.worker.acceptIncoming = message => {
    if (holding && (message as { kind?: string })?.kind === 'membership-applied') { if (!held.includes(message)) held.push(message); return false; }
    return true;
  };
  try {
    await f.controller.remove('2');
    let settled = false;
    const wait = f.calculation.awaitMembership().then(() => { settled = true; }); void wait.catch(() => {});
    await vi.waitFor(() => expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe('#REF!'), { timeout: 5000 });
    expect(held).toHaveLength(1); expect(settled).toBe(false);
    holding = false; f.worker.thread.emit('message', held[0]); await wait;
    expect(settled).toBe(true); expect(f.owner.ready).toBe(true);
  } finally { await f.close(); }
}, 15_000);

it('cancels only its no-formula wait, retaining the real applied ACK requirement for a later waiter', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(false);
  const held: unknown[] = [];
  let holding = true;
  f.worker.acceptIncoming = message => {
    if (holding && (message as { kind?: string })?.kind === 'membership-applied') { if (!held.includes(message)) held.push(message); return false; }
    return true;
  };
  try {
    await f.controller.remove('2');
    const abort = new AbortController(), cancelled = f.calculation.awaitMembership(abort.signal);
    void cancelled.catch(() => {}); abort.abort();
    await expect(cancelled).rejects.toThrow('cancelled');
    let settled = false;
    const wait = f.calculation.awaitMembership().then(() => { settled = true; }); void wait.catch(() => {});
    await vi.waitFor(() => expect(held).toHaveLength(1), { timeout: 5000 });
    expect(settled).toBe(false); expect(f.owner.ready).toBe(true);
    holding = false; f.worker.thread.emit('message', held[0]); await wait;
    expect(settled).toBe(true); expect(f.owner.ready).toBe(true);
  } finally { await f.close(); }
}, 15_000);

it('uses real RPC Add/Undo/Redo with immutable blank birth data and surviving fresh scalar results', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  try {
    const birth = await f.controller.add('Extra', 3), id = birth.descriptor.sheetId;
    await f.calculation.awaitMembership();
    expect(f.book.save().sheetOrder).toEqual(['1', '2', '3', id]);
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(38);
    f.book.getSheetBySheetId(id)!.getRange('A1').setValue(7);
    await f.api.undo(); // actual ordinary cell Undo before native Add Undo
    expect(f.book.save().sheets[id]!.cellData?.[0]?.[0]?.v ?? null).toBeNull();
    await f.api.undo(); await f.calculation.awaitMembership();
    expect(f.book.save().sheets[id]).toBeUndefined();
    await f.api.redo(); await f.calculation.awaitMembership();
    expect(f.book.save().sheets[id]!.cellData?.[0]?.[0]?.v ?? null).toBeNull();
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(38);
    expect(f.owner.ready).toBe(true); expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await f.close(); }
}, 20_000);

it('refuses over-budget Add before any SDK mutation, history push or protected context is published', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(false, 3600); //98,800 existing cells of geometry
  try {
    const before = f.book.save(), history = f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint();
    await expect(f.controller.add('Too large', 3)).rejects.toThrow(/budget|geometry|dimensions/);
    expect(f.book.save()).toEqual(before);
    expect(f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint()).toEqual(history);
    expect(f.writer.checkpoint().sheetBirths).toBeUndefined(); expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
    expect(f.owner.ready).toBe(true);
  } finally { await f.close(); }
}, 15_000);

it('drains ordinary scalar results before capturing a clean History snapshot', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  const held: unknown[] = [];
  let holding = true;
  f.worker.acceptIncoming = message => { if (holding) { if (!held.includes(message)) held.push(message); return false; } return true; };
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 5000 });
    let settled = false;
    const idle = f.calculation.awaitQuiescent().then(() => { settled = true; }); void idle.catch(() => {});
    await Promise.resolve();
    expect(settled).toBe(false);
    holding = false;
    for (const message of held) f.worker.thread.emit('message', message);
    await idle;
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(40);
    expect(f.owner.ready).toBe(true);
  } finally { await f.close(); }
}, 15_000);

it('keeps membership completion pending until its actual derived cache mutation is applied', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  const held: unknown[] = [];
  let holding = true;
  const contains = (value: unknown, target: unknown): boolean => value === target || Boolean(value && typeof value === 'object' && Object.values(value).some(child => contains(child, target)));
  f.worker.acceptIncoming = message => {
    if (holding && contains(message, SetRangeValuesMutation.id)) { if (!held.includes(message)) held.push(message); return false; }
    return true;
  };
  try {
    await f.controller.remove('2');
    let settled = false;
    const applied = f.calculation.awaitMembership().then(() => { settled = true; }); void applied.catch(() => {});
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 5000 });
    await Promise.resolve();
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).not.toBe('#REF!');
    expect(settled).toBe(false);
    holding = false;
    for (const message of held) f.worker.thread.emit('message', message);
    await applied;
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe('#REF!');
    expect(f.owner.ready).toBe(true);
  } finally { await f.close(); }
}, 15_000);

it('refuses completion when a later public listener changes an admitted derived cache payload', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  let changed = false;
  const later = f.commands.beforeCommandExecuted((command, options) => {
    if (command.id !== SetRangeValuesMutation.id || !options?.applyFormulaCalculationResult) return;
    const params = command.params as { subUnitId: string; cellValue: Record<string, Record<string, { v?: unknown; t?: number }>> };
    if (params.subUnitId !== '3') return;
    for (const row of Object.values(params.cellValue)) for (const cell of Object.values(row)) { cell.v = 999; cell.t = 2; changed = true; }
  });
  try {
    await f.controller.remove('2');
    let settled = false;
    const applied = f.calculation.awaitMembership().then(() => { settled = true; });
    void applied.catch(() => {});
    await vi.waitFor(() => expect(changed).toBe(true), { timeout: 5000 });
    expect(settled).toBe(false);
    expect(f.owner.ready).toBe(false);
    expect(f.calculation.status('3', 1, 0)?.result).not.toBe('calculated');
    await expect(applied).rejects.toThrow('unavailable');
    expect(f.owner.ready).toBe(false);
    expect(f.writer.checkpoint().source.sourceSha256).toBe('a'.repeat(64));
  } finally { later.dispose(); await f.close(); }
}, 15_000);

it.each([false, true])('strips a changed reverse RPC cache vector before SDK application or calculated promotion (paused=%s)', async paused => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  let changed = 0;
  let release: (() => void) | undefined;
  const alter = (raw: unknown): void => {
    if (!raw || typeof raw !== 'object') return;
    const value = raw as Record<string, unknown>;
    if (value.unitId === f.book.getId() && value.subUnitId === '3' && value.cellValue && value.sourceFormulaData && value.workbookCalculation) {
      for (const row of Object.values(value.cellValue as Record<string, Record<string, { v?: unknown; t?: number }>>)) {
        for (const cell of Object.values(row)) { cell.v = 999; cell.t = 2; }
      }
      changed++; return;
    }
    for (const child of Object.values(value)) alter(child);
  };
  f.worker.acceptIncoming = message => { if (!changed) alter(message); return true; };
  try {
    await f.controller.remove('2');
    if (paused) release = f.calculation.freezeAuthoring();
    const applied = f.calculation.awaitMembership(); void applied.catch(() => {});
    await vi.waitFor(() => expect(changed).toBe(1), { timeout: 5000 });
    expect(f.owner.ready).toBe(false);
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).not.toBe(999);
    expect(f.calculation.status('3', 1, 0)?.result).not.toBe('calculated');
    await expect(applied).rejects.toThrow('unavailable');
    expect(f.writer.checkpoint().source.sourceSha256).toBe('a'.repeat(64));
  } finally { release?.(); await f.close(); }
}, 15_000);

it('tracks an explicit epoch-stamped host calculation until its actual initial cache is refreshed', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(true, 100, 999);
  const { SetFormulaCalculationStartMutation } = await import('@univerjs/engine-formula');
  try {
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(999);
    await f.commands.executeCommand(SetFormulaCalculationStartMutation.id, { forceCalculation: true });
    await f.calculation.awaitQuiescent();
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(38);
    expect(f.calculation.status('3', 1, 0)?.result).toBe('calculated');
    expect(f.writer.checkpoint().source.model.sheets[2]!.cells[1]!.value).toBe(999);
    expect(f.owner.ready).toBe(true);
  } finally { await f.close(); }
}, 15_000);

it('keeps ordinary calculation pending until its held reverse cache application reaches the real workbook', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  const held: unknown[] = [];
  let holding = true;
  const contains = (value: unknown): boolean => value === SetRangeValuesMutation.id || Boolean(value && typeof value === 'object' && Object.values(value).some(contains));
  f.worker.acceptIncoming = message => { if (holding && contains(message)) { if (!held.includes(message)) held.push(message); return false; } return true; };
  try {
    f.book.getSheetBySheetId('2')!.getRange('A1').setValue(19);
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(38);
    expect(f.statuses.at(-1)?.phase).toBe('pending');
    let complete = false;
    const ready = f.calculation.awaitQuiescent().then(() => { complete = true; }); void ready.catch(() => {});
    await Promise.resolve(); expect(complete).toBe(false);
    holding = false; for (const message of held) f.worker.thread.emit('message', message);
    await ready;
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe(40);
    expect(f.statuses.at(-1)?.phase).toBe('live'); expect(f.owner.ready).toBe(true);
  } finally { await f.close(); }
}, 15_000);

it('freezes real cell/style/axis/membership inputs while admitting only its exact pending derived cache', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture();
  const held: unknown[] = [];
  let holding = true;
  f.worker.acceptIncoming = message => { if (holding) { if (!held.includes(message)) held.push(message); return false; } return true; };
  let release: (() => void) | undefined;
  try {
    await f.controller.remove('2');
    release = f.calculation.freezeAuthoring();
    const before = f.book.save();
    const native = f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint();
    expect(() => f.book.getSheetBySheetId('1')!.getRange('A1').setValue(999)).toThrow('paused');
    expect(() => f.commands.syncExecuteCommand(SetRangeValuesMutation.id, { unitId: f.book.getId(), subUnitId: '1', cellValue: { 0: { 0: { s: 'changed' } } } })).toThrow('paused');
    expect(() => f.commands.syncExecuteCommand('sheet.mutation.insert-row', { unitId: f.book.getId(), subUnitId: '1', range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 25 } })).toThrow('paused');
    expect(() => f.commands.syncExecuteCommand(RemoveSheetMutation.id, { unitId: f.book.getId(), subUnitId: '3' })).toThrow('paused');
    expect(f.book.save()).toEqual(before);
    expect(f.univer.__getInjector().get((await import('@univerjs/core')).IUndoRedoService).getUndoRedoCheckpoint()).toEqual(native);
    const idle = f.calculation.awaitQuiescent();
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 5000 });
    holding = false; for (const message of held) f.worker.thread.emit('message', message);
    await idle;
    expect(f.book.save().sheets['3']!.cellData![1]![0]!.v).toBe('#REF!');
    expect(f.calculation.quiescent).toBe(true); expect(f.owner.ready).toBe(true);
    release(); release = undefined;
  } finally { release?.(); await f.close(); }
}, 15_000);

it('normalizes real source-preserved and dependent caches before admitting a late paused application', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(true, 100, 999, true);
  const { SetFormulaCalculationStartMutation } = await import('@univerjs/engine-formula');
  let release: (() => void) | undefined;
  try {
    // This is a calculation-owner invariant, not sheet-action admission:
    // unsupported formulas deliberately withdraw membership capability.
    expect(f.model.worksheetMembershipEditable).toBe(false);
    expect(f.model.worksheetStructureEditable).toBe(false);
    expect(f.controller.isCurrent()).toBe(false);
    release = f.calculation.freezeAuthoring();
    await f.commands.executeCommand(SetFormulaCalculationStartMutation.id, { forceCalculation: true });
    await f.calculation.awaitQuiescent();
    const cells = f.book.save().sheets['3']!.cellData!;
    expect(cells[1]![0]!.v).toBe(38);
    expect(cells[2]![0]!.v).toBe(55); expect(cells[3]![0]!.v).toBe(56);
    expect(f.calculation.status('3', 2, 0)?.result).toBe('stored');
    expect(f.calculation.status('3', 3, 0)?.result).toBe('stored');
    expect(f.owner.ready).toBe(true);
    expect(f.writer.checkpoint().source.model.sheets[2]!.cells[1]!.value).toBe(999);
  } finally { release?.(); await f.close(); }
}, 15_000);


it('keeps the worker healthy after first Add on the actual browser rich/SUM-range source model', async () => {
  const { workbookDocumentSchema } = await import('@open-design/contracts/runtime/workbook');
  const raw = await import('../fixtures/workbook-browser-membership-model.json');
  const model = workbookDocumentSchema.parse(raw.default);
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(true, 100, 12, false, model);
  try {
    const born = await f.controller.add('Research', 2);
    await f.calculation.awaitQuiescent();
    expect(f.owner.ready).toBe(true);
    expect(f.book.save().sheetOrder).toEqual(['1', '2', born.descriptor.sheetId]);
    expect(f.book.save().sheets['1']!.cellData![2]![2]!.v).toBe(12);
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(12);
    await f.api.undo(); await f.calculation.awaitQuiescent();
    expect(f.book.save().sheetOrder).toEqual(['1', '2']);
    await f.api.redo(); await f.calculation.awaitQuiescent();
    expect(f.book.save().sheets[born.descriptor.sheetId]!.cellData).toEqual({});
    expect(f.owner.ready).toBe(true);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
  } finally { await f.close(); }
}, 15_000);


it('holds two-sheet membership completion until the second actual cache application reaches the workbook', async () => {
  const { workbookDocumentSchema } = await import('@open-design/contracts/runtime/workbook');
  const model = workbookDocumentSchema.parse((await import('../fixtures/workbook-browser-membership-model.json')).default);
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(true, 100, 12, false, model);
  const held: unknown[] = [];
  let holding = true;
  f.worker.acceptIncoming = raw => {
    const packet = raw as { args?: [{ mutationInfo?: { id?: string; params?: { subUnitId?: string; workbookCalculation?: unknown } } }] };
    const mutation = packet.args?.[0]?.mutationInfo;
    if (holding && mutation?.id === SetRangeValuesMutation.id && mutation.params?.subUnitId === '2') {
      expect(mutation.params.workbookCalculation).toBeDefined();
      if (!held.includes(raw)) held.push(raw);
      return false;
    }
    return true;
  };
  try {
    f.book.getSheetBySheetId('1')!.getRange('B2').setValue(19);
    await f.controller.add('Research', 2);
    let complete = false;
    const ready = f.calculation.awaitQuiescent().then(() => { complete = true; }); void ready.catch(() => {});
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(f.book.save().sheets['1']!.cellData![2]![2]!.v).toBe(19);
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(12);
    expect(complete).toBe(false); expect(f.statuses.at(-1)?.phase).toBe('pending');
    holding = false; for (const packet of held) f.worker.thread.emit('message', packet);
    await ready;
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(19);
    expect(f.calculation.quiescent).toBe(true); expect(f.owner.ready).toBe(true);
    expect(f.writer.checkpoint().source.model.sheets[1]!.cells[0]!.value).toBe(12);
  } finally { await f.close(); }
}, 15_000);

it('refuses a changed second-sheet computed vector despite its otherwise valid real receipt tag', async () => {
  const { workbookDocumentSchema } = await import('@open-design/contracts/runtime/workbook');
  const model = workbookDocumentSchema.parse((await import('../fixtures/workbook-browser-membership-model.json')).default);
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(true, 100, 12, false, model);
  let changed = false;
  f.worker.acceptIncoming = raw => {
    const packet = raw as { args?: [{ mutationInfo?: { id?: string; params?: { subUnitId?: string; workbookCalculation?: unknown; cellValue?: Record<number, Record<number, { v?: unknown }>> } } }] };
    const mutation = packet.args?.[0]?.mutationInfo, params = mutation?.params;
    if (!changed && mutation?.id === SetRangeValuesMutation.id && params?.subUnitId === '2' && params.cellValue?.[0]?.[0]) {
      expect(params.workbookCalculation).toBeDefined();
      changed = true; params.cellValue[0][0].v = 999;
    }
    return true;
  };
  try {
    await f.controller.add('Research', 2);
    const ready = f.calculation.awaitQuiescent(); void ready.catch(() => {});
    await vi.waitFor(() => expect(changed).toBe(true), { timeout: 5000 });
    expect(f.owner.ready).toBe(false);
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).not.toBe(999);
    expect(f.calculation.status('2', 0, 0)?.result).not.toBe('calculated');
    await expect(ready).rejects.toThrow('unavailable');
  } finally { await f.close(); }
}, 15_000);

it.each(['omitted', 'wrong-formula', 'wrong-shared-id', 'invalid-receipt', 'stale-receipt'] as const)('rejects host-origin scalar output with %s identity before issuing worker provenance', async attack => {
  const { workbookDocumentSchema } = await import('@open-design/contracts/runtime/workbook');
  const model = workbookDocumentSchema.parse((await import('../fixtures/workbook-browser-membership-model.json')).default);
  const { IRemoteInstanceService } = await import('@univerjs/rpc');
  const { SetFormulaCalculationResultMutation } = await import('@univerjs/engine-formula');
  const { CommandType } = await import('@univerjs/core');
  const { workbookCalculationInputSha256 } = await import('../../src/components/embedded/workbook/formula-input-provenance');
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const f = await createWorkbookMembershipRpcFixture(true, 100, 12, false, model);
  const held: unknown[] = [];
  let receipt: { valid?: boolean; inputEpoch?: number } | undefined;
  f.worker.acceptIncoming = raw => {
    const packet = raw as { args?: [{ mutationInfo?: { id?: string; params?: { subUnitId?: string; workbookCalculation?: typeof receipt } } }] };
    const mutation = packet.args?.[0]?.mutationInfo;
    if (mutation?.id === SetFormulaCalculationResultMutation.id) receipt = mutation.params?.workbookCalculation;
    if (mutation?.id === SetRangeValuesMutation.id && mutation.params?.subUnitId === '2') {
      if (!held.includes(raw)) held.push(raw); return false;
    }
    return true;
  };
  try {
    await f.controller.add('Research', 2);
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(receipt?.valid).toBe(true); expect(receipt?.inputEpoch).toBe(f.calculation.inputEpoch);
    expect(f.calculation.quiescent).toBe(false);
    const before = f.book.save();
    const params = {
      unitData: { [f.book.getId()]: { '2': { 0: { 0: { v: attack === 'omitted' ? 12 : 999, t: 2 } } } } }, unitOtherData: {},
      ...(attack === 'wrong-formula' || attack === 'wrong-shared-id' ? { sourceFormulaData: { [f.book.getId()]: { '2': { 0: { 0: {
        f: attack === 'wrong-formula' ? '=999' : "='Rich cells'!B2", ...(attack === 'wrong-shared-id' ? { si: 'forged' } : {}),
      } } } } } } : {}),
      ...(attack === 'invalid-receipt' || attack === 'stale-receipt' ? { workbookCalculation: { version: 1, unitId: f.book.getId(),
        inputSha256: workbookCalculationInputSha256(before), generation: 1,
        inputEpoch: attack === 'stale-receipt' ? 0 : f.calculation.inputEpoch, valid: attack !== 'invalid-receipt' } } : {}),
    };
    const remote = f.univer.__getInjector().get(IRemoteInstanceService);
    // The pinned receiver overrides fromSync after restOptions, so the caller
    // cannot disguise host-origin output as a local engine completion.
    let accepted = false;
    // Terminal worker withdrawal may cancel the RPC channel before its error
    // reply arrives; the durable consumer contract is immediate withdrawal and
    // no accepted output, rather than a guaranteed transport rejection.
    void remote.syncMutation({ mutationInfo: { id: SetFormulaCalculationResultMutation.id, type: CommandType.MUTATION, params } }, { onlyLocal: true, fromSync: false }).then(value => { accepted = value === true; }, () => {});
    await vi.waitFor(() => expect(f.owner.ready).toBe(false), { timeout: 5000 });
    expect(accepted).toBe(false);
    expect(f.book.save()).toEqual(before);
    expect(f.writer.checkpoint().source.sourceSha256).toBe('a'.repeat(64));
  } finally { await f.close(); }
}, 15_000);
