import { expect, it } from 'vitest';
import { createWorkbookBirthFixture, birthScope as scope } from '../helpers/workbook-birth-fixture';
import { captureWorkbookDeletionBaselines } from '../../src/components/embedded/workbook/sheet-delete-context';
import { MAX_WORKBOOK_DRAFT_BYTES } from '../../src/components/embedded/workbook/draft-store';

it.each(['ascii', 'unicode'] as const)('refuses %s selected results exceeding the actual UTF-8 recovery cap before cloning the over-cap result', encoding => {
  const f = createWorkbookBirthFixture();
  try {
    const acknowledged = f.book.save();
    const padding = encoding === 'ascii' ? 'x'.repeat(1024 * 1024) : '😀'.repeat(512 * 1024);
    acknowledged.sheets['1']!.custom = { ...acknowledged.sheets['1']!.custom, padding };
    const count = encoding === 'ascii' ? Math.floor(MAX_WORKBOOK_DRAFT_BYTES / padding.length) + 1 : 80;
    if (encoding === 'unicode') expect(count * padding.length).toBeLessThan(MAX_WORKBOOK_DRAFT_BYTES);
    const requests = Array.from({ length: count }, () => ({ sheetId: '1' }));
    expect(() => captureWorkbookDeletionBaselines(scope, f.source, acknowledged, requests)).toThrow('recovery limit');
    expect(acknowledged.sheets['1']!.custom?.padding).toBe(padding);
    expect(f.source.model.sheets[0]!.cells[0]!.value).toBe(12);
  } finally { f.univer.dispose(); }
});
