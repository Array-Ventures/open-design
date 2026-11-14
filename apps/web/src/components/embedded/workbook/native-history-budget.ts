import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import { MAX_WORKBOOK_DRAFT_BYTES, MAX_WORKBOOK_SHEET_CONTEXTS } from './workbook-draft-limits';

/** Serialized resource accounting only; a measured payload grants no action.
 * Per-entry commas are conservatively charged even for the first array entry. */
export function admitWorkbookNativeIssuer(count: number, bytes: number, data: unknown) {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_WORKBOOK_SHEET_CONTEXTS
    || !Number.isSafeInteger(bytes) || bytes < 2 || bytes > MAX_WORKBOOK_DRAFT_BYTES) throw Error('The native worksheet issuer accounting changed.');
  if (count >= MAX_WORKBOOK_SHEET_CONTEXTS) throw Error('The native worksheet history exceeds its protected retention limit.');
  const charge = new TextEncoder().encode(canonicalWorkbookJsonValue(data)).byteLength + 1;
  const total = bytes + charge;
  if (total > MAX_WORKBOOK_DRAFT_BYTES) throw Error('The native worksheet history exceeds its protected retention limit.');
  return { charge, total };
}
