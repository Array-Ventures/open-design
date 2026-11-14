import { afterEach, expect, it, vi } from 'vitest';
import { workbookDocumentSchema } from '@open-design/contracts/runtime/workbook';
import { SetFormulaCalculationStartMutation } from '@univerjs/engine-formula';
import { NodeWorkbookWorker } from '../helpers/workbook-node-worker';
import { createWorkbookMembershipRpcFixture } from '../helpers/workbook-membership-rpc-fixture';
afterEach(() => vi.unstubAllGlobals());
it('settles a real worker epoch after renaming an unused empty born sheet on the browser two-formula source', async () => {
  vi.stubGlobal('Worker', NodeWorkbookWorker);
  const model = workbookDocumentSchema.parse((await import('../fixtures/workbook-browser-membership-model.json')).default);
  const f = await createWorkbookMembershipRpcFixture(true, 100, 12, false, model);
  const starts: unknown[] = [];
  const observer = f.commands.onCommandExecuted(command => { if (command.id === SetFormulaCalculationStartMutation.id) starts.push(structuredClone(command.params)); });
  try {
    const born = await f.controller.add('Unused', 2); await expect(f.calculation.awaitQuiescent()).resolves.toBeUndefined();
    const initialStarts = starts.length;
    await f.controller.rename(born.descriptor.sheetId, 'Renamed Unused');
    expect(f.book.save().sheets[born.descriptor.sheetId]!.name).toBe('Renamed Unused');
    await expect(f.calculation.awaitQuiescent()).resolves.toBeUndefined();
    expect(starts.length).toBeGreaterThan(initialStarts);
    expect(f.owner.ready).toBe(true);
    expect(f.book.save().sheets['1']!.cellData![2]![2]!.v).toBe(12);
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(12);
    await f.api.undo(); await expect(f.calculation.awaitQuiescent()).resolves.toBeUndefined();
    expect(f.book.save().sheets[born.descriptor.sheetId]!.name).toBe('Unused');
    await f.api.redo(); await expect(f.calculation.awaitQuiescent()).resolves.toBeUndefined();
    expect(f.book.save().sheets[born.descriptor.sheetId]!.name).toBe('Renamed Unused');
    await f.controller.rename('1', 'SourceData'); await expect(f.calculation.awaitQuiescent()).resolves.toBeUndefined();
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.f).toContain('SourceData');
    expect(f.book.save().sheets['2']!.cellData![0]![0]!.v).toBe(12);
    expect(f.owner.ready).toBe(true);
  } finally { observer.dispose(); await f.close(); }
}, 15_000);
