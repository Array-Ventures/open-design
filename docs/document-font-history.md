# First document font change and native history

This child checkpoint follows the first-review correction at `32c8b391`, keeping
its original first-font regression unchanged. The actual mounted StrictMode
editor's first Text → Serif action, without focusing content, changed the font
but native Undo kept Serif. The unchanged regression failed in
`/tmp/document-font-history-red.log` before this fix.

A temporary read-only public update-listener trace found that the first font
update shared a pending plugin/mount-normalization transaction: its tags
included `history-merge`, with one unchanged dirty text leaf alongside the changed
root NodeState. The pinned native history implementation can merge that candidate.
The trace is `/tmp/document-font-history-public-trace.json`; its temporary
instrumentation is not shipped.

The Font owner now uses the public `editor.read()` API, which flushes pending
updates before its read, to inspect the actual current font. A changed choice
then updates root NodeState with `HISTORY_PUSH_TAG` as a distinct source-format
transaction. An already-current choice does not mutate source or erase Redo.
There is no copied history implementation, SDK patch, baseline wrapper, shadow
stack, HISTORIC authorization bypass or selection rewrite.

The original regression is green. Six additional real mounted-editor cases
cover first heading-font Undo/Redo with and without StrictMode, an unchanged
choice preserving clean source and Redo, typing/font transaction separation with
unchanged caret points, actual conditional-save font metadata/content, and
retired/new editor ownership. All 107 cases across six affected editor/review,
input, deletion-barrier and font files pass. This preserves all 21 existing
DocumentSuggestions cases and the native first-review transaction coverage.

This is source/component qualification. Actual packaged first-font Undo/Redo
remains a later browser gate; no browser, package, runtime, production or pin
change was made here. Logs use `/tmp/document-font-history-*`.

Final author checks: 107 affected cases across six files passed. The six new font
cases passed again after correcting a test-only type error: Testing Library's
ByRoleOptions does not accept Playwright's `exact` option, so anchored name
regular expressions retain the exact-match oracle. The initial failed types log
is preserved as `/tmp/document-font-history-types-initial-test-api-failure.log`.
Final full workspace types, guard, frozen child install and diff check exit 0.
The final API-adjusted six-case log is
`/tmp/document-font-history-final-api-cases.log`; the complete affected lane is
`/tmp/document-font-history-final-focused.log`. No original history assertion was
removed, skipped or weakened.
