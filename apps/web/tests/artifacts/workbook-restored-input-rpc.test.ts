import { afterEach, expect, it, vi } from 'vitest';
import { workbookDocumentSchema } from '@open-design/contracts/runtime/workbook';
import { SetRangeValuesMutation } from '@univerjs/sheets';
import { NodeWorkbookWorker } from '../helpers/workbook-node-worker';
import { createWorkbookMembershipRpcFixture } from '../helpers/workbook-membership-rpc-fixture';
afterEach(() => vi.unstubAllGlobals());
it('calculates genuinely restored dirty inputs before any authored mutation or source save', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const model = workbookDocumentSchema.parse((await import('../fixtures/workbook-browser-membership-model.json')).default);
  const source = structuredClone(model);
  const f = await createWorkbookMembershipRpcFixture(true, 100, 12, false, model, original => {
    original.sheets['1']!.cellData![1]![1]!.v = 13;
    return original;
  });
  f.book.setEditable(true);
  const held: unknown[] = []; let holding = true;
  f.worker.acceptIncoming = raw => {
    const packet = raw as { args?: [{ mutationInfo?: { id?: string; params?: { subUnitId?: string; workbookCalculation?: unknown } } }] };
    const mutation = packet.args?.[0]?.mutationInfo;
    if (holding && mutation?.id === SetRangeValuesMutation.id && mutation.params?.subUnitId === '2') {
      expect(mutation.params.workbookCalculation).toBeDefined(); if (!held.includes(raw)) held.push(raw); return false;
    }
    return true;
  };
  let authored = 0;
  const listener = f.commands.onCommandExecuted((command, options) => { if (command.id === SetRangeValuesMutation.id && !options?.fromFormula) authored++; });
  try {
    expect(f.book.save().sheets['1']!.cellData![1]![1]!.v).toBe(13);
    expect(f.book.save().sheets['1']!.cellData![2]![2]!.v).toBe(12);
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(12);
    expect(f.calculation.calculateRestoredInputs()).toBe(true);
    let settled = false;
    const idle = f.calculation.awaitQuiescent().then(() => { settled = true; }); void idle.catch(() => {});
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(f.book.save().sheets['1']!.cellData![2]![2]!.v).toBe(13);
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(12);
    expect(settled).toBe(false); expect(f.statuses.at(-1)?.phase).toBe('pending');
    holding = false; for (const packet of held) f.worker.thread.emit('message', packet);
    await idle;
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(13);
    expect(f.calculation.calculateRestoredInputs()).toBe(false);
    expect(authored).toBe(0); expect(f.owner.ready).toBe(true);
    expect(f.calculation.inputEpoch).toBe(0);
    expect(f.model).toEqual(source); expect(f.writer.checkpoint().source.model).toEqual(source);
    expect(f.initial.sheets['1']!.cellData![2]![2]!.v).toBe(12);
  } finally { listener.dispose(); await f.close(); }
}, 15_000);

it('refreshes qualified restored formulas while retaining source-owned unsupported and dependent caches', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const model = workbookDocumentSchema.parse((await import('../fixtures/workbook-browser-membership-model.json')).default);
  model.worksheetMembershipEditable = false; model.worksheetStructureEditable = false;
  model.sheets[0]!.cells.push({ row: 4, column: 0, kind: 'number', value: 55, formula: '=UNKNOWN(1)' }, { row: 5, column: 0, kind: 'number', value: 56, formula: '=A5+1' });
  const f = await createWorkbookMembershipRpcFixture(true, 100, 12, false, model, original => { original.sheets['1']!.cellData![1]![1]!.v = 13; return original; });
  f.book.setEditable(true);
  try {
    expect(f.calculation.calculateRestoredInputs()).toBe(true); await f.calculation.awaitQuiescent();
    const cells = f.book.save().sheets['1']!.cellData!;
    expect(cells[2]![2]!.v).toBe(13); expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(13);
    expect(cells[4]![0]!.v).toBe(55); expect(cells[5]![0]!.v).toBe(56);
    expect(f.calculation.status('1', 4, 0)?.result).toBe('stored'); expect(f.calculation.status('1', 5, 0)?.result).toBe('stored');
    expect(f.owner.ready).toBe(true); expect(f.writer.checkpoint().source.model).toEqual(model);
  } finally { await f.close(); }
}, 15_000);
