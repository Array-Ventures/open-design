import { expect, it } from 'vitest';
import { workbookCleanResumeSnapshotIdentity } from '../../src/components/embedded/workbook/clean-resume-snapshot';
import { createSourceDeleteHistoryFixture } from '../helpers/workbook-source-delete-fixture';

it('compares actual SDK snapshots modulo only formula cache value/type, retaining every authored owner', async () => {
  const f = createSourceDeleteHistoryFixture(false);
  try {
    const original = f.book.save();
    const identity = workbookCleanResumeSnapshotIdentity(original);
    const cache = structuredClone(original);
    cache.sheets['3']!.cellData![1]![0]!.v = 999;
    cache.sheets['3']!.cellData![1]![0]!.t = 1;
    expect(workbookCleanResumeSnapshotIdentity(cache)).toBe(identity);
    const mutations: Array<(snapshot: typeof original) => void> = [
      value => { value.sheets['3']!.cellData![1]![0]!.f = '=1'; },
      value => { value.sheets['3']!.cellData![1]![0]!.si = 'different-formula-owner'; },
      value => { value.sheets['3']!.cellData![1]![0]!.p = { id: 'rich-document', documentStyle: {}, body: { dataStream: 'rich\r\n' } }; },
      value => { value.sheets['3']!.cellData![1]![0]!.s = 'other-style'; },
      value => { value.sheets['1']!.cellData![0]![0]!.v = 999; },
      value => { value.sheets['1']!.rowCount! += 1; },
      value => { value.sheets['1']!.name = 'Renamed'; },
      value => { value.sheetOrder.reverse(); },
      value => { value.custom = { otherOwner: true }; },
      value => { value.sheets['1']!.scrollTop = 17; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(cache); mutate(changed);
      expect(workbookCleanResumeSnapshotIdentity(changed)).not.toBe(identity);
    }
    expect(f.book.save()).toEqual(original);
  } finally { await f.close(); }
});
