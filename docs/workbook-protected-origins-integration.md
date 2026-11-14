# Protected worksheet origins: integration checkpoint

This source checkpoint combines origin-aware Delete, protected Rename, exact
native Add/replay ownership, bounded native history inspection and retirement
of genuinely unreferenced origin records. The individual reasoning, failed
regressions and limits remain in:

- [Origin-aware Delete and Rename](workbook-origin-delete-rename.md).
- [Native history entry inspection](workbook-history-reachable-ids.md).
- [Protected root retirement](workbook-protected-root-retirement.md).

The integration branch normally merged fork main `9565e41e` into the reviewed
producer checkpoint `6df4bc1d`. The only merge conflict was independent additions
to `patches/README.md`; both descriptions were retained. The incoming keyboard
and plain-string save fixes remain intact. Two added test files had duplicate
trailing blank lines removed; no assertion or production behavior changed.

Frozen installation passed. Full workspace `pnpm typecheck`, `pnpm guard`, and
**242 cases across 22 selected suites** passed on the combined source. The suites
cover origin/history/Writer/storage boundaries plus the incoming keyboard and
plain-string source checks. Receipts are
`/tmp/workbook-protected-origins-pr-{install,types,guard,focused}.log`.
Independent source reviewers did not rerun tests.

A later real SDK/IndexedDB regression found that Add → Undo could look clean
without a save receipt, causing generic persistence to delete a still-owned
birth/removal/high-water pool. The isolated correction `4e7cd5e6` is included:
birth metadata now keeps that same draft checkpoint durable. After integration,
**80 cases in seven affected suites**, full workspace types and guard passed;
the earlier keyboard/string source is unchanged. Follow-up receipts are
`/tmp/workbook-protected-origins-pr-birth-{followup,types,guard}.log`. This is
retention of data, not persistence of native SDK issuer identities across reload.

The reviewed buried-entry defect is corrected: complete native ID sets retain
older items, while payload inspection remains top-only. Four genuine SDK REDs
and the actual preserved Undo/Redo traversals are documented in the retirement
record. Guarded storage tests use the actual draft store over fake IndexedDB;
ACK fixtures use the explicitly documented stand-in transport.

**This does not install the producer in the live grid or enable worksheet
controls.** The real calculation consumer, private continuity after a rejected
whole-file restore, obsolete removal-selector cleanup and automatic maintenance
are separate integration gates. Full UI, HTTP/history permissions, crash cuts
and packaged qualification remain required. No companion build, runtime change,
publication, installer pin or production update is included.
