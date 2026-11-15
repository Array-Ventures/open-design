import { expect, it } from 'vitest';
import { documentDateIso, readDocumentDate } from '../src/runtime/document-date.js';
it.each(['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31'])('accepts exact Gregorian calendar dates: %s', value => {
  expect(documentDateIso(value)).toBe(value);
});
it.each(['0000-01-01', '1900-02-29', '2100-02-29', '2024-04-31', '2024-1-01', '2024-01-1', '2024-01-01T00:00:00Z', '10000-01-01'])('rejects impossible or noncanonical dates: %s', value => {
  expect(documentDateIso(value)).toBeNull();
});
it('copies and freezes persisted Unicode labels without forcing locale recomputation', () => {
  const source = { iso: '2024-02-29', locale: 'en-US', label: 'Authored leap day 二 🗓️' };
  const value = readDocumentDate(source)!; source.label = 'changed';
  expect(value.label).toBe('Authored leap day 二 🗓️'); expect(Object.isFrozen(value)).toBe(true);
});
it.each([{ label: '' }, { label: 'x'.repeat(129) }, { label: 'bad\nlabel' }, { label: '<script>' }, { label: 'bad\u2028label' }, { label: 'bad\u2029label' }, { label: 'bad\u0085label' }, { label: '\ud800' }, { locale: 'en_us' }, { locale: 'EN-us' }, { locale: '' }, { iso: 20240229 }])('refuses unsafe or malformed persisted Date data: %j', changed => {
  expect(readDocumentDate({ iso: '2024-02-29', locale: 'en-US', label: 'Persisted label', ...changed })).toBeNull();
});
