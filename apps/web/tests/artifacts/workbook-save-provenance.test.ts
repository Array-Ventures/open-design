import { expect, it } from 'vitest';
import { checkedWorkbookSaveAcknowledgement } from '../../src/components/embedded/workbook/save-provenance';
import { checkedWorkbookSave } from '../../src/components/embedded/workbook/save-identity';
import type { WorkbookSaveAttempt } from '../../src/components/embedded/workbook/save-transport';

const operationId = '18a8301a-b6e1-4001-8000-c967b1eab221', projectId = '18a8301a-b6e1-4001-8000-c967b1eab222', renderId = '18a8301a-b6e1-4001-8000-c967b1eab223';
const sourceSha256 = 'a'.repeat(64), targetSha256 = 'b'.repeat(64);
const attempt = (): WorkbookSaveAttempt => ({ operationId, preparationId: '18a8301a-b6e1-4001-8000-c967b1eab224', projectId, fileName: 'reports/book.xlsx', renderId, plan: { sourceSha256, edits: [] } });
const receipt = () => ({ id: operationId, projectId, renderId, fileName: 'reports/book.xlsx', state: 'applied', sourceSha256, targetSha256, actualSha256: targetSha256, sourceVersionId: 'before-v1', versionId: 'after-v2' });

it('binds the pre-save historical source separately from the refreshed saved target', () => {
  const result = checkedWorkbookSaveAcknowledgement(receipt(), attempt(), targetSha256);
  expect(result).toEqual({ kind: 'history', provenance: { operationId, projectId, renderId, fileName: 'reports/book.xlsx', sourceSha256, sourceVersionId: 'before-v1', targetSha256, versionId: 'after-v2' } });
});
it('keeps optional legacy receipts usable without inventing history-backed authority', () => {
  const { sourceVersionId: _version, ...legacy } = receipt();
  for (const raw of [legacy, { ...legacy, sourceVersionId: null }]) {
    expect(checkedWorkbookSave(raw, attempt()).state).toBe('applied');
    expect(checkedWorkbookSaveAcknowledgement(raw, attempt(), targetSha256)).toEqual({ kind: 'unavailable', reason: 'legacy-receipt' });
  }
});
it('refuses malformed source versions and source/target/operation scope mismatches', () => {
  for (const sourceVersionId of ['', '../version', 12, {}, []]) expect(() => checkedWorkbookSave({ ...receipt(), sourceVersionId }, attempt())).toThrow();
  for (const changed of [{ id: projectId }, { projectId: operationId }, { renderId: operationId }, { fileName: 'other.xlsx' }, { sourceSha256: targetSha256 }, { actualSha256: sourceSha256 }, { versionId: null }, { state: 'pending', actualSha256: null, versionId: null }, { sourceVersionId: 'after-v2' }]) expect(() => checkedWorkbookSaveAcknowledgement({ ...receipt(), ...changed }, attempt(), targetSha256)).toThrow();
  for (const refreshed of [sourceSha256, 'c'.repeat(64), 'not-a-digest']) expect(() => checkedWorkbookSaveAcknowledgement(receipt(), attempt(), refreshed)).toThrow();
});
it('does not convert a whole-file restore receipt into automatic SDK lineage', () => {
  expect(checkedWorkbookSaveAcknowledgement({ ...receipt(), restoreFromVersionId: 'selected-old-file' }, attempt(), targetSha256)).toEqual({ kind: 'unavailable', reason: 'whole-file-restore' });
});
it('permits one immutable version only when the source and saved bytes are actually identical', () => {
  const raw = { ...receipt(), sourceVersionId: 'same-v1', versionId: 'same-v1', targetSha256: sourceSha256, actualSha256: sourceSha256 };
  expect(checkedWorkbookSaveAcknowledgement(raw, attempt(), sourceSha256)).toMatchObject({ kind: 'history', provenance: { sourceVersionId: 'same-v1', versionId: 'same-v1', sourceSha256, targetSha256: sourceSha256 } });
});
