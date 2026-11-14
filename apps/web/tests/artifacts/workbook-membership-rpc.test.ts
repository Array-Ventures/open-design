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
