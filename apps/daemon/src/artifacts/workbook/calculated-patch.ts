import { assertWorkbookStructureSupported, patchWorkbookStructure } from './structure-patch.js';
import { WORKBOOK_STRUCTURE_AXIS_BUDGET } from '@open-design/contracts/runtime/workbook-structure';
import type { WorkbookStructureEdit } from '@open-design/contracts/runtime/workbook';
import { patchWorkbookVisibility } from './visibility-patch.js';
import type { Document, Element } from '@xmldom/xmldom';
import type { WorkbookDimensionEdit, WorkbookStyleEdit, WorkbookVisibilityEdit, WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { patchWorkbookCells, type WorkbookCellEdit } from './cell-patch.js';
import { calculateWorkbookResults } from './calculate.js';
import { patchWorkbookStyles } from './style-patch.js';
import { patchWorkbookDimensions } from './dimension-patch.js';
import { readXlsxWorkbook, type ReadWorkbook } from './reader.js';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { prepareDynamicArrayOwnerEdits } from './array-structural-patch.js';
import { verifiedDynamicArrayOwners, ensureDynamicArrayMetadata } from './dynamic-array-metadata.js';
import { formulaCellKey } from './formula-cache-policy.js';
import { address, appendWorkbookRowCell, orderWorkbookRowCells, child, children, xmlPart } from './parts.js';
import { partitionRetiredFollowerEdits, assertRetiredFollowersOutsideOwners, assertSameArrayTopology } from './retired-array-followers.js';
import { writeWorkbookXml } from './xml.js';

function assertCalculationSupported(source: ReadWorkbook): void {
  if (source.model.features.externalLinks) {
    throw new WorkbookFormatError('External reference calculation needs its workbook adapter.', 'WORKBOOK_UNSUPPORTED');
  }
  if (source.model.sheets.some(sheet => sheet.arrayFormulas?.length) && (source.model.definedNames?.length || source.model.tables?.length)) throw new WorkbookFormatError('Array formulas with names or tables need their dependency adapter.', 'WORKBOOK_UNSUPPORTED');
  for (const part of source.sheetParts.values()) {
    const root = xmlPart(source.parts, part).documentElement!, data = child(root, 'sheetData');
    for (const row of data ? children(data, 'row') : []) for (const cell of children(row, 'c')) {
      const formula = child(cell, 'f');
      if (formula && formula.getAttribute('t') === 'dataTable') {
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
  const originalOwnerKeys = new Set(source.model.sheets.flatMap(sheet => (sheet.arrayFormulas ?? []).map(owner => formulaCellKey(sheet.id, owner.row, owner.column))));
  const newOwners = model.sheets.flatMap(sheet => (sheet.arrayFormulas ?? []).filter(owner => !originalOwnerKeys.has(formulaCellKey(sheet.id, owner.row, owner.column))).map(owner => ({ ...owner, sheetId: sheet.id })));
  const dynamicMetadata = newOwners.length ? ensureDynamicArrayMetadata(source, output) : undefined;
  const newOwnerKeys = new Set(newOwners.map(owner => formulaCellKey(owner.sheetId, owner.row, owner.column)));
  for (const sheet of model.sheets) {
    const before = new Map(source.model.sheets.find(previous => previous.id === sheet.id)!.cells.map(cell => [`${cell.row}:${cell.column}`, cell]));
    const sourceOwners = source.model.sheets.find(previous => previous.id === sheet.id)!.arrayFormulas ?? [];
    const currentByPosition = new Map((sheet.arrayFormulas ?? []).map(owner => [`${owner.row}:${owner.column}`, owner]));
    const sourceByPosition = new Map(sourceOwners.map(owner => [`${owner.row}:${owner.column}`, owner]));
    const ownedCells = new Set<string>();
    for (const owner of [...sheet.arrayFormulas ?? [], ...sourceOwners]) if (!retained.has(formulaCellKey(sheet.id, owner.row, owner.column))) for (let row = owner.row; row <= owner.range.endRow; row++) for (let column = owner.column; column <= owner.range.endColumn; column++) ownedCells.add(`${row}:${column}`);
    const owned = (row: number, column: number) => ownedCells.has(`${row}:${column}`);
    const resized = new Set((sheet.arrayFormulas ?? []).filter(owner => { const previous = sourceByPosition.get(`${owner.row}:${owner.column}`); return previous && (previous.range.endRow !== owner.range.endRow || previous.range.endColumn !== owner.range.endColumn); }).map(owner => `${owner.row}:${owner.column}`));
    // New ownership must be written even when its first result stays blank.
    const formulas = new Map(sheet.cells.filter(cell => (cell.formula || owned(cell.row, cell.column)) && !retained.has(formulaCellKey(sheet.id, cell.row, cell.column)) && (newOwnerKeys.has(formulaCellKey(sheet.id, cell.row, cell.column)) || resized.has(`${cell.row}:${cell.column}`) || before.get(`${cell.row}:${cell.column}`)?.kind !== cell.kind || before.get(`${cell.row}:${cell.column}`)?.value !== cell.value)).map(cell => [`${cell.row}:${cell.column}`, cell]));
    if (!formulas.size) continue;
    const part = source.sheetParts.get(sheet.id)!, document = xmlPart(output, part), data = child(document.documentElement!, 'sheetData');
    if (!data) throw new WorkbookFormatError('Worksheet data is missing.');
    const rows = new Map(children(data, 'row').map(row => [Number(row.getAttribute('r')) - 1, row]));
    const boundaries = new Map([...rows.values()].map(row => [row, child(row, 'extLst') ?? null]));
    const existing = new Set([...rows.values()].flatMap(row => children(row, 'c').map(cell => { const position = address(cell.getAttribute('r')!); return `${position.row}:${position.column}`; })));
    let addedCells = false;
    for (const [key, calculated] of formulas) if (!existing.has(key)) {
      addedCells = true;
      if (calculated.formula) throw new WorkbookFormatError('Calculated owner is missing from its package.');
      let row = rows.get(calculated.row);
      if (!row) { row = document.createElementNS(data.namespaceURI, data.prefix ? `${data.prefix}:row` : 'row'); row.setAttribute('r', String(calculated.row + 1)); data.appendChild(row); rows.set(calculated.row, row); boundaries.set(row, null); }
      const cell = document.createElementNS(data.namespaceURI, data.prefix ? `${data.prefix}:c` : 'c'); cell.setAttribute('r', cellAddress(calculated.row, calculated.column)); appendWorkbookRowCell(row, cell, boundaries.get(row) ?? null); row.removeAttribute('spans');
    }
    for (const row of children(data, 'row')) for (const cell of children(row, 'c')) {
      const position = address(cell.getAttribute('r')!), calculated = formulas.get(`${position.row}:${position.column}`);
      if (!calculated) continue;
      if (calculated.formula && !child(cell, 'f')) throw new WorkbookFormatError('Calculated formula no longer matches its package.');
      const owner = currentByPosition.get(`${position.row}:${position.column}`);
      const previousOwner = sourceByPosition.get(`${position.row}:${position.column}`);
      if (owner && newOwnerKeys.has(formulaCellKey(sheet.id, position.row, position.column))) { const formula = child(cell, 'f')!; formula.setAttribute('t', 'array'); formula.setAttribute('ref', `${cellAddress(owner.row, owner.column)}:${cellAddress(owner.range.endRow, owner.range.endColumn)}`); cell.setAttribute('cm', String(dynamicMetadata)); }
      if (owner && previousOwner && (owner.range.endRow !== previousOwner.range.endRow || owner.range.endColumn !== previousOwner.range.endColumn)) child(cell, 'f')!.setAttribute('ref', `${cellAddress(owner.row, owner.column)}:${cellAddress(owner.range.endRow, owner.range.endColumn)}`);
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
      orderWorkbookRowCells(row);
    }
    for (const row of children(data, 'row').sort((a, b) => Number(a.getAttribute('r')) - Number(b.getAttribute('r')))) data.appendChild(row);
    if (addedCells) { const dimension = child(document.documentElement!, 'dimension'); if (dimension) dimension.parentNode!.removeChild(dimension); }
    output.set(part, writeWorkbookXml(document));
  }
  return writeWorkbookPackage(output);
}

/** Only called after the structural XML writer has validated these projections.
 * A bounded logical window can exceed sparse XML's materialized dimensions.
 * Keep that authority through reparses until the real style/dimension owner
 * writes the requested coordinate; never add placeholder cells or return it as
 * source geometry when the output bytes do not actually materialize it. */
async function readStructuralWindow(bytes: Buffer, structure: readonly WorkbookStructureEdit[]): Promise<ReadWorkbook> {
  const source = await readXlsxWorkbook(bytes);
  if (!source.model.worksheetStructureEditable) throw new WorkbookFormatError('This structural edit exceeds its qualified source/calculation boundary.', 'WORKBOOK_UNSUPPORTED');
  for (const edit of structure) {
    const sheet = source.model.sheets.find(sheet => sheet.id === edit.sheetId)!;
    sheet.rowCount = Math.max(sheet.rowCount, edit.rows.length);
    sheet.columnCount = Math.max(sheet.columnCount, edit.columns.length);
  }
  const axes = source.model.sheets.reduce((sum, sheet) => sum + sheet.rowCount + sheet.columnCount, 0);
  if (!Number.isSafeInteger(axes) || axes > WORKBOOK_STRUCTURE_AXIS_BUDGET) throw new WorkbookFormatError('Structural dimensions exceed their metadata limit.', 'WORKBOOK_LIMIT');
  assertWorkbookStructureSupported(source);
  return source;
}

/** Internal transaction preparation. The caller must persist these bytes with
 * conditional binary history/receipts; this helper never writes workspace files.
 * Parser and calculation execution must be isolated before API exposure. */
export async function calculateWorkbookCellEdits(source: ReadWorkbook, edits: readonly WorkbookCellEdit[], dimensions: readonly WorkbookDimensionEdit[] = [], styles: readonly WorkbookStyleEdit[] = [], visibility: readonly WorkbookVisibilityEdit[] = [], structure: readonly WorkbookStructureEdit[] = []): Promise<{ bytes: Buffer; model: WorkbookDocument }> {
  if (structure.length) {
    const prepared = await readStructuralWindow(await patchWorkbookStructure(source, structure), structure);
    // Geometry invalidated every formula cache. Force the content calculator
    // even for dimension/style/visibility-only follow-ups; those normal owners
    // intentionally skip calculation when geometry has not changed.
    assertCalculationSupported(prepared);
    const calculated = await calculateContent(prepared, edits, verifiedDynamicArrayOwners(prepared));
    let bytes = calculated.bytes;
    if (dimensions.length) bytes = await patchWorkbookDimensions(await readStructuralWindow(bytes, structure), dimensions);
    if (styles.length) bytes = await patchWorkbookStyles(await readStructuralWindow(bytes, structure), styles);
    if (visibility.length) bytes = await patchWorkbookVisibility(await readStructuralWindow(bytes, structure), visibility);
    const result = { bytes, model: (await readXlsxWorkbook(bytes)).model };
    if (!result.model.worksheetStructureEditable) throw new WorkbookFormatError('Combined structural edits require qualified scalar source content.', 'WORKBOOK_UNSUPPORTED');
    return result;
  }
  if (visibility.length) {
    // Navigation-only changes neither require nor invalidate formula results.
    const content = edits.length || dimensions.length || styles.length ? await readXlsxWorkbook((await calculateWorkbookCellEdits(source, edits, dimensions, styles)).bytes) : source;
    const bytes = await patchWorkbookVisibility(content, visibility);
    return { bytes, model: (await readXlsxWorkbook(bytes)).model };
  }
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
  if (edits.length) {
    const previous = new Map(source.model.sheets.flatMap(sheet => sheet.cells.map(cell => [formulaCellKey(sheet.id,cell.row,cell.column),cell] as const)));
    const formattingOnly = edits.every(({sheetId,cell}) => { const before=previous.get(formulaCellKey(sheetId,cell.row,cell.column));return cell.kind==='string'&&!cell.formula&&before?.kind==='string'&&!before.formula&&cell.value===before.value&&(before.runs!==undefined||cell.runs!==undefined); });
    if (formattingOnly) { const bytes=await patchWorkbookCells(source,edits,{retainFormulaCaches:true,formattingOnly:true});return{bytes,model:(await readXlsxWorkbook(bytes)).model}; }
  }
  assertCalculationSupported(source);
  const dynamicOwners = verifiedDynamicArrayOwners(source);
  const plan = partitionRetiredFollowerEdits(source, edits, dynamicOwners);
  if (!plan.deferred.length) return calculateContent(source, edits, dynamicOwners);
  // At most two complete existing two-pass calculations. Both intermediates
  // remain private; only the final bytes can reach the caller's CAS/history.
  const admitted = await readXlsxWorkbook((await calculateContent(source, plan.ordinary, dynamicOwners)).bytes);
  assertRetiredFollowersOutsideOwners(admitted.model, plan);
  const final = await calculateContent(admitted, plan.deferred, verifiedDynamicArrayOwners(admitted));
  assertRetiredFollowersOutsideOwners(final.model, plan);
  assertSameArrayTopology(admitted.model, final.model);
  return final;
}
async function calculateContent(source: ReadWorkbook, edits: readonly WorkbookCellEdit[], dynamicOwners: ReadonlySet<string>): Promise<{ bytes: Buffer; model: WorkbookDocument }> {
  const prepared = await prepareDynamicArrayOwnerEdits(source, edits, dynamicOwners);
  const patched = await readXlsxWorkbook(await patchWorkbookCells(prepared, edits, { retainFormulaCaches: true }));
  let calculated = await calculateWorkbookResults(patched.model, source.model, dynamicOwners, new Map(), true);
  if (dynamicOwners.size || calculated.model.sheets.some(sheet => (sheet.arrayFormulas?.length ?? 0) !== (patched.model.sheets.find(previous => previous.id === sheet.id)!.arrayFormulas?.length ?? 0))) {
    const admitted = new Map(calculated.model.sheets.flatMap(sheet => (sheet.arrayFormulas ?? []).map(owner => [formulaCellKey(sheet.id, owner.row, owner.column), owner.range] as const)));
    const final = await calculateWorkbookResults(patched.model, source.model, dynamicOwners, admitted, true);
    let observed = 0;
    for (const sheet of final.model.sheets) for (const owner of sheet.arrayFormulas ?? []) {
      observed++;
      const bounds = admitted.get(formulaCellKey(sheet.id, owner.row, owner.column));
      if (!bounds || bounds.startRow !== owner.range.startRow || bounds.endRow !== owner.range.endRow || bounds.startColumn !== owner.range.startColumn || bounds.endColumn !== owner.range.endColumn) throw new WorkbookFormatError('Dynamic array geometry changed during calculation. Your file has not changed.', 'WORKBOOK_UNSUPPORTED');
    }
    if (observed !== admitted.size) throw new WorkbookFormatError('Dynamic array owner set changed during calculation. Your file has not changed.', 'WORKBOOK_UNSUPPORTED');
    calculated = final;
  }
  const { model, retained } = calculated;
  const bytes = await writeCalculatedCaches(patched, model, retained);
  return { bytes, model: (await readXlsxWorkbook(bytes)).model };
}
