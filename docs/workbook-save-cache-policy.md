# Source-owned formula caches during XLSX saves

An unrelated scalar save previously recalculated every formula and wrote every
cache, allowing an unsupported source formula with a stored numeric result to
become `#NAME?`, including downstream and `IFERROR`-masked branches. The regression
in `workbook-cache-preservation.test.ts` first reproduced that failure through
actual XLSX bytes and an independent ExcelJS reopen.

The bounded daemon calculator now uses the pinned Univer lexical facade, actual
function service, bound name/table metadata and emitted dependency graph to mark
limited scalar branches. The graph's dependent closure includes cross-sheet,
range/table/name and error-masking dependencies. Missing or stale graph evidence
refuses the transaction rather than assuming independence. Name expansion is
bounded, cycle-aware and uses the actual defined-name service; formula syntax is
not parsed with a separate regex parser. Registered function descriptions alone
are not proof of executable support.

For unchanged limited formulas, only the original server-read package/model owns
the cache. Numeric, boolean, error and string results—including empty strings—stay
typed; a missing cache stays missing. Unchanged source XML/cache cells are retained,
not regenerated from the engine's failed values. These results are **stored**, not
recalculated, and may be stale after upstream input edits. Independently supported
formulas still receive genuine typed calculation results. An actual Excel error
literal such as `#NAME?` is identified through the pinned error registry, not
mistaken for an unsupported function; error-looking strings remain strings.

New or changed limited formulas and their changed dependents cannot borrow an old
source result, even if a caller supplies a plausible cache. Such saves refuse with
`WORKBOOK_UNSUPPORTED`. A supported replacement of an unsupported formula computes
normally. The internal cell patch mode retains unedited formula/cache XML; it
expands only shared groups whose formula identities were actually edited. The
public preservation primitive's original cache-invalidation behavior is unchanged.
The final cache writer changes only supported caches whose typed result changed.

External-link package, source array/data-table/dynamic-metadata and non-scalar
result refusals remain in place. This is not a full Excel calculation guarantee:
missing runtime function implementations and rich/dynamic-reference functions
remain stored branches, and arrays still need a separate save adapter. No browser
cache, provider, web-app private module or networked model is involved.

Focused tests cover unknown and catalogued unimplemented functions, masked and
cross-sheet closure, names/structured tables, cacheless formulas, source formula
identity edits, shared groups, false/zero/error/string/empty-string caches,
independent supported recalculation and unchanged external/array refusals. The
existing calculation, metadata, array, cell-patch and reader suites remain the
regression boundary. Model and output bytes remain separate until the existing
conditional commit/history transaction accepts the prepared XLSX.
