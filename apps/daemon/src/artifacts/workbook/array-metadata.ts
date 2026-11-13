import type { Element } from '@xmldom/xmldom';
import type { WorkbookArrayFormula } from '@open-design/contracts/runtime/workbook';
import { range } from './parts.js';
import { WorkbookFormatError } from './package.js';

/** Read source ownership without changing any formula, reference or cache. */
export function readArrayFormulaMetadata(formula: Element | undefined, position: { row: number; column: number }): WorkbookArrayFormula | undefined {
  const kind = formula?.getAttribute('t');
  if (kind !== 'array' && kind !== 'dataTable') return;
  const bounds = range(formula!.getAttribute('ref') ?? '');
  if (bounds.endRow < bounds.startRow || bounds.endColumn < bounds.startColumn || bounds.startRow !== position.row || bounds.startColumn !== position.column) throw new WorkbookFormatError('Array formula owner does not match its range.');
  return { kind, ...position, range: bounds };
}
