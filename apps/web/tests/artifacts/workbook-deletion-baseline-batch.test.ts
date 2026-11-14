import { expect, it, vi } from 'vitest';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import { captureWorkbookDeletionBaseline, captureWorkbookDeletionBaselines } from '../../src/components/embedded/workbook/sheet-delete-context';
import * as gridModel from '../../src/components/embedded/workbook/grid-model';

it('qualifies one actual complete source projection and returns independent selected-only baseline contexts', () => {
  const second = blankWorkbookSheet('2', 'Second'); second.cells.push({ row: 0, column: 0, kind: 'number', value: 17 });
  const f = createWorkbookBirthFixture('1', 100, [second]);
  const project = vi.spyOn(gridModel, 'gridWorkbook');
  try {
    const acknowledged = f.book.save();
    const original = JSON.stringify({ source: f.source, acknowledged });
    const contexts = captureWorkbookDeletionBaselines(scope, f.source, acknowledged, [{ sheetId: '1' }, { sheetId: '2' }, { sheetId: '2' }]);
    expect(project).toHaveBeenCalledTimes(1); // One full-workbook projection, not one per selected result.
    expect(contexts.map(value => value.baseline.sheet.cells[0]?.value)).toEqual([12, 17, 17]);
    expect(new Set(contexts.map(value => value.descriptor.token)).size).toBe(3);
    expect(contexts.every(value => !('source' in value) && value.removedSheet === undefined)).toBe(true);
    contexts[1]!.acknowledgedSheet.cellData![0]![0]!.v = 99;
    expect(contexts[2]!.acknowledgedSheet.cellData![0]![0]!.v).toBe(17);
    expect(JSON.stringify({ source: f.source, acknowledged })).toBe(original);
  } finally { project.mockRestore(); f.univer.dispose(); }
});

it('keeps single capture equivalent to the batch and preserves complete-model ownership guards', () => {
  const f = createWorkbookBirthFixture();
  try {
    const acknowledged = f.book.save();
    const single = captureWorkbookDeletionBaseline(scope, f.source, acknowledged, '1');
    expect(captureWorkbookDeletionBaselines(scope, f.source, acknowledged, [{ sheetId: '1', descriptor: single.descriptor }])).toEqual([single]);
    for (const change of [
      () => captureWorkbookDeletionBaselines(scope, f.source, acknowledged, []),
      () => captureWorkbookDeletionBaselines(scope, f.source, acknowledged, Array.from({ length: 4097 }, () => ({ sheetId: '1' }))),
      () => captureWorkbookDeletionBaselines(scope, f.source, acknowledged, [{ sheetId: '2' }]),
      () => captureWorkbookDeletionBaselines(scope, f.source, acknowledged, [{ sheetId: '1', descriptor: { ...single.descriptor, generation: crypto.randomUUID() } }]),
      () => captureWorkbookDeletionBaselines({ ...scope, projectId: crypto.randomUUID() }, f.source, acknowledged, [{ sheetId: '1' }]),
    ]) expect(change).toThrow();
    const changed = structuredClone(acknowledged); changed.sheets['1']!.cellData![0]![0]!.v = 20;
    expect(() => captureWorkbookDeletionBaselines(scope, f.source, changed, [{ sheetId: '1' }])).toThrow();
    const unqualified = structuredClone(f.source); delete unqualified.model.worksheetMembershipEditable;
    expect(() => captureWorkbookDeletionBaselines(scope, unqualified, acknowledged, [{ sheetId: '1' }])).toThrow('qualified');
  } finally { f.univer.dispose(); }
});
