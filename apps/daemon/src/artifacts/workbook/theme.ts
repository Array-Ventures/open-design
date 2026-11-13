import { child, xmlPart } from './parts.js';
import { WorkbookFormatError, type WorkbookParts } from './package.js';

/** Office color indexes do not follow the source clrScheme child order. */
export function readWorkbookTheme(parts: WorkbookParts, target: string): string[] {
  const root = xmlPart(parts, target).documentElement;
  if (!root || !['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main'].includes(root.namespaceURI ?? '')) throw new WorkbookFormatError('Invalid workbook color theme.');
  const elements = child(root, 'themeElements'), scheme = elements ? child(elements, 'clrScheme') : undefined;
  if (!scheme) throw new WorkbookFormatError('Workbook color theme is missing.');
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(name => {
    const item = child(scheme, name);
    const rgb = item ? child(item, 'srgbClr')?.getAttribute('val') ?? child(item, 'sysClr')?.getAttribute('lastClr') : undefined;
    if (!rgb || !/^[A-Fa-f0-9]{6}$/.test(rgb)) throw new WorkbookFormatError('Workbook theme color is not supported.', 'WORKBOOK_UNSUPPORTED');
    return `FF${rgb.toUpperCase()}`;
  });
}
