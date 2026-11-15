import type { Element } from '@xmldom/xmldom';
import { WORKBOOK_MODEL_LIMITS } from '@open-design/contracts/runtime/workbook';
import { child, children } from './parts.js';
import { WorkbookFormatError } from './package.js';

/** Resolve only alignment inheritance. Returned nodes remain owned by the
 * caller's parsed document; writers must clone before changing them. */
export function workbookAlignmentResolver(root: Element): (xf: Element) => Element | undefined {
  const parentTables = children(root, 'cellStyleXfs');
  if (parentTables.length > 1) throw new WorkbookFormatError('Ambiguous parent workbook styles.');
  const parents = parentTables[0] ? children(parentTables[0], 'xf') : [];
  if (parents.length > WORKBOOK_MODEL_LIMITS.styles) throw new WorkbookFormatError('Too many parent workbook styles.', 'WORKBOOK_LIMIT');
  const alignment = (xf: Element) => {
    const entries = children(xf, 'alignment');
    if (entries.length > 1) throw new WorkbookFormatError('Ambiguous workbook alignment.');
    return entries[0];
  };
  const count = parentTables[0]?.getAttribute('count');
  if (count !== null && count !== undefined && (!/^(0|[1-9][0-9]*)$/.test(count) || Number(count) !== parents.length)) throw new WorkbookFormatError('Workbook parent style count does not match its components.');
  const parentAlignments = parents.map(alignment);
  return xf => {
    const apply = xf.getAttribute('applyAlignment');
    if (apply !== null && !['0', 'false', '1', 'true'].includes(apply)) throw new WorkbookFormatError('Invalid alignment application flag.');
    const local = alignment(xf);
    let inherited: Element | undefined;
    if (xf.hasAttribute('xfId')) {
      const id = xf.getAttribute('xfId')!;
      if (!/^(0|[1-9][0-9]*)$/.test(id) || !Number.isSafeInteger(Number(id)) || !parents[Number(id)]) throw new WorkbookFormatError('Workbook alignment parent is missing.');
      inherited = parentAlignments[Number(id)];
    }
    // Existing files commonly omit applyAlignment for a local alignment.
    // Explicit false preserves the named-style alignment instead of activating
    // dormant local wrap/rotation/etc when horizontal alone is edited.
    return apply === '0' || apply === 'false' ? inherited : local ?? inherited;
  };
}

/** Materialize the resolved alignment without changing the other XF fields. */
export function setWorkbookAlignment(xf: Element, alignment: Element | undefined): void {
  const previous = child(xf, 'alignment');
  const replacement = alignment?.cloneNode(true) as Element | undefined;
  if (previous && replacement) xf.replaceChild(replacement, previous);
  else if (previous) xf.removeChild(previous);
  else if (replacement) xf.insertBefore(replacement, child(xf, 'protection') ?? child(xf, 'extLst') ?? null);
}
