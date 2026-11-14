import type { IWorkbookData } from '@univerjs/core';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { WorkbookCheckpoint } from './workbook-writer';
import { workbookSheetActionDescriptorSchema, type WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { WORKBOOK_SHEET_BIRTH_MARKER } from './sheet-birth-context';
import { WORKBOOK_SHEET_DELETE_MARKER, workbookSourceDeletionTemplate } from './sheet-delete-context';
import { workbookSheetRemovalSelection } from './sheet-removal-selection';

export interface WorkbookNativeRoot {
  descriptor: WorkbookSheetActionDescriptor;
  reachable: boolean;
  sheets: readonly unknown[];
}

/** Retention data only. Native reachability and private issuance must be proved
 * by the live controller; this function cannot authorize an SDK command. */
export function workbookProtectedRootRetirement(state: WorkbookCheckpoint, live: IWorkbookData, native: readonly WorkbookNativeRoot[]) {
  const pools = [...(state.sheetBirths?.entries ?? []), ...(state.sheetBirths?.removals ?? []), ...(state.sheetDeletions ?? [])];
  const byToken = new Map(pools.map(value => [value.descriptor.token, value]));
  if (byToken.size !== pools.length) throw Error('Protected worksheet root identities are ambiguous.');
  const retained = new Set<string>();
  const queue: string[] = [];
  const keep = (token: string) => { if (!retained.has(token)) { retained.add(token); queue.push(token); } };
  const descriptor = (raw: unknown) => {
    if (raw === undefined) return;
    const value = workbookSheetActionDescriptorSchema.parse(raw);
    const pool = byToken.get(value.token);
    if (!pool || canonicalWorkbookJsonValue(pool.descriptor) !== canonicalWorkbookJsonValue(value)) throw Error('A worksheet snapshot lost its protected origin.');
    keep(value.token);
  };
  const sheet = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('The worksheet root configuration is invalid.');
    const custom = (raw as { custom?: unknown }).custom;
    if (custom === undefined) return;
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) throw Error('The worksheet root metadata is invalid.');
    const metadata = custom as Record<string, unknown>;
    descriptor(metadata[WORKBOOK_SHEET_BIRTH_MARKER]);
    descriptor(metadata[WORKBOOK_SHEET_DELETE_MARKER]);
  };
  const snapshot = (book: IWorkbookData) => {
    if (book.id !== state.acknowledged.id) throw Error('The worksheet root belongs to another workbook.');
    for (const value of Object.values(book.sheets)) sheet(value);
    const generation = book.custom?.evebotStructureOwner?.generation;
    for (const token of Object.values(workbookSheetRemovalSelection(book, typeof generation === 'string' ? generation : ''))) {
      if (!byToken.has(token)) throw Error('A worksheet removal lost its protected origin.');
      keep(token);
    }
  };
  for (const book of [live, state.acknowledged, state.desired, ...(state.pending ? [state.pending.snapshot] : [])]) snapshot(book);
  const privateRoots = new Map(native.map(value => [value.descriptor.token, value]));
  if (privateRoots.size !== native.length) throw Error('Private worksheet roots are ambiguous.');
  for (const root of native) if (root.reachable) keep(root.descriptor.token);
  if (state.pending) {
    // Receipt conversion associates every eligible pre-save context, not just
    // the context selected by the currently visible desired branch.
    for (const context of state.sheetDeletions ?? []) if (!context.receiptAssociation && context.sourceSha256 === state.pending.intent.plan.sourceSha256) keep(context.descriptor.token);
    for (const removal of state.sheetBirths?.removals ?? []) if (removal.kind === 'pending-target'
      && removal.creation.operationId === state.pending.intent.id && removal.creation.sourceSha256 === state.pending.intent.plan.sourceSha256) keep(removal.descriptor.token);
    for (const projection of state.pending.intent.plan.sheets ?? []) if (projection.origin === 'restore') {
      const matches = (state.sheetDeletions ?? []).filter(context => context.descriptor.sheetId === projection.sheetId && context.receiptAssociation
        && canonicalWorkbookJsonValue(workbookSourceDeletionTemplate(context)) === canonicalWorkbookJsonValue(projection.template));
      if (!matches.length) throw Error('The pending worksheet template lost its retained root.');
      for (const context of matches) keep(context.descriptor.token);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const token = queue[index]!;
    for (const value of privateRoots.get(token)?.sheets ?? []) sheet(value);
    const value = byToken.get(token);
    if (!value) continue; // A private native Rename has no durable pool record.
    if ('birthToken' in value) keep(value.birthToken);
    if ('birthOrigin' in value && value.birthOrigin) keep(value.birthOrigin.birthToken);
    if ('initialSheet' in value) sheet(value.initialSheet);
    if ('acknowledgedSheet' in value) sheet(value.acknowledgedSheet);
    if ('removedSheet' in value && value.removedSheet) sheet(value.removedSheet);
  }
  // Preserve the birth scope, axis owner and high-water ID even when empty.
  // No future issuer may reuse a retired numeric sheet identity.
  const births = state.sheetBirths && { ...state.sheetBirths,
    entries: state.sheetBirths.entries.filter(value => retained.has(value.descriptor.token)),
    ...(state.sheetBirths.removals ? { removals: state.sheetBirths.removals.filter(value => retained.has(value.descriptor.token)) } : {}),
  };
  const deletions = (state.sheetDeletions ?? []).filter(value => retained.has(value.descriptor.token));
  return { retained, births, deletions };
}
