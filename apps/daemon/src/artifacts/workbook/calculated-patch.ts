import type { Document, Element } from '@xmldom/xmldom';
import type { WorkbookDimensionEdit, WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { patchWorkbookCells, type WorkbookCellEdit } from './cell-patch.js';
import { calculateWorkbook } from './calculate.js';
import { patchWorkbookDimensions } from './dimension-patch.js';
import { readXlsxWorkbook, type ReadWorkbook } from './reader.js';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { address, child, children, xmlPart } from './parts.js';
import { writeWorkbookXml } from './xml.js';

function assertCalculationSupported(source: ReadWorkbook): void {
  if (source.model.features.externalLinks) {
    throw new WorkbookFormatError('External reference calculation needs its workbook adapter.', 'WORKBOOK_UNSUPPORTED');
  }
  for (const part of source.sheetParts.values()) {
    const root = xmlPart(source.parts, part).documentElement!, data = child(root, 'sheetData');
    for (const row of data ? children(data, 'row') : []) for (const cell of children(row, 'c')) {
      const formula = child(cell, 'f');
      if (formula && ['array', 'dataTable'].includes(formula.getAttribute('t') ?? '') || cell.hasAttribute('cm')) {
        throw new WorkbookFormatError('Array and dynamic formula calculation needs its workbook adapter.', 'WORKBOOK_UNSUPPORTED');
      }
    }
  }
}
function valueElement(document: Document, cell: Element, value: string): Element {
  const item = document.createElementNS(cell.namespaceURI, cell.prefix ? `${cell.prefix}:v` : 'v');
  item.appendChild(document.createTextNode(value)); return item;
}
async function writeCalculatedCaches(source: ReadWorkbook, model: WorkbookDocument): Promise<Buffer> {
  const output = new Map(source.parts);
  for (const sheet of model.sheets) {
    const formulas = new Map(sheet.cells.filter(cell => cell.formula).map(cell => [`${cell.row}:${cell.column}`, cell]));
    if (!formulas.size) continue;
    const part = source.sheetParts.get(sheet.id)!, document = xmlPart(output, part), data = child(document.documentElement!, 'sheetData');
    for (const row of data ? children(data, 'row') : []) for (const cell of children(row, 'c')) {
      const position = address(cell.getAttribute('r')!), calculated = formulas.get(`${position.row}:${position.column}`);
      if (!calculated) continue;
      if (!child(cell, 'f')) throw new WorkbookFormatError('Calculated formula no longer matches its package.');
      for (const previous of children(cell, 'v')) cell.removeChild(previous);
      cell.removeAttribute('t');
      if (calculated.kind === 'boolean') cell.setAttribute('t', 'b');
      if (calculated.kind === 'string') cell.setAttribute('t', 'str');
      if (calculated.kind === 'error') cell.setAttribute('t', 'e');
      if (calculated.kind !== 'blank') cell.insertBefore(valueElement(document, cell, calculated.kind === 'boolean' ? calculated.value ? '1' : '0' : String(calculated.value)), child(cell, 'extLst') ?? null);
      formulas.delete(`${position.row}:${position.column}`);
    }
    if (formulas.size) throw new WorkbookFormatError('Calculated formula cells are missing from the package.');
    output.set(part, writeWorkbookXml(document));
  }
  return writeWorkbookPackage(output);
}

/** Internal transaction preparation. The caller must persist these bytes with
 * conditional binary history/receipts; this helper never writes workspace files.
 * Parser and calculation execution must be isolated before API exposure. */
export async function calculateWorkbookCellEdits(source: ReadWorkbook, edits: readonly WorkbookCellEdit[], dimensions: readonly WorkbookDimensionEdit[] = []): Promise<{ bytes: Buffer; model: WorkbookDocument }> {
  if (dimensions.length) {
    // Resizing does not invalidate formula caches. For a combined edit, first
    // calculate the scalar changes and then patch only dimension attributes.
    const content = edits.length ? await readXlsxWorkbook((await calculateWorkbookCellEdits(source, edits)).bytes) : source;
    const bytes = await patchWorkbookDimensions(content, dimensions);
    return { bytes, model: (await readXlsxWorkbook(bytes)).model };
  }
  assertCalculationSupported(source);
  const patched = await readXlsxWorkbook(await patchWorkbookCells(source, edits));
  const model = await calculateWorkbook(patched.model);
  return { bytes: await writeCalculatedCaches(patched, model), model };
}
