import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalWorkbookJsonValue, canonicalWorkbookSourceModel } from '@open-design/contracts/runtime/workbook-sheet-baseline';
import type { IWorkbookData } from '@univerjs/core';
import type { WorkbookCheckpoint } from './workbook-writer';
import { workbookDraftScopeSchema, workbookGridSnapshotSchema, type WorkbookDraftScope } from './workbook-draft-schema';
import { workbookSaveProvenanceSchema, type WorkbookSaveAcknowledgement } from './save-provenance';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const workbookSourceSnapshotBindingSchema = z.object({ version: z.literal(1), sourceSha256: digest, modelSha256: digest, acknowledgedSha256: digest, receiptSha256: digest, scopeSha256: digest }).strict();
export type WorkbookSourceSnapshotBinding = z.infer<typeof workbookSourceSnapshotBindingSchema>;
const hash = (text: string) => bytesToHex(sha256(new TextEncoder().encode(text)));

/** Accidental-corruption/continuity proof only, NEVER authenticity or a grant.
 * The live Writer calls this only after checked receipt + fresh preview transfer.
 * No source custom metadata or recovered claim can create a checked ACK. */
export function bindWorkbookSourceSnapshot(scope: WorkbookDraftScope, source: WorkbookCheckpoint['source'], acknowledged: IWorkbookData, acknowledgement: WorkbookSaveAcknowledgement): WorkbookSourceSnapshotBinding | undefined {
  if (acknowledgement.kind !== 'history') return undefined;
  const checkedScope = workbookDraftScopeSchema.parse(scope), receipt = workbookSaveProvenanceSchema.parse(acknowledgement.provenance);
  if (receipt.projectId !== checkedScope.projectId || receipt.fileName !== checkedScope.fileName || receipt.targetSha256 !== source.sourceSha256) throw Error('The saved snapshot binding changed source or scope.');
  const snapshotJson = canonicalWorkbookJsonValue(acknowledged); workbookGridSnapshotSchema.parse(acknowledged);
  return workbookSourceSnapshotBindingSchema.parse({ version: 1, sourceSha256: source.sourceSha256,
    modelSha256: hash(canonicalWorkbookSourceModel(source.model)), acknowledgedSha256: hash(snapshotJson),
    receiptSha256: hash(canonicalWorkbookJsonValue(receipt)), scopeSha256: hash(canonicalWorkbookJsonValue(checkedScope)) });
}
export function matchesWorkbookSourceSnapshot(state: WorkbookCheckpoint, scope: WorkbookDraftScope, fresh: WorkbookCheckpoint['source'] | null | undefined): boolean {
  if (!state.sourceSnapshotBinding || !state.sourceAcknowledgement || !fresh) return false;
  try {
    const binding = workbookSourceSnapshotBindingSchema.parse(state.sourceSnapshotBinding);
    const recomputed = bindWorkbookSourceSnapshot(scope, state.source, state.acknowledged, state.sourceAcknowledgement);
    return Boolean(recomputed && canonicalWorkbookJsonValue(binding) === canonicalWorkbookJsonValue(recomputed)
      && fresh.sourceSha256 === binding.sourceSha256 && hash(canonicalWorkbookSourceModel(fresh.model)) === binding.modelSha256);
  } catch { return false; }
}
