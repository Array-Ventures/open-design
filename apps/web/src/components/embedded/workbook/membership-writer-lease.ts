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
  /** Source-qualified lifetime, excluding only temporary History/UI blocking. */
  isQualified(): boolean;
  isCurrent(): boolean;
  bindCleanResume(capture: (signal: AbortSignal) => Promise<((next: WorkbookMembershipWriterLease) => Promise<void>) | null>): () => void;
  captureCleanResume(signal: AbortSignal): Promise<((next: WorkbookMembershipWriterLease) => Promise<void>) | null>;
  bindCalculation(wait: (signal: AbortSignal) => Promise<void>): () => void;
  withdraw(): void;
}

// These identities are live hook issuances, never reconstructed from a draft.
const issued = new WeakSet<WorkbookMembershipWriterLease>();
export function issueWorkbookMembershipWriterLease(lease: WorkbookMembershipWriterLease): WorkbookMembershipWriterLease {
  Object.freeze(lease); issued.add(lease); return lease;
}
export function isIssuedWorkbookMembershipWriterLease(lease: WorkbookMembershipWriterLease): boolean { return issued.has(lease); }
