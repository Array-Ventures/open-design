import { encodeWorkbookDraft, type WorkbookDraftScope } from './workbook-checkpoint';
import { MAX_WORKBOOK_DRAFT_BYTES } from './draft-store';
import type { WorkbookCheckpoint } from './workbook-writer';

/** Recovery data is deliberately named JSON, never misrepresented as XLSX. */
export function downloadWorkbookDraft(scope: WorkbookDraftScope, checkpoint: WorkbookCheckpoint) {
  const blob = new Blob([JSON.stringify(encodeWorkbookDraft(scope, checkpoint))], { type: 'application/json' });
  if (blob.size > MAX_WORKBOOK_DRAFT_BYTES) throw Error('The recovery copy exceeds this device’s download limit.');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  try {
    link.href = url; link.download = `${scope.fileName.replace(/[\\/\u0000-\u001f]/g, '-')}.recovery.json`;
    document.body.append(link); link.click();
  } finally {
    link.remove();
    // Let the browser consume the object URL before revocation.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
