import { expect, it } from 'vitest';
import { documentWordFontSize, documentFontSizePattern, normalizeDocumentFontPoints, validDocumentFontSize, validDocumentFontLineHeight } from '../src/presentation.js';
it('retains existing source font syntax and rejects unqualified measurements', () => {
  for (const value of ['40px','16pt','2em','2rem','150%']) expect(documentFontSizePattern.test(value)).toBe(true);
  for (const value of ['calc(2em)','-2px','var(--font)','2vw','2e2px']) expect(documentFontSizePattern.test(value)).toBe(false);
  for (const value of [NaN,Infinity,0,-1,1638.6,'30']) expect(validDocumentFontSize(value)).toBe(false);
  expect(validDocumentFontLineHeight(3278)).toBe(false);
});
it('corrects only measured CSS pixel serialization noise without rounding genuine fractional source sizes', () => {
  expect(normalizeDocumentFontPoints(15.999975)).toBe(16);
  expect(normalizeDocumentFontPoints(15.500025)).toBe(15.5);
  expect(normalizeDocumentFontPoints(15.9999)).toBe(16);
  expect(normalizeDocumentFontPoints(16.0001)).toBe(16);
  expect(normalizeDocumentFontPoints(15.99989999)).toBe(15.99989999);
  expect(normalizeDocumentFontPoints(16.00010001)).toBe(16.00010001);
  expect(documentWordFontSize(15.999975)).toBe('32');
  expect(documentWordFontSize(18.75)).toBe('18.75pt');
  expect(documentWordFontSize(16.00011)).toBe('16.00011pt');
  expect(normalizeDocumentFontPoints(.00001)).toBe(.00001);
  expect(() => documentWordFontSize(Infinity)).toThrow();
});
it('never serializes a finite positive font size as zero or silently rounds non-near precision', () => {
  for (const points of [Number.MIN_VALUE,1e-8,1e-7,.123456789012,15.123456789]) {
    const value = documentWordFontSize(points);
    expect(value).toMatch(/^(?:[0-9]+|[0-9]+(?:\.[0-9]+)?pt)$/);
    const recovered = value.endsWith('pt') ? Number(value.slice(0,-2)) : Number(value)/2;
    expect(recovered).toBeGreaterThan(0);
    expect(recovered).toBe(normalizeDocumentFontPoints(points));
  }
});
