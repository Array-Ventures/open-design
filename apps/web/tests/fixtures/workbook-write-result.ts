import type { WorkbookWriteResult } from '../../src/components/embedded/workbook/workbook-writer';
/** An explicit ordinary-save fixture without historical receipt authority. */
export const legacyWorkbookWrite = (preview: WorkbookWriteResult['preview']): WorkbookWriteResult => ({ preview, acknowledgement: { kind: 'unavailable', reason: 'legacy-receipt' } });
