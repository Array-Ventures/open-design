# Pending worksheet birth development checkpoint

Controls remain disabled. This is a producer foundation, not a complete Add/Delete/Undo feature or a packaged qualification.

A protected native Add can now run while an unrelated existing save is pending. The original pending intent and snapshot stay frozen. Protection captures the exact pending pointer and rechecks it, source identity and revision after awaited journal storage. Checked receipt publication also observes changes to the birth ledger so a birth admitted during receipt storage cannot be silently retired. The actual SDK test preserves the original scalar intent, adds and edits a new sheet, accepts that first checked stand-in ACK and derives a separate new-sheet save. The retained native insertion redo configuration remains blank rather than inheriting the later saved value.

Pending removal/restoration is unfinished. In particular, a birth already present in a frozen pending snapshot must receive its saved-target historical baseline and immutable target version before that source retires, even when current desired has removed it. This checkpoint does not claim that behavior or permit its controls.

## Actual SDK metadata seam proof

`workbook-sheet-map-seam.test.ts` is an explicitly test-only prototype. It replaces scoped registrations of the existing InsertSheetMutation and RemoveSheetMutation, invokes each original synchronous handler with unchanged arguments/options, and calls the public Workbook.setCustomMetadata before returning. Official Delete and native Undo/Redo therefore expose the corresponding sheet membership and removal-map value together to onCommandExecuted observers. The test also proves unchanged native history counts, preservation of unrelated metadata and immutability of a previously frozen pending snapshot. No application wrapper is installed.

The pinned InsertSheetCommand does not call SheetInterceptorService, whereas RemoveSheetCommand does. A command interceptor alone consequently does not cover Add and its native replay. The mutation seam is needed for uniform ownership; it does not itself grant an action. The prototype's armed ticket stands in for the existing Writer's awaited durable protection callback.

Before production integration, the owner must validate scope, live pool/token issuance, exact before-model/map, focus/lease/source and revision, then verify the actual after-model/map. A consumed ticket cannot be reentered. False/throw/partial mutation or metadata setter failure must preserve protected roots and enter the existing sticky quarantine; no rollback is implied. Native history protection must precede stack pop, using the separately maintained async-only registration gate.

Pinned RPC forwards registered mutation commandInfo/options from onCommandExecuted; these wrappers do not alter those inputs. Workbook custom metadata is not a separate RPC mutation. The calculation worker therefore needs its existing input authority to remain independent of this main-thread selection map. Actual worker/controller qualification, repeated same-ID/ABA and multiple retained removal contexts, permission withdrawal, restored pending history and recovery remain required before enabling anything. A serialized map or token never authorizes a native action or historical asset.
