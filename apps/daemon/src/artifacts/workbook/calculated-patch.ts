import type { Document, Element } from '@xmldom/xmldom';
import type { WorkbookDimensionEdit, WorkbookStyleEdit, WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { patchWorkbookCells, type WorkbookCellEdit } from './cell-patch.js';
import { calculateWorkbookResults } from './calculate.js';
import { patchWorkbookStyles } from './style-patch.js';
import { patchWorkbookDimensions } from './dimension-patch.js';
import { readXlsxWorkbook, type ReadWorkbook } from './reader.js';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { formulaCellKey } from './formula-cache-policy.js';
import { address, child, children, xmlPart } from './parts.js';
import { writeWorkbookXml } from './xml.js';

function assertCalculationSupported(source: ReadWorkbook): void {
  if (source.model.features.externalLinks) {
    throw new WorkbookFormatError('External reference calculation needs its workbook adapter.', 'WORKBOOK_UNSUPPORTED');
  }
  if (source.model.sheets.some(sheet => sheet.arrayFormulas?.length) && (source.model.definedNames?.length || source.model.tables?.length)) throw new WorkbookFormatError('Named or table array dependencies need their array adapter.', 'WORKBOOK_UNSUPPORTED');
  for (const part of source.sheetParts.values()) {
    const root = xmlPart(source.parts, part).documentElement!, data = child(root, 'sheetData');
    for (const row of data ? children(data, 'row') : []) for (const cell of children(row, 'c')) {
      const formula = child(cell, 'f');
      if (formula && formula.getAttribute('t') === 'dataTable' || cell.hasAttribute('cm')) {
        throw new WorkbookFormatError('Array and dynamic formula calculation needs its workbook adapter.', 'WORKBOOK_UNSUPPORTED');
      }
    }
  }
}
function cellAddress(row: number, column: number): string {
  let letters = '';
  for (let value = column + 1; value; value = Math.floor((value - 1) / 26)) letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  return `${letters}${row + 1}`;
}
function valueElement(document: Document, cell: Element, value: string): Element {
  const item = document.createElementNS(cell.namespaceURI, cell.prefix ? `${cell.prefix}:v` : 'v');
  item.appendChild(document.createTextNode(value)); return item;
}
async function writeCalculatedCaches(source: ReadWorkbook, model: WorkbookDocument, retained: ReadonlySet<string>): Promise<Buffer> {
  const output = new Map(source.parts);
  for (const sheet of model.sheets) {
    const before = new Map(source.model.sheets.find(previous => previous.id === sheet.id)!.cells.map(cell => [`${cell.row}:${cell.column}`, cell]));
    const ownedCells = new Set<string>();
    for (const owner of sheet.arrayFormulas ?? []) if (!retained.has(formulaCellKey(sheet.id, owner.row, owner.column))) for (let row = owner.row; row <= owner.range.endRow; row++) for (let column = owner.column; column <= owner.range.endColumn; column++) ownedCells.add(`${row}:${column}`);
    const owned = (row: number, column: number) => ownedCells.has(`${row}:${column}`);
    const formulas = new Map(sheet.cells.filter(cell => (cell.formula || owned(cell.row, cell.column)) && !retained.has(formulaCellKey(sheet.id, cell.row, cell.column)) && (before.get(`${cell.row}:${cell.column}`)?.kind !== cell.kind || before.get(`${cell.row}:${cell.column}`)?.value !== cell.value)).map(cell => [`${cell.row}:${cell.column}`, cell]));
    if (!formulas.size) continue;
    const part = source.sheetParts.get(sheet.id)!, document = xmlPart(output, part), data = child(document.documentElement!, 'sheetData');
    if (!data) throw new WorkbookFormatError('Worksheet data is missing.');
    const rows = new Map(children(data, 'row').map(row => [Number(row.getAttribute('r')) - 1, row]));
    const existing = new Set([...rows.values()].flatMap(row => children(row, 'c').map(cell => { const position = address(cell.getAttribute('r')!); return `${position.row}:${position.column}`; })));
    let addedCells = false;
    for (const [key, calculated] of formulas) if (!existing.has(key)) {
      addedCells = true;
      if (calculated.formula) throw new WorkbookFormatError('Calculated owner is missing from its package.');
      let row = rows.get(calculated.row);
      if (!row) { row = document.createElementNS(data.namespaceURI, data.prefix ? `${data.prefix}:row` : 'row'); row.setAttribute('r', String(calculated.row + 1)); data.appendChild(row); rows.set(calculated.row, row); }
      const cell = document.createElementNS(data.namespaceURI, data.prefix ? `${data.prefix}:c` : 'c'); cell.setAttribute('r', cellAddress(calculated.row, calculated.column)); row.appendChild(cell); row.removeAttribute('spans');
    }
    for (const row of children(data, 'row')) for (const cell of children(row, 'c')) {
      const position = address(cell.getAttribute('r')!), calculated = formulas.get(`${position.row}:${position.column}`);
      if (!calculated) continue;
      if (calculated.formula && !child(cell, 'f')) throw new WorkbookFormatError('Calculated formula no longer matches its package.');
      for (const name of ['v', 'is']) for (const previous of children(cell, name)) cell.removeChild(previous);
      cell.removeAttribute('t');
      if (calculated.kind === 'boolean') cell.setAttribute('t', 'b');
      if (calculated.kind === 'string') cell.setAttribute('t', 'str');
      if (calculated.kind === 'error') cell.setAttribute('t', 'e');
      if (calculated.kind !== 'blank') cell.insertBefore(valueElement(document, cell, calculated.kind === 'boolean' ? calculated.value ? '1' : '0' : String(calculated.value)), child(cell, 'extLst') ?? null);
      formulas.delete(`${position.row}:${position.column}`);
    }
    if (formulas.size) throw new WorkbookFormatError('Calculated formula cells are missing from the package.');
    for (const row of children(data, 'row')) {
      for (const cell of children(row, 'c').sort((a, b) => address(a.getAttribute('r')!).column - address(b.getAttribute('r')!).column)) row.appendChild(cell);
    }
    for (const row of children(data, 'row').sort((a, b) => Number(a.getAttribute('r')) - Number(b.getAttribute('r')))) data.appendChild(row);
    if (addedCells) { const dimension = child(document.documentElement!, 'dimension'); if (dimension) dimension.parentNode!.removeChild(dimension); }
    output.set(part, writeWorkbookXml(document));
  }
  return writeWorkbookPackage(output);
}

/** Internal transaction preparation. The caller must persist these bytes with
 * conditional binary history/receipts; this helper never writes workspace files.
 * Parser and calculation execution must be isolated before API exposure. */
export async function calculateWorkbookCellEdits(source: ReadWorkbook, edits: readonly WorkbookCellEdit[], dimensions: readonly WorkbookDimensionEdit[] = [], styles: readonly WorkbookStyleEdit[] = []): Promise<{ bytes: Buffer; model: WorkbookDocument }> {
  if (styles.length) {
    const content = edits.length || dimensions.length ? await readXlsxWorkbook((await calculateWorkbookCellEdits(source, edits, dimensions)).bytes) : source;
    const bytes = await patchWorkbookStyles(content, styles);
    return { bytes, model: (await readXlsxWorkbook(bytes)).model };
  }
  if (dimensions.length) {
    // Resizing does not invalidate formula caches. For a combined edit, first
    // calculate the scalar changes and then patch only dimension attributes.
    const content = edits.length ? await readXlsxWorkbook((await calculateWorkbookCellEdits(source, edits)).bytes) : source;
    const bytes = await patchWorkbookDimensions(content, dimensions);
    return { bytes, model: (await readXlsxWorkbook(bytes)).model };
  }
  assertCalculationSupported(source);
  const patched = await readXlsxWorkbook(await patchWorkbookCells(source, edits, { retainFormulaCaches: true }));
  const { model, retained } = await calculateWorkbookResults(patched.model, source.model);
  return { bytes: await writeCalculatedCaches(patched, model, retained), model };
}
