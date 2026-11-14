import { createSourceDeleteHistoryFixture, sourceDeleteScope } from './workbook-source-delete-fixture';
import { saveWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';

export function createRetirementFixture(_owned: true,
  options: NonNullable<Parameters<typeof createSourceDeleteHistoryFixture>[1]> & { afterCommit?: () => void } = {}) {
  return createSourceDeleteHistoryFixture(true, { ...options,
    save: async state => { await options.save?.(state); await saveWorkbookDraft(sourceDeleteScope, state); },
    saveGuarded: async (state, protection) => {
      await options.save?.(state);
      await saveWorkbookDraft(sourceDeleteScope, state, protection.guard, protection.beforeCommit);
      options.afterCommit?.();
    },
  });
}
