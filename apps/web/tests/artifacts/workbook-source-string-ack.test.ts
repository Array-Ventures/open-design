import { CellValueType, type IWorkbookData } from '@univerjs/core';
import { ERROR_TYPE_SET } from '@univerjs/engine-formula';
import { expect, it } from 'vitest';
import { createWorkbookBirthFixture } from '../helpers/workbook-birth-fixture';
import { gridWorkbook } from '../../src/components/embedded/workbook/grid-model';
import { assertWorkbookSourceSnapshotInputs } from '../../src/components/embedded/workbook/source-snapshot-inputs';
import { workbookCalculationInputSha256 } from '../../src/components/embedded/workbook/formula-input-provenance';

it('accepts saved plain text after a real SDK edit without changing the live type or native Undo history', async () => {
  const f = createWorkbookBirthFixture();
  try {
    f.book.getActiveSheet().getRange('A1').setValue('19K');
    const acknowledged = f.book.save();
    const savedModel = structuredClone(f.source.model);
    savedModel.sheets[0]!.cells[0] = { row: 0, column: 0, kind: 'string', value: '19K' };
    const imported = gridWorkbook(savedModel, acknowledged.id, 'Workbook').data as IWorkbookData;
    expect(acknowledged.sheets['1']!.cellData![0]![0]).toMatchObject({ v: '19K', t: CellValueType.STRING });
    expect(imported.sheets['1']!.cellData![0]![0]).toMatchObject({ v: '19K', t: CellValueType.FORCE_STRING });
    const checkpoint = f.history.getUndoRedoCheckpoint();
    expect(() => assertWorkbookSourceSnapshotInputs(imported, acknowledged, acknowledged.id)).not.toThrow();
    expect(f.book.save()).toEqual(acknowledged);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(checkpoint);
    // Calculation epoch/digest ownership remains exact; only saved-source
    // equivalence accepts this proved plain-string representation difference.
    expect(workbookCalculationInputSha256(imported)).not.toBe(workbookCalculationInputSha256(acknowledged));
    await f.api.undo();
    expect(f.book.getActiveSheet().getRange('A1').getValue()).toBe(12);
  } finally {
    f.univer.dispose();
  }
});

it.each([...ERROR_TYPE_SET])('keeps SDK forced-literal versus error semantics distinct for %s', value => {
  const f = createWorkbookBirthFixture();
  try {
    const original = f.book.save();
    original.sheets['1']!.cellData![0]![0] = { v: value, t: CellValueType.FORCE_STRING };
    const acknowledged = structuredClone(original);
    acknowledged.sheets['1']!.cellData![0]![0]!.t = CellValueType.STRING;
    expect(() => assertWorkbookSourceSnapshotInputs(original, acknowledged, original.id)).toThrow('Saved source inputs');
  } finally { f.univer.dispose(); }
});

it.each(['value', 'formula', 'rich', 'number'] as const)('does not normalize changed %s inputs', kind => {
  const f = createWorkbookBirthFixture();
  try {
    const original = f.book.save();
    original.sheets['1']!.cellData![0]![0] = { v: '19K', t: CellValueType.FORCE_STRING };
    const acknowledged = structuredClone(original);
    const cell = acknowledged.sheets['1']!.cellData![0]![0]!;
    cell.t = CellValueType.STRING;
    if (kind === 'value') cell.v = '20K';
    if (kind === 'formula') cell.f = '=19';
    if (kind === 'number') { cell.v = 19; cell.t = CellValueType.NUMBER; }
    if (kind === 'rich') cell.p = { id: 'owned-rich-negative', documentStyle: {}, body: { dataStream: '19K\r\n', textRuns: [{ st: 0, ed: 3, ts: { bl: 1 } }] } };
    expect(() => assertWorkbookSourceSnapshotInputs(original, acknowledged, original.id)).toThrow('Saved source inputs');
  } finally { f.univer.dispose(); }
});
