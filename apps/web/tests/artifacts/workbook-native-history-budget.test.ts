import { expect, it, vi } from 'vitest';
import * as budget from '../../src/components/embedded/workbook/native-history-budget';
import { MAX_WORKBOOK_DRAFT_BYTES, MAX_WORKBOOK_SHEET_CONTEXTS } from '../../src/components/embedded/workbook/workbook-draft-limits';
import { createSourceDeleteHistoryFixture as fixture } from '../helpers/workbook-source-delete-fixture';

it('charges each fresh issuer using canonical UTF8 bytes and the existing exact byte boundary without credits or eviction', () => {
  const data = { value: 'é', ignored: undefined, zero: -0 };
  const charge = new TextEncoder().encode('{"value":"é","zero":0}').byteLength + 1;
  expect(budget.admitWorkbookNativeIssuer(0, 2, data)).toEqual({ charge, total: charge + 2 });
  expect(budget.admitWorkbookNativeIssuer(1, MAX_WORKBOOK_DRAFT_BYTES - charge, data).total).toBe(MAX_WORKBOOK_DRAFT_BYTES);
  expect(() => budget.admitWorkbookNativeIssuer(1, MAX_WORKBOOK_DRAFT_BYTES - charge + 1, data)).toThrow('retention limit');
  expect(budget.admitWorkbookNativeIssuer(1, 100, {})).toEqual({ charge: 3, total: 103 });
});

it('bounds every fresh issuer at the existing context cap and rejects invalid accounting inputs', () => {
  expect(budget.admitWorkbookNativeIssuer(MAX_WORKBOOK_SHEET_CONTEXTS - 1, 100, {})).toEqual({ charge: 3, total: 103 });
  expect(() => budget.admitWorkbookNativeIssuer(MAX_WORKBOOK_SHEET_CONTEXTS, 100, {})).toThrow('retention limit');
  expect(() => budget.admitWorkbookNativeIssuer(1, Infinity, {})).toThrow('accounting changed');
  expect(() => budget.admitWorkbookNativeIssuer(-1, 100, {})).toThrow('accounting changed');
});

it.each(['add', 'delete', 'rename'] as const)('refuses %s resource admission before native entry without quarantine and permits an exact retry', async kind => {
  let nativeCalls = 0;
  const f = fixture(true, { runProtectedSequence: (_sequence, _prospective, execute) => { nativeCalls++; return execute(); } });
  const admission = vi.spyOn(budget, 'admitWorkbookNativeIssuer').mockImplementation(() => { throw Error('Owned issuer quota denied'); });
  try {
    const before = f.book.save(), history = f.history.getUndoRedoCheckpoint();
    const execute = () => kind === 'add' ? f.controller!.add('Quota born', 3)
      : kind === 'delete' ? f.controller!.remove('2') : f.controller!.rename('2', 'Quota renamed');
    await expect(execute()).rejects.toThrow('Owned issuer quota denied');
    expect(f.book.save()).toEqual(before);
    expect(f.history.getUndoRedoCheckpoint()).toEqual(history);
    expect(nativeCalls).toBe(0);
    expect(f.writer.checkpoint().sheetActionConflict).toBeUndefined();
    admission.mockRestore();
    await execute();
    expect(nativeCalls).toBe(1);
  } finally { admission.mockRestore(); await f.close(); }
});
