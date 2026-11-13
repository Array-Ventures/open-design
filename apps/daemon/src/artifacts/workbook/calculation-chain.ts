import { children, relationshipTarget, xmlPart } from './parts.js';
import { writeWorkbookXml } from './xml.js';

/** Coordinate/content writers invalidate this derived owner. Resolve through
 * the same checked relationships as reads, and preserve unrelated ZIP parts. */
export function removeWorkbookCalculationChain(output: Map<string, Buffer>): void {
  const relsName = 'xl/_rels/workbook.xml.rels';
  const rels = xmlPart(output, relsName), types = xmlPart(output, '[Content_Types].xml');
  let removed = false;
  for (const relation of children(rels.documentElement!, 'Relationship')) if (relation.getAttribute('Type')?.endsWith('/calcChain')) {
    const part = relationshipTarget('xl/workbook.xml', relation.getAttribute('Target')!);
    output.delete(part); rels.documentElement!.removeChild(relation); removed = true;
    for (const type of children(types.documentElement!, 'Override')) if (type.getAttribute('PartName') === `/${part}`) types.documentElement!.removeChild(type);
  }
  if (removed) {
    output.set(relsName, writeWorkbookXml(rels));
    output.set('[Content_Types].xml', writeWorkbookXml(types));
  }
}
