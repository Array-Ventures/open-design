import { z } from 'zod';

// This package pins Zod 3; the native version-1 host pins Zod 4's RFC UUID
// validator. Keep that wire boundary rather than Zod 3's loose hex grouping.
const uuid = z.string().uuid().refine(value => value === '00000000-0000-0000-0000-000000000000'
  || value === 'ffffffff-ffff-ffff-ffff-ffffffffffff'
  || value.length >= 36 && '12345678'.includes(value[14]!) && '89ab'.includes(value[19]!.toLowerCase()));

const sheetId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).refine(value => !["constructor", "prototype", "__proto__"].includes(value));
const scope = { projectId: uuid, controllerId: uuid, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/) };
const membership = z.object({
  ownerId: uuid, revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), busy: z.boolean(), activeRequestId: uuid.nullable(), canAdd: z.boolean(),
  sheets: z.array(z.object({ id: sheetId, canRename: z.boolean(), canDelete: z.boolean() }).strict()).min(1).max(64),
}).strict();
export const workbookMembershipVisibilitySchema = z.object({
  ...scope, type: z.literal("studio:workbook-visibility-state"), editable: z.boolean(), activeSheetId: sheetId,
  sheets: z.array(z.object({ id: sheetId, name: z.string().min(1).max(31), visibility: z.enum(["visible", "hidden"]), canHide: z.boolean() }).strict()).min(1).max(64),
  error: z.string().max(300).nullable(),
  membership: membership.optional(),
}).strict().superRefine((state, context) => {
  const visible = state.sheets.filter(sheet => sheet.visibility === "visible");
  if (new Set(state.sheets.map(sheet => sheet.id)).size !== state.sheets.length || !visible.some(sheet => sheet.id === state.activeSheetId) || state.sheets.some(sheet => sheet.canHide && (!state.editable || sheet.visibility !== "visible" || visible.length < 2))) {
    context.addIssue({ code: "custom", message: "Inconsistent worksheet visibility state." });
  }
  const capability = state.membership;
  if (capability && (capability.activeRequestId !== null && !capability.busy || capability.sheets.length !== state.sheets.length || new Set(capability.sheets.map(sheet => sheet.id)).size !== capability.sheets.length
    || capability.canAdd && (!state.editable || capability.busy || state.sheets.length >= 64)
    || capability.sheets.some(sheet => {
      const current = state.sheets.find(value => value.id === sheet.id);
      return !current || (sheet.canRename || sheet.canDelete) && (!state.editable || capability.busy)
        || sheet.canDelete && (state.sheets.length < 2 || current.visibility === "visible" && visible.length < 2);
    }))) context.addIssue({ code: "custom", message: "Inconsistent worksheet membership capability." });
});
export type WorkbookMembershipVisibility = z.infer<typeof workbookMembershipVisibilitySchema>;


/** Negotiation data only. Old hosts must continue receiving the old strict
 * visibility shape; a future frame omits membership until its exact parent asks. */
export const workbookMembershipControlsRequestSchema = z.object({ type: z.literal("studio:artifact-request"), projectId: scope.projectId, controllerId: scope.controllerId, workbookMembershipVersion: z.literal(1) }).strict();
/** Readiness correlation only; these messages grant no action capability. */
export const workbookMembershipProbeSchema = z.object({ type: z.literal("studio:workbook-membership-probe"), projectId: scope.projectId, controllerId: scope.controllerId, version: z.literal(1), handshakeId: uuid }).strict();
export const workbookMembershipReadySchema = z.object({ type: z.literal("studio:workbook-membership-ready"), projectId: scope.projectId, controllerId: scope.controllerId, version: z.literal(1), documentId: uuid, epoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), handshakeId: uuid.optional() }).strict();
export const workbookMembershipSheetNameSchema = z.string().min(1).max(31).refine(value => value.trim().length > 0 && !/[:\\/\?*\[\]\u0000-\u001f\uFFFE\uFFFF\p{Cs}]/u.test(value) && !value.startsWith("'") && !value.endsWith("'"), "Use a valid worksheet name.");
const ticket = { ...scope, ownerId: uuid, revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), requestId: uuid };
/** A UI request is not authority: the current frame must independently recheck
 * lease, source, worker, permission and controller before any actual operation. */
export const workbookMembershipActionSchema = z.object({ ...ticket, type: z.literal("studio:workbook-membership"), action: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), name: workbookMembershipSheetNameSchema }).strict(),
  z.object({ kind: z.literal("rename"), sheetId, name: workbookMembershipSheetNameSchema }).strict(),
  z.object({ kind: z.literal("delete"), sheetId }).strict(),
]) }).strict();
export type WorkbookMembershipAction = z.infer<typeof workbookMembershipActionSchema>;
/** Echo the original ticket after actual private admission/execution settles.
 * Finite errors prevent exception messages, file paths and stacks escaping. */
const resultScope = { ...ticket, type: z.literal("studio:workbook-membership-result") };
export const workbookMembershipResultSchema = z.discriminatedUnion("state", [
  z.object({ ...resultScope, state: z.literal("applied"), error: z.null() }).strict(),
  z.object({ ...resultScope, state: z.literal("rejected"), error: z.enum(["changed", "not-allowed", "invalid-name", "name-in-use", "unavailable", "failed"]) }).strict(),
]);
export type WorkbookMembershipResult = z.infer<typeof workbookMembershipResultSchema>;
