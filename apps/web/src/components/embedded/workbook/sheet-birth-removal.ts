import { withWorkbookRemovedConfiguration, type WorkbookSourceDeleteContext } from './sheet-delete-context';
import { assertWorkbookPendingAcknowledgement, type WorkbookSaveAcknowledgement } from './save-provenance';
import { canonicalWorkbookJsonValue } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { IWorkbookData } from '@univerjs/core';
import type { WorkbookCheckpoint } from './workbook-writer';
import { workbookDraftScopeSchema, type WorkbookDraftScope } from './workbook-draft-schema';
import { workbookSheetActionDescriptorSchema, type WorkbookSheetActionDescriptor } from './sheet-action-descriptor';
import { captureWorkbookSavedBirthDeletions, assertWorkbookBirthSource, checkedWorkbookSheetBirths, workbookSheetBirthStateSchema, WORKBOOK_SHEET_BIRTH_MARKER, type WorkbookSheetBirthState } from './sheet-birth-context';
import { bindWorkbookSourceSnapshot, matchesWorkbookSourceSnapshot } from './source-snapshot-binding';
import { workbookBirthRemovalSchema, type WorkbookBirthRemoval } from './sheet-birth-removal-schema';
import { workbookSheetMutationSnapshot } from './sheet-removal-selection';

function scopedBirths(scope: WorkbookDraftScope, state: WorkbookCheckpoint) {
  scope = workbookDraftScopeSchema.parse(scope);
  if (!state.sheetBirths) throw Error('The worksheet has no protected birth pool.');
  const births = checkedWorkbookSheetBirths(state.sheetBirths, state.acknowledged);
  if (births.scope.viewerId !== scope.viewerId || births.scope.projectId !== scope.projectId || births.scope.fileName !== scope.fileName) throw Error('The birth removal scope changed.');
  return births;
}

function creationRoot(state: WorkbookCheckpoint, birthToken: string, selectedId: string) {
  const pending = state.pending;
  if (!pending || pending.snapshot.id !== state.acknowledged.id || pending.intent.plan.sourceSha256 !== state.source.sourceSha256
    || state.source.model.sheets.some(sheet => sheet.id === selectedId) || state.acknowledged.sheets[selectedId]
    || !pending.snapshot.sheetOrder.includes(selectedId)
    || !pending.intent.plan.sheets?.some(sheet => sheet.sheetId === selectedId && sheet.origin === 'new')) throw Error('The birth removal has no exact pending creation root.');
  const birth = state.sheetBirths?.entries.find(item => item.descriptor.token === birthToken);
  if (!birth || birth.descriptor.sheetId !== selectedId
    || canonicalWorkbookJsonValue(pending.snapshot.sheets[selectedId]?.custom?.[WORKBOOK_SHEET_BIRTH_MARKER]) !== canonicalWorkbookJsonValue(birth.descriptor)) throw Error('The frozen creation birth changed.');
  return { operationId: pending.intent.id, sourceSha256: pending.intent.plan.sourceSha256 };
}

/** Validate protected data only. A decoded pool never issues a native command;
 * recovered receipt/template authority and live SDK history remain separate. */
export function checkedWorkbookBirthRemovals(scope: WorkbookDraftScope, state: WorkbookCheckpoint) {
  const births = scopedBirths(scope, state);
  const carried = matchesWorkbookSourceSnapshot(state, scope, state.source);
  for (const removal of births.removals ?? []) {
    const id = removal.descriptor.sheetId;
    if (state.source.model.sheets.some(sheet => sheet.id === id) || state.acknowledged.sheets[id]) throw Error('An unconverted birth removal already exists in the current source.');
    if (removal.captureSourceSha256 !== state.source.sourceSha256 && !carried) throw Error('The unsaved birth removal has no checked current-source continuity.');
    if (removal.kind === 'unsaved') {
      if (state.pending?.snapshot.sheets[id]) throw Error('The unsaved removal must bind to its admitted creation.');
    } else {
      if (canonicalWorkbookJsonValue(removal.creation) !== canonicalWorkbookJsonValue(creationRoot(state, removal.birthToken, id))) throw Error('The protected creation association changed.');
    }
  }
  return births;
}

/** Capture selected desired data before the Writer's durable barrier. The
 * controller must additionally verify the birth's live issuer/history token. */
export function prepareWorkbookBirthRemoval(scope: WorkbookDraftScope, state: WorkbookCheckpoint, rawBirth: WorkbookSheetActionDescriptor) {
  assertWorkbookBirthSource(scope, state);
  const births = checkedWorkbookBirthRemovals(scope, state);
  const origin = workbookSheetActionDescriptorSchema.parse(rawBirth);
  const birth = births.entries.find(item => item.descriptor.token === origin.token);
  if (!birth || canonicalWorkbookJsonValue(birth.descriptor) !== canonicalWorkbookJsonValue(origin)) throw Error('The selected birth origin changed.');
  const id = origin.sheetId, selected = state.desired.sheets[id], index = state.desired.sheetOrder.indexOf(id);
  if (!selected || index < 0 || state.desired.sheetOrder.filter(value => value === id).length !== 1
    || canonicalWorkbookJsonValue(selected.custom?.[WORKBOOK_SHEET_BIRTH_MARKER]) !== canonicalWorkbookJsonValue(origin)
    || state.source.model.sheets.some(sheet => sheet.id === id) || state.acknowledged.sheets[id]) throw Error('The selected worksheet is not an unsaved owned birth.');
  if ((state.sheetDeletions?.length ?? 0) + (births.removals?.length ?? 0) >= 4096) throw Error('The worksheet removal recovery limit was reached.');
  const descriptor = { version: 1 as const, token: crypto.randomUUID(), generation: origin.generation, sheetId: id };
  canonicalWorkbookJsonValue(selected);
  const common = { descriptor, birthToken: origin.token, captureSourceSha256: state.source.sourceSha256, removedSheet: structuredClone(selected), removedIndex: index };
  const removal = workbookBirthRemovalSchema.parse(state.pending?.snapshot.sheets[id]
    ? { ...common, kind: 'pending-target', creation: creationRoot(state, origin.token, id) }
    : { ...common, kind: 'unsaved' });
  const next = workbookSheetBirthStateSchema.parse({ ...births, removals: [...(births.removals ?? []), removal] });
  const after: IWorkbookData = { ...state.desired, sheets: { ...state.desired.sheets }, sheetOrder: state.desired.sheetOrder.filter(value => value !== id) };
  delete after.sheets[id];
  const snapshot = workbookSheetMutationSnapshot(state.desired, after, 'remove', descriptor);
  return { state: next, removal: structuredClone(removal), snapshot };
}

/** Bind all retained unsaved records touched by a newly admitted creation.
 * Preserve their original capture identities/configurations without guessing a
 * future target baseline. The Writer persists pool + pending root together. */
export function bindWorkbookBirthRemovalsToCreation(scope: WorkbookDraftScope, before: WorkbookCheckpoint,
  pending: NonNullable<WorkbookCheckpoint['pending']>): WorkbookSheetBirthState | undefined {
  if (!before.sheetBirths?.removals?.length) return before.sheetBirths;
  const births = checkedWorkbookBirthRemovals(scope, before);
  if (before.pending || pending.acknowledgement || pending.intent.plan.sourceSha256 !== before.source.sourceSha256) throw Error('A new creation cannot replace an existing pending root.');
  const state = { ...before, pending };
  const removals: WorkbookBirthRemoval[] = (births.removals ?? []).map(removal => {
    if (removal.kind !== 'unsaved') throw Error('An earlier creation association is still unresolved.');
    if (!pending.snapshot.sheets[removal.descriptor.sheetId]) return removal;
    return workbookBirthRemovalSchema.parse({ ...removal, kind: 'pending-target', creation: creationRoot(state, removal.birthToken, removal.descriptor.sheetId) });
  });
  const next = workbookSheetBirthStateSchema.parse({ ...births, removals });
  checkedWorkbookBirthRemovals(scope, { ...state, sheetBirths: next });
  return next;
}

/** Convert only after the real target model and checked creation receipt exist.
 * The Writer persists returned contexts, remaining pool and that ACK together
 * before source retirement. A failure leaves all original input roots intact. */
export function convertWorkbookBirthRemovals(scope: WorkbookDraftScope, before: WorkbookCheckpoint,
  target: WorkbookCheckpoint['source'], acknowledgement: WorkbookSaveAcknowledgement) {
  if (!before.sheetBirths?.removals?.length) return { births: before.sheetBirths, contexts: [] as WorkbookSourceDeleteContext[] };
  const births = checkedWorkbookBirthRemovals(scope, before);
  assertWorkbookPendingAcknowledgement(scope, before, target, acknowledgement);
  if (!before.pending) throw Error('The protected pending root is unavailable.');
  const targets = (births.removals ?? []).filter((removal): removal is Extract<WorkbookBirthRemoval, { kind: 'pending-target' }> => removal.kind === 'pending-target');
  const captured = targets.length ? captureWorkbookSavedBirthDeletions(scope, before, target, acknowledgement, targets.map(value => value.descriptor)) : [];
  const contexts = captured.map((context, index) => {
    const removal = targets[index]!;
    return withWorkbookRemovedConfiguration({ ...context, birthOrigin: {
      birthToken: removal.birthToken, captureSourceSha256: removal.captureSourceSha256, creation: removal.creation,
    } }, removal.removedSheet, removal.removedIndex);
  });
  const remaining = (births.removals ?? []).filter(removal => removal.kind === 'unsaved');
  const { removals: _previous, ...base } = births;
  const next = workbookSheetBirthStateSchema.parse({ ...base, ...(remaining.length ? { removals: remaining } : {}) });
  const binding = bindWorkbookSourceSnapshot(scope, target, before.pending.snapshot, acknowledgement);
  checkedWorkbookBirthRemovals(scope, { ...before, source: target, acknowledged: before.pending.snapshot,
    pending: null, sourceAcknowledgement: acknowledgement, sourceSnapshotBinding: binding, sheetBirths: next,
  });
  return { births: next, contexts };
}
