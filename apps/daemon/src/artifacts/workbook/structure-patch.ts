import type { Document, Element } from '@xmldom/xmldom';
import { WORKBOOK_MODEL_LIMITS } from '@open-design/contracts/runtime/workbook';
import { workbookAxisProjection, type WorkbookAxisProjection } from '@open-design/contracts/runtime/workbook-structure';
import type { ReadWorkbook } from './reader.js';
import { address, child, children, range, relationships, xmlPart } from './parts.js';
import { WorkbookFormatError, writeWorkbookPackage } from './package.js';
import { writeWorkbookXml } from './xml.js';
import { workbookStructuralFormula, type WorkbookSheetProjection } from './structure-formulas.js';

export interface WorkbookStructureEdit { sheetId: string; rows: readonly (number | null)[]; columns: readonly (number | null)[] }
const unsupported = (message: string): never => { throw new WorkbookFormatError(message, 'WORKBOOK_UNSUPPORTED'); };
function elements(parent: Element): Element[] { return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1); }
function cellName(row: number, column: number) {
  let letters = ''; for (let n = column + 1; n; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  return `${letters}${row + 1}`;
}
function rangeName(bounds: { startRow: number; endRow: number; startColumn: number; endColumn: number }) {
  const start = cellName(bounds.startRow, bounds.startColumn), end = cellName(bounds.endRow, bounds.endColumn); return start === end ? start : `${start}:${end}`;
}
function projectedRange(value: string, projection: WorkbookSheetProjection) {
  const original = range(value), rows = projection.rows.interval(original.startRow, original.endRow), columns = projection.columns.interval(original.startColumn, original.endColumn);
  return !rows || !columns ? null : { startRow: rows[0], endRow: rows[1], startColumn: columns[0], endColumn: columns[1] };
}
/** Fail closed before offering structural commands, and repeat this inspection
 * inside the contained writer. Unknown coordinate owners cannot be preserved by
 * merely shifting cells. These exclusions are deliberate capability boundaries. */
export function assertWorkbookStructureSupported(source: ReadWorkbook): void {
  const book = xmlPart(source.parts, 'xl/workbook.xml').documentElement!;
  const owned = new Set(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', ...source.sheetParts.values()]);
  for (const link of relationships(source.parts, 'xl/workbook.xml').values()) {
    if (link.external || !['worksheet', 'styles', 'theme', 'sharedStrings', 'calcChain'].some(kind => link.type.endsWith(`/${kind}`))) unsupported('This workbook relationship has no structural owner.');
    owned.add(link.target);
  }
  // Preserving unknown ZIP members byte-for-byte is insufficient if they may
  // contain coordinates pointing into a moved worksheet. Admit only standard
  // non-coordinate document properties and the explicitly owned parts above.
  for (const part of source.parts.keys()) if (!owned.has(part) && !part.startsWith('docProps/')) unsupported('This workbook package has unowned structural metadata.');
  const features = source.model.features;
  const bookChildren = new Set(['fileVersion', 'workbookPr', 'bookViews', 'sheets', 'definedNames', 'calcPr']);
  if (elements(book).some(node => node.namespaceURI !== book.namespaceURI || !bookChildren.has(node.localName!))) unsupported('This workbook has unsupported structural metadata.');
  const names = child(book, 'definedNames'); if (names && elements(names).length) unsupported('Defined names need a qualified structural writer.');
  if (features.macros || features.signed || features.charts || features.drawings || features.externalLinks || source.model.definedNames?.length || source.model.tables?.length || child(book, 'workbookProtection') || child(book, 'customWorkbookViews')) unsupported('This workbook has reference-bearing features without a structural writer.');
  if ([...source.parts.keys()].some(name => /^(?:_xmlsignatures\/|xl\/(?:tables|drawings|charts|comments|threadedComments|pivot|externalLinks|metadata))/i.test(name))) unsupported('This workbook package has unsupported structural references.');
  for (const part of source.sheetParts.values()) {
    const root = xmlPart(source.parts, part).documentElement!;
    const allowed = new Set(['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'mergeCells', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter']);
    if (elements(root).some(node => node.namespaceURI !== root.namespaceURI || !allowed.has(node.localName!))) unsupported('This worksheet has unsupported structural metadata.');
    const properties = child(root, 'sheetPr');
    if (properties && elements(properties).some(node => node.namespaceURI !== root.namespaceURI || !['tabColor', 'outlinePr', 'pageSetUpPr'].includes(node.localName!))) unsupported('Extended worksheet properties need a structural writer.');
    for (const [group, expected] of [['cols', 'col'], ['mergeCells', 'mergeCell'], ['sheetViews', 'sheetView']] as const) {
      const container = child(root, group); if (container && elements(container).some(node => node.namespaceURI !== root.namespaceURI || node.localName !== expected)) unsupported('Extended worksheet metadata needs a structural writer.');
    }
    const views = child(root, 'sheetViews');
    for (const view of views ? children(views, 'sheetView') : []) {
      for (const node of [view, ...children(view, 'selection')]) {
        for (const attribute of ['topLeftCell', 'activeCell']) if (node.hasAttribute(attribute)) address(node.getAttribute(attribute)!);
        if (node.hasAttribute('sqref')) { const refs = node.getAttribute('sqref')!.trim().split(/\s+/); if (refs.length > 4096) unsupported('Structural selection exceeds its limit.'); for (const ref of refs) range(ref); }
      }
      if (child(view, 'pane')) unsupported('Frozen and split panes need a qualified structural view writer.');
      if (elements(view).some(node => node.localName !== 'selection' || node.namespaceURI !== root.namespaceURI)) unsupported('This worksheet view cannot be structurally edited.');
    }
    const data = child(root, 'sheetData');
    for (const row of data ? children(data, 'row') : []) {
      if (elements(row).some(node => node.localName !== 'c' || node.namespaceURI !== root.namespaceURI)) unsupported('Extended row metadata cannot be structurally edited.');
      for (const cell of children(row, 'c')) {
        if (elements(cell).some(node => node.namespaceURI !== root.namespaceURI || !['f', 'v', 'is'].includes(node.localName!))) unsupported('Extended cell metadata needs a structural writer.');
        const formula = child(cell, 'f');
        if (formula && (formula.hasAttribute('t') && formula.getAttribute('t') !== 'normal' || formula.hasAttribute('ref') || formula.hasAttribute('si')) || cell.hasAttribute('cm') || cell.hasAttribute('vm') || child(cell, 'extLst')) unsupported('Array, shared or extended cells need a qualified structural writer.');
      }
    }
  }
  // Even otherwise untouched formula cells can refer to a moved sheet. The
  // pinned lexer rejects named/table/external/unknown references independently.
  const identity = new Map<string, WorkbookSheetProjection>();
  for (const sheet of source.model.sheets) for (const cell of sheet.cells) if (cell.formula) workbookStructuralFormula(cell.formula, sheet.id, source.model.sheets, identity);
}
function projectionFor(source: ReadWorkbook, edits: readonly WorkbookStructureEdit[]) {
  const result = new Map<string, WorkbookSheetProjection>(); let axes = 0;
  for (const edit of edits) {
    const sheet = source.model.sheets.find(sheet => sheet.id === edit.sheetId);
    if (!sheet || result.has(edit.sheetId)) throw new WorkbookFormatError('Invalid or duplicate structural worksheet identity.');
    axes += sheet.rowCount + sheet.columnCount + edit.rows.length + edit.columns.length;
    if (axes > 200_000) throw new WorkbookFormatError('Structural identity budget exceeded.', 'WORKBOOK_LIMIT');
    result.set(sheet.id, { rows: workbookAxisProjection(sheet.rowCount, edit.rows, WORKBOOK_MODEL_LIMITS.rows), columns: workbookAxisProjection(sheet.columnCount, edit.columns, WORKBOOK_MODEL_LIMITS.columns) });
  }
  return result;
}
function nearest(index: number, projection: WorkbookAxisProjection): number {
  return Math.min(projection.targetCount - 1, projection.point(index) ?? projection.interval(index, projection.sourceCount - 1)?.[0] ?? projection.targetCount - 1);
}
function patchViews(root: Element, projection: WorkbookSheetProjection) {
  const views = child(root, 'sheetViews');
  for (const view of views ? children(views, 'sheetView') : []) {
    for (const node of [view, ...children(view, 'selection')]) {
      for (const attribute of ['topLeftCell', 'activeCell']) if (node.hasAttribute(attribute)) {
        const old = address(node.getAttribute(attribute)!); node.setAttribute(attribute, cellName(nearest(old.row, projection.rows), nearest(old.column, projection.columns)));
      }
      if (node.hasAttribute('sqref')) {
        const values = node.getAttribute('sqref')!.trim().split(/\s+/); if (values.length > 4096) throw new WorkbookFormatError('Structural selection exceeds its limit.', 'WORKBOOK_LIMIT');
        const next = values.map(value => projectedRange(value, projection)).filter((value): value is NonNullable<typeof value> => value !== null).map(rangeName);
        if (!next.length) next.push(node.getAttribute('activeCell') ?? 'A1'); node.setAttribute('sqref', next.join(' '));
        // activeCellId indexes sqref, not source geometry; removing ranges must
        // not leave a stale index into the shortened selection list.
        const active = node.hasAttribute('activeCell') ? address(node.getAttribute('activeCell')!) : null;
        let selected = active ? next.findIndex(value => { const bounds = range(value); return active.row >= bounds.startRow && active.row <= bounds.endRow && active.column >= bounds.startColumn && active.column <= bounds.endColumn; }) : 0;
        if (selected < 0) { selected = 0; const first = range(next[0]!); node.setAttribute('activeCell', cellName(first.startRow, first.startColumn)); }
        if (node.hasAttribute('activeCellId')) node.setAttribute('activeCellId', String(selected));
      }
    }
  }
}
/** Transform only owned worksheet XML; retain every unrelated ZIP member byte
 * for byte. Source content/style IDs and rich/shared strings move with cells.
 * This primitive is not persisted until calculation and the existing CAS save. */
export async function patchWorkbookStructure(source: ReadWorkbook, edits: readonly WorkbookStructureEdit[]): Promise<Buffer> {
  assertWorkbookStructureSupported(source); const projections = projectionFor(source, edits), output = new Map(source.parts);
  for (const sheet of source.model.sheets) {
    const part = source.sheetParts.get(sheet.id)!, document: Document = xmlPart(source.parts, part), root = document.documentElement!, projection = projections.get(sheet.id);
    const data = child(root, 'sheetData'); let changed = Boolean(projection), previousRow = -1;
    for (const row of data ? children(data, 'row') : []) {
      const originalRow = row.hasAttribute('r') ? Number(row.getAttribute('r')) - 1 : previousRow + 1; previousRow = originalRow;
      const targetRow = projection ? projection.rows.point(originalRow) : originalRow;
      if (targetRow === null) { data!.removeChild(row); continue; }
      let previousColumn = -1;
      for (const cell of children(row, 'c')) {
        const position = cell.hasAttribute('r') ? address(cell.getAttribute('r')!) : { row: originalRow, column: previousColumn + 1 }; previousColumn = position.column;
        const targetColumn = projection ? projection.columns.point(position.column) : position.column;
        if (targetColumn === null) { row.removeChild(cell); continue; }
        if (projection) cell.setAttribute('r', cellName(targetRow, targetColumn));
        const formula = child(cell, 'f');
        if (formula) {
          const original = `=${formula.textContent ?? ''}`, next = workbookStructuralFormula(original, sheet.id, source.model.sheets, projections);
          if (next !== original) { formula.textContent = next.slice(1); changed = true; }
          // Structural references and position-sensitive functions must not
          // retain old cached values before the contained calculator runs.
          if (projections.size) { const value = child(cell, 'v'); if (value) cell.removeChild(value); changed = true; }
        }
      }
      if (projection) { row.setAttribute('r', String(targetRow + 1)); row.removeAttribute('spans'); }
    }
    if (projection) {
      const dimension = child(root, 'dimension'); if (dimension) root.removeChild(dimension);
      const cols = child(root, 'cols');
      for (const column of cols ? children(cols, 'col') : []) {
        const start = Number(column.getAttribute('min')) - 1, end = Number(column.getAttribute('max')) - 1;
        const segments: [number, number][] = [];
        // New columns inherit only the SDK's explicit width, not the source
        // range's hidden/style/outline attributes. Preserve those on retained
        // source columns and split at genuinely inserted coordinates.
        for (let index = start; index <= end; index++) {
          const next = projection.columns.point(index); if (next === null) continue;
          const last = segments.at(-1); if (last && next === last[1] + 1) last[1] = next; else segments.push([next, next]);
        }
        for (const [low, high] of segments) { const copy = column.cloneNode(true) as Element; copy.setAttribute('min', String(low + 1)); copy.setAttribute('max', String(high + 1)); cols!.insertBefore(copy, column); }
        cols!.removeChild(column);
      }
      const merges = child(root, 'mergeCells');
      for (const merge of merges ? children(merges, 'mergeCell') : []) {
        const before = range(merge.getAttribute('ref')!), next = projectedRange(merge.getAttribute('ref')!, projection);
        // Deleting the anchor must never move hidden merged-follower content
        // into the new anchor. Until the pinned SDK/source agreement is proven,
        // reject this operation instead of silently changing visible content.
        if (next && (projection.rows.point(before.startRow) === null || projection.columns.point(before.startColumn) === null)) unsupported('Deleting a merged anchor needs a qualified structural writer.');
        if (!next || next.startRow === next.endRow && next.startColumn === next.endColumn) merges!.removeChild(merge); else merge.setAttribute('ref', rangeName(next));
      }
      if (merges) { const count = children(merges, 'mergeCell').length; if (count) merges.setAttribute('count', String(count)); else root.removeChild(merges); }
      patchViews(root, projection);
    }
    if (changed) output.set(part, writeWorkbookXml(document));
  }
  return writeWorkbookPackage(output);
}
