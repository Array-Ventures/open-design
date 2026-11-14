import { checkedWorkbookSaveAcknowledgement } from '../../src/components/embedded/workbook/save-provenance';
import type { WorkbookCheckpoint, WorkbookWriteIntent } from '../../src/components/embedded/workbook/workbook-writer';
import type { WorkbookDraftScope } from '../../src/components/embedded/workbook/workbook-draft-schema';

/** Checked stand-in receipt only; no native service, historical asset or
 * contained-worker claim is made by this unit transport fixture. */
export function standInWorkbookResult(scope: WorkbookDraftScope, intent: WorkbookWriteIntent,
  preview: WorkbookCheckpoint['source'], sourceVersionId: string, versionId: string) {
  intent.renderId ??= crypto.randomUUID();
  const acknowledgement = checkedWorkbookSaveAcknowledgement({
    id: intent.id, projectId: scope.projectId, fileName: scope.fileName, renderId: intent.renderId,
    state: 'applied', sourceSha256: intent.plan.sourceSha256, targetSha256: preview.sourceSha256,
    actualSha256: preview.sourceSha256, sourceVersionId, versionId,
  }, { ...intent, operationId: intent.id, projectId: scope.projectId, fileName: scope.fileName }, preview.sourceSha256);
  return { preview, acknowledgement };
}
