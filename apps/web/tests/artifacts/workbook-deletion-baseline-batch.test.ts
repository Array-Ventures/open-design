import { expect, it, vi } from 'vitest';
// Contract entry bundles inline separate schema instances. Bind their actual
// source modules in this file so the spy counts every full parse, not just the
// grid entry's schema instance. No implementation is substituted.
vi.mock('@open-design/contracts/runtime/workbook', () => import('../../../../packages/contracts/src/runtime/workbook'));
vi.mock('@open-design/contracts/runtime/workbook-sheet-baseline', () => import('../../../../packages/contracts/src/runtime/workbook-sheet-baseline'));
import { withWorkbookSheetBaselines } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { workbookDocumentSchema } from '@open-design/contracts/runtime/workbook';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { blankWorkbookSheet } from '../../src/components/embedded/workbook/sheet-birth-context';
import { captureWorkbookDeletionBaseline, captureWorkbookDeletionBaselines } from '../../src/components/embedded/workbook/sheet-delete-context';
import * as gridModel from '../../src/components/embedded/workbook/grid-model';

it('qualifies one actual complete source projection and returns independent selected-only baseline contexts', () => {
  const second = blankWorkbookSheet('2', 'Second'); second.cells.push({ row: 0, column: 0, kind: 'number', value: 17 });
  const f = createWorkbookBirthFixture('1', 100, [second]);
  const project = vi.spyOn(gridModel, 'gridWorkbookFromValidatedModel');
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

it('strictly qualifies the full source once and does not reread unselected cells for duplicate requests', () => {
  const second = blankWorkbookSheet('2', 'Unselected');
  second.rowCount = 4096; second.columnCount = 1;
  second.cells = Array.from({ length: 4096 }, (_, row) => ({ row, column: 0, kind: 'number', value: row }));
  const f = createWorkbookBirthFixture('1', 100, [second]);
  let unselectedDescriptorReads = 0;
  const cells = f.source.model.sheets[1]!.cells;
  // Getter-free instrumentation of the original full JSON-domain traversal.
  // This is operation counting, not a timing or Proxy-security assertion.
  f.source.model.sheets[1]!.cells = new Proxy(cells, {
    getOwnPropertyDescriptor(target, key) {
      if (key === '0') unselectedDescriptorReads++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const parse = vi.spyOn(workbookDocumentSchema, 'parse');
  try {
    const result = captureWorkbookDeletionBaselines(scope, f.source, f.book.save(), Array.from({ length: 32 }, () => ({ sheetId: '1' })));
    expect(result).toHaveLength(32);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(unselectedDescriptorReads).toBe(1);
    expect(result.every(value => value.baseline.sheet.id === '1' && value.baseline.sheet.cells.length === 1)).toBe(true);
    result[0]!.baseline.sheet.cells[0]!.value = 99;
    expect(result[1]!.baseline.sheet.cells[0]!.value).toBe(12);
  } finally { parse.mockRestore(); f.univer.dispose(); }
});

it('keeps the parsed source and input immutable when the pure display output is edited', () => {
  const f = createWorkbookBirthFixture(), before = structuredClone(f.source.model);
  try {
    withWorkbookSheetBaselines(f.source.model, ['1'], parsed => {
      const original = structuredClone(parsed);
      const projection = gridModel.gridWorkbookFromValidatedModel(parsed, `${scope.projectId}:${scope.fileName}`, 'Workbook');
      expect(parsed).toEqual(original);
      projection.data.sheets!['1']!.cellData![0]![0]!.v = 99;
      projection.data.styles!['0'] = { fs: 99 };
      expect(parsed).toEqual(original);
    });
    expect(f.source.model).toEqual(before);
    const bad = structuredClone(before); bad.sheets[0]!.cells[0]!.row = 100;
    expect(() => gridModel.gridWorkbook(bad, 'bad', 'Workbook')).toThrow();
  } finally { f.univer.dispose(); }
});
