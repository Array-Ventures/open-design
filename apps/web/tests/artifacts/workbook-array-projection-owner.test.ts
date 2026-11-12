import { afterEach, expect, it, vi } from 'vitest';
import type { IWorkbookData } from '@univerjs/core';
import { ownArrayProjectionWorker } from '../../src/components/embedded/workbook/array-projection-owner';
import { workbookCalculationInputSha256 } from '../../src/components/embedded/workbook/formula-input-provenance';
const sourceSha256 = 'a'.repeat(64);
const snapshot = { id: 'unit', name: 'Workbook', appVersion: '1.4.0', locale: 'enUS' as IWorkbookData['locale'], styles: {}, sheetOrder: ['sheet'], sheets: { sheet: { id: 'sheet', name: 'Sheet', rowCount: 100, columnCount: 20, cellData: { 0: { 0: { v: 3, t: 2 } } } } } } as IWorkbookData;
class FakeWorker {
  listeners = new Map<string, Set<(event: never) => void>>(); messages: unknown[] = []; terminate = vi.fn();
  postMessage(value: unknown) { this.messages.push(structuredClone(value)); }
  addEventListener(type: string, listener: (event: never) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type: string, listener: (event: never) => void) { this.listeners.get(type)?.delete(listener); }
  emit(data: unknown) { for (const listener of this.listeners.get('message') ?? []) listener({ data } as never); }
}
function setup() { const worker = new FakeWorker(), unavailable = vi.fn(), owner = ownArrayProjectionWorker({} as never, 'unit', sourceSha256, unavailable, () => worker as unknown as Worker); worker.emit({ type: 'studio:workbook-array-projection', kind: 'ready' }); return { worker, unavailable, owner }; }
function result(generation: number, overrides = {}) { return { type: 'studio:workbook-array-projection', kind: 'result', projection: { sourceSha256, workbookCalculation: { version: 1, unitId: 'unit', inputSha256: workbookCalculationInputSha256(snapshot), generation, valid: true }, owners: [], cells: { sheet: { 1: { 0: { kind: 'number', value: 4 } } } }, stored: [], unavailable: [], ...overrides } }; }
afterEach(() => vi.useRealTimers());
it('publishes only the matching complete generation without changing authored input', async () => {
 const { owner, worker } = setup(), seen = vi.fn(), before = structuredClone(snapshot); owner.onResult(seen); expect(await owner.loaded).toBe(true);
 owner.calculate(snapshot); owner.calculate(snapshot); worker.emit(result(1)); expect(seen).not.toHaveBeenCalled(); worker.emit(result(2)); expect(seen).toHaveBeenCalledTimes(1); expect(snapshot).toEqual(before); worker.emit(result(2)); expect(seen).toHaveBeenCalledTimes(1); owner.dispose();
});
it.each(['source', 'input', 'invalid'])('fails closed for %s provenance mismatch', mode => {
 const { owner, worker, unavailable } = setup(); owner.calculate(snapshot); const message = result(1);
 if (mode === 'source') message.projection.sourceSha256 = 'b'.repeat(64); else if (mode === 'input') message.projection.workbookCalculation.inputSha256 = 'b'.repeat(64); else message.projection.workbookCalculation.valid = false;
 worker.emit(message); expect(unavailable).toHaveBeenCalledTimes(1); expect(worker.terminate).toHaveBeenCalledTimes(1); expect(owner.calculate(snapshot)).toBeNull(); owner.dispose();
});
it('terminates a timed-out worker and fences results after disposal/source refresh', () => {
 vi.useFakeTimers(); const { owner, worker, unavailable } = setup(), seen = vi.fn(); owner.onResult(seen); owner.calculate(snapshot); vi.advanceTimersByTime(5001); worker.emit(result(1)); expect(seen).not.toHaveBeenCalled(); expect(unavailable).toHaveBeenCalledTimes(1); owner.dispose();
 const next = setup(); next.owner.onResult(seen); next.owner.calculate(snapshot); next.owner.dispose(); next.worker.emit(result(1)); expect(seen).not.toHaveBeenCalled(); expect(next.unavailable).not.toHaveBeenCalled(); expect(next.worker.terminate).toHaveBeenCalledTimes(1);
});
