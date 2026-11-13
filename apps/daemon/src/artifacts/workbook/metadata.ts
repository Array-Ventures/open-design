import type { Element } from '@xmldom/xmldom';
import type { WorkbookDefinedName, WorkbookSheet, WorkbookTable } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError, type WorkbookParts } from './package.js';
import { child, children, MAIN_NAMESPACES, range, relationships, xmlPart } from './parts.js';

function count(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (value === '0') return 0;
  if (value === '1') return 1;
  throw new WorkbookFormatError('Workbook table header or totals count is unsupported.', 'WORKBOOK_UNSUPPORTED');
}
function relationshipId(node: Element): string | null {
  return node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    ?? node.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships', 'id');
}
export function readWorkbookMetadata(parts: WorkbookParts, main: Element, sheets: WorkbookSheet[], sheetParts: Map<string, string>): { definedNames: WorkbookDefinedName[]; tables: WorkbookTable[] } {
  const definedNames: WorkbookDefinedName[] = [], tables: WorkbookTable[] = [];
  const names = child(main, 'definedNames');
  for (const node of names ? children(names, 'definedName') : []) {
    if (definedNames.length >= 4096) throw new WorkbookFormatError('Workbook has too many defined names.', 'WORKBOOK_LIMIT');
    const local = node.getAttribute('localSheetId');
    let sheetId: string | undefined;
    if (local !== null) {
      if (!/^[0-9]+$/.test(local) || !sheets[Number(local)]) throw new WorkbookFormatError('Defined name targets an invalid sheet scope.');
      sheetId = sheets[Number(local)]!.id;
    }
    const hidden = node.getAttribute('hidden');
    if (hidden !== null && !['0', '1', 'false', 'true'].includes(hidden)) throw new WorkbookFormatError('Invalid defined name visibility.');
    definedNames.push({ name: node.getAttribute('name') ?? '', formula: node.textContent ?? '', ...(sheetId ? { sheetId } : {}), ...(hidden !== null ? { hidden: hidden === '1' || hidden === 'true' } : {}) });
  }
  const seenParts = new Set<string>();
  for (const sheet of sheets) {
    const part = sheetParts.get(sheet.id)!, root = xmlPart(parts, part).documentElement!, tableParts = child(root, 'tableParts');
    if (!tableParts) continue;
    const relations = relationships(parts, part);
    for (const node of children(tableParts, 'tablePart')) {
      if (tables.length >= 1024) throw new WorkbookFormatError('Workbook has too many tables.', 'WORKBOOK_LIMIT');
      const id = relationshipId(node), relation = id ? relations.get(id) : undefined;
      if (!relation || relation.external || !relation.type.endsWith('/table') || seenParts.has(relation.target)) throw new WorkbookFormatError('Invalid workbook table relationship.');
      seenParts.add(relation.target);
      const table = xmlPart(parts, relation.target).documentElement!;
      if (table.localName !== 'table' || !MAIN_NAMESPACES.has(table.namespaceURI ?? '')) throw new WorkbookFormatError('Invalid workbook table root.');
      const columns = child(table, 'tableColumns'), bounds = range(table.getAttribute('ref') ?? '');
      tables.push({ name: table.getAttribute('displayName') ?? table.getAttribute('name') ?? '', sheetId: sheet.id, range: bounds,
        columns: columns ? children(columns, 'tableColumn').map(column => column.getAttribute('name') ?? '') : [],
        header: count(table.getAttribute('headerRowCount'), 1) === 1, totals: count(table.getAttribute('totalsRowCount'), 0) === 1 });
      sheet.rowCount = Math.max(sheet.rowCount, bounds.endRow + 1); sheet.columnCount = Math.max(sheet.columnCount, bounds.endColumn + 1);
    }
  }
  return { definedNames, tables };
}
