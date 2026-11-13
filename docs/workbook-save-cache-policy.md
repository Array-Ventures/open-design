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


## Named-expression work admission

Each calculation shares lexical caches and cycle-safe results keyed by resolved
name identity **and effective sheet**, with each memo entry retaining its relative
maximum named-reference depth. Global names can resolve different local
names in each caller sheet, so sharing by name identity alone is incorrect. Both
name occurrences in a doubling DAG contribute to its estimated expansion, while
the analyzer visits the resolved definition only once per effective context.

Before `executeCalculation`, admission estimates expanded source characters plus
lexical nodes, including a conservative allowance for longer relative-reference
coordinates. Saturating arithmetic prevents the estimate itself overflowing. It
scans the full expression even after finding an unsupported leaf: the pinned
engine can expand later named expressions before evaluating that leaf. Aggregate
limits are 110,000 distinct lexer calls, 1,000,000 lexical tokens, 2,000,000 analyzer
visits, 262,144 resolved name contexts, 8,000,000 estimated expanded work units and
64 levels of name recursion. Limits can be lowered internally, never raised. A cached tail still contributes
its full depth when reused beneath a different prefix; traversal order cannot
bypass the depth boundary.
Detected cycles refuse with `WORKBOOK_UNSUPPORTED`; excessive work/depth refuses with
`WORKBOOK_LIMIT`, before the engine's explicit execution call. Source bytes remain
unchanged and protected drafts are retained by the existing save transaction.

The actual pinned-lexer regression reads a forty-level doubling DAG from XLSX and
analyzes it across a thousand source cells with at most 42 lexer calls. Separate
real XLSX save tests instrument the execution call: a large DAG, an unsupported
prefix followed by a large DAG, a repeated large string payload, aggregate shared
names across cells, excessive depth (including tail-first memo reuse) and cyclic metadata all refuse before
execution. Small admitted DAGs still calculate, unsupported-leaf DAGs retain their
source/dependent caches, and local/global shadowing stays correct in independent
reopens. This bounds named-expression admission; it does not claim huge DAG
calculation support or replace the worker's overall runtime/memory deadline.

The pinned lexer recognizes the spill-reference suffix `#`, but its current
runtime returns `#VALUE!` for `SUM(D3#)` rather than consuming the spill. An exact
raw lexer `#` operator token therefore retains unchanged source formulas and
their dependent caches; new or changed spill-reference formulas refuse saving.
Quoted `"#"` strings and genuine Excel error literals remain separate structured
lexer nodes and continue to calculate. Explicit follower coordinates can use the
qualified array backend; this does not claim support for the spill operator.
