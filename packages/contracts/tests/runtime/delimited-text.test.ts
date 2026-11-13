import { expect, it } from 'vitest';
import { parseDelimitedText, validateDelimitedLiteral } from '../../src/runtime/delimited-text';
it('uses explicit comma or TSV delimiters and retains literal Unicode, BOM and quoted newlines', () => {
  expect(parseDelimitedText('\ufeff001,=sum(a1),', ',', true).map(row => row.map(field => field.value))).toEqual([['001', '=sum(a1)', '']]);
  expect(parseDelimitedText('"001\nline"\tfalse\r\n雪\n', '\t').map(row => row.map(field => field.value))).toEqual([['001\nline', 'false'], ['雪']]);
  expect(parseDelimitedText('\ufeff001', '\t')[0]![0]!.value).toBe('\ufeff001');
});
it('rejects malformed quoting, invalid Unicode, controls and over-limit fields before returning tokens', () => {
  for (const value of ['"unterminated', 'a"b', '"a"trailing', 'a\rb', 'x'.repeat(32768), '\u0000']) expect(() => parseDelimitedText(value, '\t')).toThrow();
  expect(() => validateDelimitedLiteral('\ud800')).toThrow();
});
