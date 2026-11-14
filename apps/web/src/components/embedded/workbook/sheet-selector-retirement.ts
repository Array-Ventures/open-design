import type { IWorkbookData } from '@univerjs/core';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { WorkbookCheckpoint } from './workbook-writer';
import type { WorkbookDraftScope } from './workbook-draft-schema';
import type { WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { WORKBOOK_SHEET_REMOVALS, workbookSheetRemovalSelection } from './sheet-removal-selection';
import { workbookProtectedRootRetirement, type WorkbookNativeRoot } from './sheet-root-retirement';
import { bindWorkbookSourceSnapshot, matchesWorkbookSourceSnapshot } from './source-snapshot-binding';
import { workbookGridPlan } from './grid-plan';

export function withoutWorkbookRemovalTokens(book: IWorkbookData, tokens: ReadonlySet<string>): IWorkbookData {
  const generation = book.custom?.evebotStructureOwner?.generation;
  const entries = Object.fromEntries(Object.entries(workbookSheetRemovalSelection(book, typeof generation === 'string' ? generation : ''))
    .filter(([, token]) => !tokens.has(token)));
  const next = structuredClone(book);
  next.custom = { ...next.custom };
  if (Object.keys(entries).length) next.custom[WORKBOOK_SHEET_REMOVALS] = { version: 1, generation, entries };
  else delete next.custom[WORKBOOK_SHEET_REMOVALS];
  return next;
}

/** Replace only the checked workbook removal-map field, preserving all other
 * live or Writer data (including edits made after an IDB apply callback). */
export function copyWorkbookRemovalMap(target: IWorkbookData, source: IWorkbookData): IWorkbookData {
  const next = structuredClone(target);
  next.custom = { ...next.custom };
  const value = source.custom?.[WORKBOOK_SHEET_REMOVALS];
  if (value === undefined) delete next.custom[WORKBOOK_SHEET_REMOVALS];
  else next.custom[WORKBOOK_SHEET_REMOVALS] = structuredClone(value);
  return next;
}

/** Proposed data only. The controller must additionally own every candidate
 * descriptor and the exact native/SDK lifetime at the guarded commit. */
export function prepareWorkbookSelectorRetirement(scope: WorkbookDraftScope, state: WorkbookCheckpoint,
  live: IWorkbookData, native: readonly WorkbookNativeRoot[], owns: (descriptor: WorkbookSheetActionDescriptor) => boolean) {
  const pool = [...(state.sheetDeletions ?? []), ...(state.sheetBirths?.removals ?? [])];
  const allOrigins = [...pool, ...(state.sheetBirths?.entries ?? [])];
  const possible = new Map<string, WorkbookSheetActionDescriptor>();
  for (const book of [live, state.acknowledged, state.desired]) {
    const generation = book.custom?.evebotStructureOwner?.generation;
    for (const [id, token] of Object.entries(workbookSheetRemovalSelection(book, typeof generation === 'string' ? generation : ''))) {
      if (state.source.model.sheets.some(sheet => sheet.id === id) || [live, state.acknowledged, state.desired].some(snapshot => snapshot.sheets[id])
        || state.pending?.snapshot.sheets[id] || state.pending?.intent.plan.sheets?.some(sheet => sheet.sheetId === id)
        || native.some(root => root.reachable && root.descriptor.sheetId === id)) continue;
      const context = pool.find(value => value.descriptor.token === token && value.descriptor.sheetId === id);
      if (context && owns(context.descriptor)) possible.set(token, context.descriptor);
    }
  }
  const propose = (tokens: ReadonlySet<string>) => ({ ...state,
    acknowledged: withoutWorkbookRemovalTokens(state.acknowledged, tokens),
    desired: withoutWorkbookRemovalTokens(state.desired, tokens),
  });
  const ignored = new Set(possible.keys());
  const withoutCandidates = propose(ignored);
  const roots = workbookProtectedRootRetirement(withoutCandidates, withoutWorkbookRemovalTokens(live, ignored), native);
  for (const [token, descriptor] of possible) if (allOrigins.some(origin => origin.descriptor.sheetId === descriptor.sheetId && roots.retained.has(origin.descriptor.token))) possible.delete(token);
  const tokens = new Set(possible.keys());
  const next = propose(tokens);
  const nextLive = withoutWorkbookRemovalTokens(live, tokens);
  if (canonicalWorkbookJsonValue(next.acknowledged) !== canonicalWorkbookJsonValue(state.acknowledged)) {
    if (!state.sourceSnapshotBinding || !state.sourceAcknowledgement || !matchesWorkbookSourceSnapshot(state, scope, state.source)) throw Error('Selector retirement needs the existing checked source binding.');
    next.sourceSnapshotBinding = bindWorkbookSourceSnapshot(scope, state.source, next.acknowledged, state.sourceAcknowledgement);
  }
  const reduced = workbookProtectedRootRetirement(next, nextLive, native);
  if (reduced.births) next.sheetBirths = reduced.births;
  if (reduced.deletions.length) next.sheetDeletions = reduced.deletions;
  else delete next.sheetDeletions;
  const plan = (checkpoint: WorkbookCheckpoint) => workbookGridPlan(checkpoint.source.model, checkpoint.source.sourceSha256,
    checkpoint.acknowledged, checkpoint.desired, { scope, pending: checkpoint.pending, deletions: checkpoint.sheetDeletions, births: checkpoint.sheetBirths,
      ...(checkpoint.sourceAcknowledgement && checkpoint.sourceSnapshotBinding ? { sourceOwner: { scope, acknowledgement: checkpoint.sourceAcknowledgement, binding: checkpoint.sourceSnapshotBinding } } : {}),
    });
  if (canonicalWorkbookJsonValue(plan(state)) !== canonicalWorkbookJsonValue(plan(next))) throw Error('Selector retirement changed the workbook edit plan.');
  return { checkpoint: next, live: nextLive, descriptors: [...possible.values()], retained: reduced.retained };
}
