import { expect, it } from 'vitest';
import { protectedFormulaInputNormalization, workbookMembershipReplica, workbookSheetCommandSha256 } from '../../src/components/embedded/workbook/sheet-calculation-permit';
const configuration = { version: 1 as const, unitId: 'private-kernel', kernelGeneration: '3575c54b-f5dd-46ce-98f8-53dc80f923d0', sourceCapability: 'a'.repeat(64) };
const command = { id: 'sheet.mutation.remove-sheet', params: { unitId: configuration.unitId, subUnitId: '2', subUnitName: 'Second' } };
function permit(overrides: Record<string, unknown> = {}) { return { ...configuration, inputEpoch: 1, sequence: 1, index: 0, count: 1, commandSha256: workbookSheetCommandSha256(command), beforeInputSha256: 'b'.repeat(64), ...overrides }; }
it('refuses a mutation after the declared sequence has already completed', () => {
  const replica = workbookMembershipReplica(configuration);
  replica.admit(permit(), command, 1, 'b'.repeat(64));
  expect(() => replica.admit(permit({ index: 1, inputEpoch: 2 }), command, 2, 'b'.repeat(64))).toThrow();
});
it.each(['unitId', 'kernelGeneration', 'sourceCapability', 'commandSha256', 'beforeInputSha256', 'inputEpoch'])('refuses changed replica proof %s', key => {
  const wrong = key === 'inputEpoch' ? 2 : key === 'kernelGeneration' ? crypto.randomUUID() : key.endsWith('Sha256') || key === 'sourceCapability' ? 'c'.repeat(64) : 'another-unit';
  expect(() => workbookMembershipReplica(configuration).admit(permit({ [key]: wrong }), command, 1, 'b'.repeat(64))).toThrow();
});
it('does not restart an incomplete sequence or replay its first permit', () => {
  const replica = workbookMembershipReplica(configuration), first = permit({ count: 2 });
  replica.admit(first, command, 1, 'b'.repeat(64));
  expect(() => replica.admit(first, command, 1, 'b'.repeat(64))).toThrow();
  expect(() => replica.admit(permit({ sequence: 2, inputEpoch: 2 }), command, 2, 'b'.repeat(64))).toThrow();
});
it('admits only exact authored formula normalization with null cache clears', () => {
  const outer = { unitId: 'u', subUnitId: '2', cellValue: { 1: { 0: { f: '=A1', si: null } } } };
  const normalized = { ...outer, cellValue: { 1: { 0: { f: '=A1', si: null, v: null, t: null } } } };
  expect(protectedFormulaInputNormalization(normalized, outer)).toBe(true);
  expect(protectedFormulaInputNormalization({ ...normalized, cellValue: { 1: { 0: { f: '=A1', v: 999 } } } }, outer)).toBe(false);
  expect(protectedFormulaInputNormalization({ ...normalized, cellValue: { 2: normalized.cellValue[1] } }, outer)).toBe(false);
  expect(protectedFormulaInputNormalization(normalized, null)).toBe(false);
});
