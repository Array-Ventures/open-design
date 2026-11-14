import type { IWorkbookData } from '@univerjs/presets';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import type { WorkbookSaveAcknowledgement } from './save-provenance';
import type { WorkbookJournal } from './workbook-writer';
type Preview = { sourceSha256: string; model: WorkbookDocument };
/** In-memory handoff from one protected Writer, never a persisted identity or
 * a grant inferred from equal hashes/resources. External/history loads lack it. */
export interface WorkbookKernelAcknowledgement {
  previous: Preview; target: Preview; snapshot: IWorkbookData;
  acknowledgement: Extract<WorkbookSaveAcknowledgement, { kind: 'history' }>;
  controllerId: string; journal: WorkbookJournal;
}
