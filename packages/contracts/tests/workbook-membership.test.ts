import { expect, it } from "vitest";
import * as schemas from "../src/runtime/workbook-membership";
const base = { type: "studio:workbook-visibility-state", projectId: "11111111-1111-4111-8111-111111111111", controllerId: "22222222-2222-4222-8222-222222222222", sourceSha256: "a".repeat(64), editable: true, activeSheetId: "1", sheets: [{ id: "1", name: "Inputs", visibility: "visible", canHide: false }], error: null };
const membership = { ownerId: "33333333-3333-4333-8333-333333333333", revision: 7, busy: false, activeRequestId: null, canAdd: true, sheets: [{ id: "1", canRename: true, canDelete: false }] };
const scope = { projectId: base.projectId, controllerId: base.controllerId, sourceSha256: base.sourceSha256, ownerId: membership.ownerId, revision: membership.revision, requestId: "44444444-4444-4444-8444-444444444444" };
it("preserves the legacy state and admits only consistent optional membership capabilities", () => {
  expect(schemas.workbookMembershipVisibilitySchema.parse(base)).toEqual(base);
  expect(schemas.workbookMembershipVisibilitySchema.safeParse({ ...base, membership }).success).toBe(true);
  for (const change of [{ editable: false }, { membership: { ...membership, ownerId: "other" } }, { membership: { ...membership, revision: -1 } }, { membership: { ...membership, busy: true } }, { membership: { ...membership, activeRequestId: scope.requestId } }, { membership: { ...membership, sheets: [] } }, { membership: { ...membership, sheets: [{ id: "1", canRename: true, canDelete: true }] } }, { membership: { ...membership, sheets: [membership.sheets[0], membership.sheets[0]] } }]) expect(schemas.workbookMembershipVisibilitySchema.safeParse({ ...base, membership, ...change }).success).toBe(false);
});
it("bounds strict data-only requests and correlated results without arbitrary exception text", () => {
  expect(schemas.workbookMembershipActionSchema).toBeDefined();
  const request = { ...scope, type: "studio:workbook-membership", action: { kind: "rename", sheetId: "1", name: "Renamed" } };
  expect(schemas.workbookMembershipActionSchema.parse(request)).toEqual(request);
  for (const action of [{ kind: "add", name: "New sheet" }, { kind: "delete", sheetId: "1" }]) expect(schemas.workbookMembershipActionSchema.safeParse({ ...request, action }).success).toBe(true);
  for (const change of [{ path: "/private/file" }, { revision: NaN }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { action: { ...request.action, name: "Bad/name" } }, { action: { ...request.action, name: "" } }, { action: { ...request.action, name: "x".repeat(32) } }, { action: { kind: "delete", sheetId: "__proto__" } }]) expect(schemas.workbookMembershipActionSchema.safeParse({ ...request, ...change }).success).toBe(false);
  for (const result of [{ state: "applied", error: null }, { state: "rejected", error: "name-in-use" }]) expect(schemas.workbookMembershipResultSchema.safeParse({ ...scope, type: "studio:workbook-membership-result", ...result }).success).toBe(true);
  for (const result of [{ state: "applied", error: "failed" }, { state: "rejected", error: null }, { state: "rejected", error: "/private/stack:Error" }]) expect(schemas.workbookMembershipResultSchema.safeParse({ ...scope, type: "studio:workbook-membership-result", ...result }).success).toBe(false);
  expect(schemas.workbookMembershipControlsRequestSchema.safeParse({ type: "studio:artifact-request", projectId: base.projectId, controllerId: base.controllerId, workbookMembershipVersion: 1 }).success).toBe(true);
  expect(schemas.workbookMembershipControlsRequestSchema.safeParse({ type: "studio:artifact-request", projectId: base.projectId, controllerId: base.controllerId, workbookMembershipVersion: 2 }).success).toBe(false);
});

it("preserves valid Unicode worksheet names and refuses controls, reserved punctuation and broken text", () => {
  for (const name of ["二 café", "Research", "A_B-2", "O'Brien"]) expect(schemas.workbookMembershipSheetNameSchema.safeParse(name).success, name).toBe(true);
  for (const name of ["Bad/name", "Bad\\name", "Bad[name", "Bad]name", "Bad:name", "Bad?name", "Bad*name", "\u0001bad", "\ud800bad", "bad\uFFFE", "'bad", "bad'", " ", ""]) expect(schemas.workbookMembershipSheetNameSchema.safeParse(name).success, JSON.stringify(name)).toBe(false);
});

it("rejects a noneditable visibility fixture that still advertises top-level Hide", () => {
  expect(schemas.workbookMembershipVisibilitySchema.safeParse({ ...base, editable: false, sheets: [{ ...base.sheets[0], canHide: true }] }).success).toBe(false);
});
it('matches the native host RFC UUID version/variant boundary instead of the older Zod loose UUID parser', () => {
  for (const ownerId of ['33333333-3333-4', '33333333-3333-0333-8333-333333333333', '33333333-3333-4333-0333-333333333333']) expect(schemas.workbookMembershipVisibilitySchema.safeParse({ ...base, membership: { ...membership, ownerId } }).success).toBe(false);
});
