# One full read for worksheet baseline capture

Later actual [120/63 qualification](workbook-history120-qualification.md) covers
the existing editor and explicit manual historical-asset path. This record's
source/stand-in evidence keeps its original scope; live membership controls,
issued Delete/Undo and protected membership recovery remain unqualified.

Independent review found that the earlier batch captured one global SDK view but
called `workbookSheetBaseline(model,id)` for every request. That function bounded
and strictly parsed the complete source each time. A batch of32 duplicate selected
requests caused33 full model parses and32 traversals of an unselected4096-cell
sheet. At the existing4096-request bound this was unnecessary repeated work.

The regression measures the actual `workbookDocumentSchema.parse` owner and an
unselected array's getter-free descriptor traversal, rather than wall-clock time
or only `gridWorkbook`. Contract entry bundles inline separate schema instances;
this test binds both actual contract source modules so the spy sees every real
parse. The initial package-entry spy saw only the grid parse while unselected
reads still failed32-to1. The source-bound regression then failed33-to1. No
implementation was substituted and no discovery configuration changed. The Proxy
is operation-count instrumentation, not a claim of protection against arbitrary
Proxy behavior.

The existing contract owner now offers a synchronous
`withWorkbookSheetBaselines(raw,ids,use)` operation. It bounds and strictly parses
the full model once, including malformed unselected content, deduplicates IDs and
constructs only selected sheet/referenced-style candidates. The callback receives
ordinary private parsed data and a read-only data map, not an authorization or
persisted qualification token. Candidates share that private read until the
consumer's existing complete raw UTF-8 aggregate128MiB check. Only afterward does
the existing context schema/clone canonicalize each admitted independent result.
No4096 identical closures are built before the limit. No recovery limit, source
capability, style/resource guard or receipt requirement changes.

`gridWorkbook` retains its strict public wrapper. Its unchanged display conversion
body is factored into the pure `gridWorkbookFromValidatedModel` adapter, called
inside that synchronous owner callback. It does not create source qualification
or writing authority. Tests verify that conversion and subsequent output edits do
not mutate the parsed source or original input. The single baseline API still
returns detached schema-canonicalized data with unchanged style closure/identity.

The deterministic regression now observes one full parse and one unselected
traversal for32 independently copied results. Contract cases also refuse malformed
unselected styles, dimensions, coordinates and names before callback publication.
Affected checks passed13 contract cases,85 web cases in11 files (including actual
SDK history and7 handoff subprocess cases),16 actual ZIP source-owner cases in2
daemon files, full fork typecheck and guard. Logs are
`/tmp/workbook-baseline-batch-{source-red,contract-focused,focused,daemon-focused,types,guard}.log`.
Controls remain uninstalled; this is not packaged browser, contained historical
asset, protected recovery or completed membership qualification. Frozen prior
source/native handoff checkpoints were not modified.
