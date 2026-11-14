import type { IMutationInfo } from '@univerjs/core';

/** Installed only by the live kernel calculation owner, entered inside an
 * already durable protected controller callback. Sequence data is not authority. */
export type WorkbookProtectedSheetSequence = (sequence: readonly IMutationInfo<object>[], execute: () => boolean) => boolean;
