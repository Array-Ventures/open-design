import { WorkbookHostError } from './host-request';

/** A checked durable receipt proves this exact operation cannot write later.
 * HTTP errors alone never carry this brand. Keep desired edits until the person
 * chooses how to resolve them; clearing pending must itself be journaled. */
export class WorkbookSaveTerminalError extends WorkbookHostError {
  constructor(readonly operationId: string, readonly renderId: string, readonly state: 'conflict' | 'cancelled') {
    super(state === 'conflict'
      ? 'The workbook changed elsewhere. Your edits are still here; reload only after keeping a copy.'
      : 'This save was cancelled. Your edits are still here.', state === 'conflict' ? 409 : 410);
  }
}

/** The exact failed/cancelled candidate was durably removed, then its save
 * identity was proven absent. Unlike an HTTP error, this fences late admission. */
export class WorkbookSaveUnadmittedError extends WorkbookHostError {
  constructor(readonly operationId: string, readonly renderId: string, readonly preparationState: 'failed' | 'cancelled', reason: string) {
    super(`${reason.slice(0, 1000)} Your changes were not saved. They are still here to retry or discard.`, 422);
  }
}

/** Match only a verified no-future-write result for this exact local intent. */
export function isWorkbookSaveRejection(error: unknown, intent: { id: string; renderId?: string }): error is WorkbookSaveTerminalError | WorkbookSaveUnadmittedError {
  return (error instanceof WorkbookSaveTerminalError || error instanceof WorkbookSaveUnadmittedError)
    && error.operationId === intent.id && (!intent.renderId || intent.renderId === error.renderId);
}
