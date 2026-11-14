import type { WorkbookWriter } from './workbook-writer';
import type { WorkbookDraftScope } from './workbook-draft-schema';

/** In-memory binding issued by the currently leased editor Writer. A checkpoint
 * or recovered descriptor cannot construct the owning closure. */
export interface WorkbookMembershipWriterLease {
  readonly writer: WorkbookWriter;
  readonly scope: WorkbookDraftScope;
  readonly generation: string;
  /** Lifetime only; permits reconciliation, never native membership issuance. */
  isOwned(): boolean;
  isCurrent(): boolean;
  bindCalculation(wait: (signal: AbortSignal) => Promise<void>): () => void;
  withdraw(): void;
}
