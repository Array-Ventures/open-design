# Worksheet membership source capability

`worksheetMembershipEditable` is an optional, descriptive workbook-model flag.
Only an explicit `true` means the XLSX reader qualified the current source for
its existing sheet writer. Missing values, including older previews and CSV,
do not advertise membership. This does not install Add, Delete or Rename controls,
a native command issuer, historical restore authority or pending-save history.
Those remain part of the full worksheet lifecycle implementation.

Row/column geometry and worksheet membership have different source owners.
After ordinary structural geometry qualifies, the reader reuses the existing
`assertWorkbookSheetsSupported` admission. It checks numeric IDs and names,
very-hidden sheets, extended worksheet title vectors and unknown document
properties in addition to the existing structural rules. A workbook can retain
its already qualified cell/geometry operations while refusing membership. The
reader does not rewrite any package part to manufacture support.

The contained writer still repeats its source qualification. Changing a preview
flag cannot authorize a sheet action. No worker check, source guard, metadata
owner or unsupported-feature refusal was removed.

The source sheet-domain schema now uses `safeParse` and reports the existing
`WorkbookFormatError` unsupported classification. This matters because contracts
use Zod3 and the daemon uses Zod4: catching the daemon's ZodError constructor did
not recognize the contract's error for an out-of-range sheet ID. That initial
61-pass/one-failure run is preserved; the final reader catches only expected
format refusals and lets unrelated programming errors propagate.

Six new actual-ZIP cases first failed because the capability was absent. They
now prove ordinary admission without package changes; independent rejection of
extended title vectors, unknown document properties, very-hidden sheets and
out-of-range numeric IDs while structural geometry remains usable; and refusal
for unsupported frozen views. Each refused source also rejects a real writer
request after its preview flag is deliberately forged to true. The final focused
run passed62 cases across membership capability, reader and sheet writer tests.
Full workspace types, guard and diff checking passed. Local logs are under
`/tmp/workbook-membership-capability-{red,focused,types,guard}.log`.

This is source qualification. No matching packaged companion/renderer, UI
membership controls, live keyboard/toolbar or pending-source recovery behavior
was activated or qualified by this slice. Installation pins and production are
unchanged.
