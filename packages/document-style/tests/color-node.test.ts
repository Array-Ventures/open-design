// @vitest-environment node
import { expect, it } from 'vitest';
import { compositeDocumentColor, documentContrast, opaqueDocumentColorHex } from '../src/color.js';
it('loads and runs the Node-safe entry without a browser or implicit backdrop', () => {
  expect(typeof globalThis.document).toBe('undefined');
  expect(documentContrast([0,0,0,1],[255,255,255,1])).toBe(21);
  expect(opaqueDocumentColorHex(compositeDocumentColor([255,0,0,.5],[255,255,255,1]))).toBe('FF8080');
  expect(() => opaqueDocumentColorHex([255,0,0,.5])).toThrow();
});
