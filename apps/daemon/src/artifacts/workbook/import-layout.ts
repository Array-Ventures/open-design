import type { WorkbookParts } from './package.js';
import { WorkbookFormatError } from './package.js';

type Relationship = { type: string; target: string; external: boolean };

/** The pinned importer and several source-preserving writers require canonical
 * part names. Refuse layouts where relationship-selected owners differ
 * instead of combining one part's strings/styles with another part's cells.
 * Relocated OPC layouts need an import-only normalized package before admission. */
export function assertWorkbookImportLayout(parts: WorkbookParts, mainPart: string, links: ReadonlyMap<string, Relationship>): void {
  const unsupported = () => new WorkbookFormatError('This workbook uses a relocated or ambiguous importer part. Its source has not changed.', 'WORKBOOK_UNSUPPORTED');
  if (mainPart !== 'xl/workbook.xml') throw unsupported();
  if ([...links.values()].filter(link => link.type.endsWith('/theme')).length > 1) throw unsupported();
  for (const [kind, expected] of [['sharedStrings', 'xl/sharedStrings.xml'], ['styles', 'xl/styles.xml']] as const) {
    const matching = [...links.values()].filter(link => link.type.endsWith(`/${kind}`));
    if (matching.length > 1) throw unsupported();
    const link = matching[0];
    if (link && (link.external || link.target !== expected)) throw unsupported();
    // ExcelJS reads a canonical orphan even without an owning relationship.
    if (!link && parts.has(expected)) throw unsupported();
    if (link && !parts.has(expected)) throw new WorkbookFormatError('Workbook relationship points to a missing importer part.');
  }
  for (const link of links.values()) if (link.type.endsWith('/worksheet')) {
    if (link.external || !parts.has(link.target)) throw new WorkbookFormatError('Invalid workbook sheet relationship.');
    if (!/^xl\/worksheets\/sheet[1-9][0-9]*\.xml$/.test(link.target)) throw unsupported();
  }
}
