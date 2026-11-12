import type { Document, Element } from '@xmldom/xmldom';
import { workbookCellSchema, type WorkbookCell, type WorkbookRange } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { address, child, children, range, relationshipTarget, xmlPart } from './parts.js';
import type { ReadWorkbook } from './reader.js';
import { writeWorkbookXml } from './xml.js';

export interface WorkbookCellEdit { sheetId: string; cell: WorkbookCell }
function element(document: Document, parent: Element, name: string): Element {
  return document.createElementNS(parent.namespaceURI, parent.prefix ? `${parent.prefix}:${name}` : name);
}
function cellAddress(row: number, column: number): string {
  let letters = '';
  for (let value = column + 1; value; value = Math.floor((value - 1) / 26)) letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  return `${letters}${row + 1}`;
}
function remove(parent: Element, ...names: string[]): void {
  for (const name of names) for (const item of children(parent, name)) parent.removeChild(item);
}
function text(document: Document, parent: Element, name: string, value: string): Element {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF\p{Cs}]/u.test(value)) throw new WorkbookFormatError('Cell text contains invalid XML characters.');
  const item = element(document, parent, name); item.appendChild(document.createTextNode(value)); parent.insertBefore(item, child(parent, 'extLst') ?? null); return item;
}
function writeValue(document: Document, target: Element, value: WorkbookCell): void {
  remove(target, 'f', 'v', 'is'); target.removeAttribute('t');
  if (value.formula) text(document, target, 'f', value.formula.slice(1));
  // Formula caches are invalidated across the package below. A caller-provided
  // cached value is never treated as evidence of actual calculation.
  if (value.formula || value.kind === 'blank') return;
  if (value.kind === 'string') {
    if (value.runs) throw new WorkbookFormatError('Rich text edits need the formatting patch adapter.', 'WORKBOOK_UNSUPPORTED');
    target.setAttribute('t', 'inlineStr');
    const inline = element(document, target, 'is'); target.insertBefore(inline, child(target, 'extLst') ?? null);
    text(document, inline, 't', value.value).setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  } else {
    if (value.kind === 'boolean') target.setAttribute('t', 'b');
    if (value.kind === 'error') target.setAttribute('t', 'e');
    text(document, target, 'v', value.kind === 'boolean' ? value.value ? '1' : '0' : String(value.value));
  }
}
interface SheetIndex { rows: Map<number, Element>; cells: Map<string, Element> }
function ensureCell(document: Document, root: Element, position: WorkbookCell, index: SheetIndex): Element {
  const data = child(root, 'sheetData');
  if (!data) throw new WorkbookFormatError('Worksheet data is missing.');
  let row = index.rows.get(position.row);
  if (!row) {
    row = element(document, data, 'row'); row.setAttribute('r', String(position.row + 1));
    data.appendChild(row); index.rows.set(position.row, row);
  }
  const key = `${position.row}:${position.column}`;
  let cell = index.cells.get(key);
  if (!cell) {
    cell = element(document, row, 'c'); cell.setAttribute('r', cellAddress(position.row, position.column));
    row.appendChild(cell); index.cells.set(key, cell);
  }
  return cell;
}
interface EditRestrictions { protected: boolean; merges: WorkbookRange[]; arrays: WorkbookRange[] }
function editRestrictions(root: Element): EditRestrictions {
  const merges = child(root, 'mergeCells');
  const restrictions: EditRestrictions = { protected: Boolean(child(root, 'sheetProtection')), merges: merges ? children(merges, 'mergeCell').map(merge => range(merge.getAttribute('ref')!)) : [], arrays: [] };
  const data = child(root, 'sheetData');
  for (const row of data ? children(data, 'row') : []) for (const existing of children(row, 'c')) {
    const formula = child(existing, 'f');
    if (!formula || !['array', 'dataTable'].includes(formula.getAttribute('t') ?? '')) continue;
    restrictions.arrays.push(range(formula.getAttribute('ref') ?? existing.getAttribute('r')!));
  }
  return restrictions;
}
function rejectProtectedEdit(restrictions: EditRestrictions, cell: WorkbookCell): void {
  if (restrictions.protected) throw new WorkbookFormatError('Protected worksheets cannot be edited here.', 'WORKBOOK_UNSUPPORTED');
  for (const bounds of restrictions.merges) {
    if (cell.row >= bounds.startRow && cell.row <= bounds.endRow && cell.column >= bounds.startColumn && cell.column <= bounds.endColumn
      && (cell.row !== bounds.startRow || cell.column !== bounds.startColumn)) throw new WorkbookFormatError('Edit the merged range anchor instead.');
  }
  for (const bounds of restrictions.arrays) {
    if (cell.row >= bounds.startRow && cell.row <= bounds.endRow && cell.column >= bounds.startColumn && cell.column <= bounds.endColumn) {
      throw new WorkbookFormatError('Array and table formula edits need a structural patch.', 'WORKBOOK_UNSUPPORTED');
    }
  }
}

/** Preservation primitive, not the product save API. It patches cell contents,
 * expands shared formula groups before edits and removes stale formula caches.
 * Calculation and conditional binary history must run before product export. */
export async function patchWorkbookCells(source: ReadWorkbook, edits: readonly WorkbookCellEdit[]): Promise<Buffer> {
  if (source.model.features.signed) throw new WorkbookFormatError('Editing would invalidate workbook signatures.', 'WORKBOOK_UNSUPPORTED');
  if (edits.length > 100_000) throw new WorkbookFormatError('Too many workbook edits.', 'WORKBOOK_LIMIT');
  if (!edits.length) return writeWorkbookPackage(source.parts);
  const documents = new Map<string, Document>();
  const indexes = new Map<string, SheetIndex>();
  const restrictions = new Map<string, EditRestrictions>();
  const sourceCells = new Map(source.model.sheets.map(sheet => [sheet.id, new Map(sheet.cells.map(cell => [`${cell.row}:${cell.column}`, cell]))]));
  const positions = new Set<string>();
  for (const edit of edits) {
    const value = workbookCellSchema.parse(edit.cell);
    const sheet = source.model.sheets.find(sheet => sheet.id === edit.sheetId);
    const part = source.sheetParts.get(edit.sheetId);
    if (!sheet || !part) throw new WorkbookFormatError('Workbook edit targets an unknown sheet.');
    const key = `${edit.sheetId}:${value.row}:${value.column}`;
    if (positions.has(key)) throw new WorkbookFormatError('Duplicate workbook cell edit.');
    positions.add(key);
    const previous = sourceCells.get(sheet.id)!.get(`${value.row}:${value.column}`);
    if ((previous?.style ?? 0) !== (value.style ?? 0)) throw new WorkbookFormatError('Style edits need the formatting patch adapter.', 'WORKBOOK_UNSUPPORTED');
    let document = documents.get(part);
    if (!document) {
      document = xmlPart(source.parts, part); documents.set(part, document);
      restrictions.set(part, editRestrictions(document.documentElement!));
      const sheetIndex: SheetIndex = { rows: new Map(), cells: new Map() }; indexes.set(part, sheetIndex);
      // Normalize omitted coordinates for later sorted insertion, without
      // touching any package that does not require a worksheet rewrite.
      let lastRow = 0;
      const data = child(document.documentElement!, 'sheetData');
      for (const row of data ? children(data, 'row') : []) {
        const index = row.hasAttribute('r') ? Number(row.getAttribute('r')) : lastRow + 1;
        row.setAttribute('r', String(index)); lastRow = index;
        sheetIndex.rows.set(index - 1, row);
        let lastColumn = -1;
        for (const cell of children(row, 'c')) {
          const position = cell.hasAttribute('r') ? address(cell.getAttribute('r')!) : { row: index - 1, column: lastColumn + 1 };
          cell.setAttribute('r', cellAddress(position.row, position.column)); lastColumn = position.column;
          sheetIndex.cells.set(`${position.row}:${position.column}`, cell);
          const formula = child(cell, 'f');
          if (formula?.getAttribute('t') === 'shared') {
            const resolved = sourceCells.get(sheet.id)!.get(`${position.row}:${position.column}`)?.formula;
            if (!resolved) throw new WorkbookFormatError('Shared workbook formula is unresolved.');
            const explicit = element(document, cell, 'f'); explicit.appendChild(document.createTextNode(resolved.slice(1))); cell.replaceChild(explicit, formula);
          }
        }
      }
    }
    const root = document.documentElement!;
    rejectProtectedEdit(restrictions.get(part)!, value);
    writeValue(document, ensureCell(document, root, value, indexes.get(part)!), value);
    // Optional used-range hints must not prevent an application finding a new
    // cell. Recompute on open instead of retaining a stale dimension hint.
    remove(root, 'dimension');
  }
  const output = new Map(source.parts);
  for (const [sheetId, part] of source.sheetParts) {
    const document = documents.get(part) ?? xmlPart(source.parts, part);
    let changed = documents.has(part);
    const data = child(document.documentElement!, 'sheetData');
    if (data && documents.has(part)) {
      for (const row of children(data, 'row').sort((a, b) => Number(a.getAttribute('r')) - Number(b.getAttribute('r')))) {
        data.appendChild(row);
        for (const cell of children(row, 'c').sort((a, b) => address(a.getAttribute('r')!).column - address(b.getAttribute('r')!).column)) row.appendChild(cell);
      }
    }
    for (const row of data ? children(data, 'row') : []) for (const cell of children(row, 'c')) if (child(cell, 'f')) {
      remove(cell, 'v'); cell.removeAttribute('t'); changed = true;
    }
    if (changed) output.set(source.sheetParts.get(sheetId)!, writeWorkbookXml(document));
  }
  // Remove the obsolete calculation chain and its references. Root discovery
  // is canonical for now, matching the package admission contract.
  const relsName = 'xl/_rels/workbook.xml.rels';
  const rels = xmlPart(output, relsName), types = xmlPart(output, '[Content_Types].xml');
  let removedChain = false;
  for (const relation of children(rels.documentElement!, 'Relationship')) if (relation.getAttribute('Type')?.endsWith('/calcChain')) {
    // Resolve through the same checked package relationship resolver as reads.
    const target = relation.getAttribute('Target')!;
    const part = relationshipTarget('xl/workbook.xml', target);
    output.delete(part); rels.documentElement!.removeChild(relation); removedChain = true;
    for (const type of children(types.documentElement!, 'Override')) if (type.getAttribute('PartName') === `/${part}`) types.documentElement!.removeChild(type);
  }
  if (removedChain) { output.set(relsName, writeWorkbookXml(rels)); output.set('[Content_Types].xml', writeWorkbookXml(types)); }
  const main = xmlPart(output, 'xl/workbook.xml'), root = main.documentElement!;
  let calculation = child(root, 'calcPr');
  if (!calculation) {
    calculation = element(main, root, 'calcPr');
    const following = new Set(['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']);
    root.insertBefore(calculation, Array.from(root.childNodes).find(node => node.nodeType === 1 && following.has((node as Element).localName ?? '')) ?? null);
  }
  calculation.setAttribute('fullCalcOnLoad', '1'); calculation.setAttribute('forceFullCalc', '1');
  output.set('xl/workbook.xml', writeWorkbookXml(main));
  return writeWorkbookPackage(output);
}
