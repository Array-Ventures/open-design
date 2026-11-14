import { createHash } from 'node:crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { expect, it } from 'vitest';
import { canonicalWorkbookSheetBaseline, workbookSheetBaseline } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';

it('agrees between the actual browser hash library and Node source-owner hashing after JSON transport', () => {
  const model: WorkbookDocument = { version: 1, date1904: false, activeSheetId: '1', styles: [{}, { font: { bold: true, size: 22.25 } }], features: { charts: 0, drawings: 0, externalLinks: 0, macros: false, signed: false },
    sheets: [{ id: '1', name: 'Σ 😀', visibility: 'visible', rowCount: 100, columnCount: 26, cells: [{ row: 0, column: 0, kind: 'number', value: -0, style: 1 }, { row: 0, column: 1, kind: 'string', value: 'quoted " / 😀' }], rowDimensions: [], columnDimensions: [], merges: [], frozenRows: 0, frozenColumns: 0, arrayFormulas: [] }] };
  const source = canonicalWorkbookSheetBaseline(workbookSheetBaseline(model,'1'));
  const received = canonicalWorkbookSheetBaseline(workbookSheetBaseline(JSON.parse(JSON.stringify(model)),'1'));
  expect(received).toBe(source);
  const node = createHash('sha256').update(source,'utf8').digest('hex');
  // Version-1 canonical body was inspected with the independently computed
  // Node digest; changes require deliberate identity-version review.
  expect(node).toBe('4f9b4c602659857ac58ff83c07f500e637d2a20da35d2a82969d92fc66c56463');
  expect(bytesToHex(sha256(new TextEncoder().encode(received)))).toBe(node);
});
