# Bounded native mutation data development checkpoint

Controls remain off. Native item identity prevents a different item from claiming
a live birth token, but does not make that item's contents immutable. In this pin,
InsertSheetCommand keeps the same insertion params in redo history. Public command
listeners can retain those params; the live worksheet is separately cloned. A real
SDK/Writer controller case changed the retained redo sheet to 999 while its native
entry ID and live blank sheet stayed unchanged. Redo then inserted 999 before the
post-command quarantine caught it. That is the genuine pre-entry integrity gap.

The generic public SDK method is:

```
getUndoRedoMutationData(unitId, direction, entryId)
→ { unitId, entryId, undoMutations, redoMutations }
```

It selects only the exact current focused top item and copies no native reference.
The result and all nested containers are frozen. Core preserves all mutation data,
including trigger, and contains no InsertSheet/RemoveSheet names or worksheet
allowed-key policy. An app must validate that policy and compare actual data with
its own immutable issued configuration. The pinned framework rewrites outer
mutation params.trigger when dispatching Undo/Redo; only the app may explicitly
normalize that routing field, not fields inside a sheet or arbitrary unknown keys.

The projection reuses the existing own-data-descriptor refusal and validates the
complete selected data before structuredClone. Own accessors on inspected plain
data are rejected without invocation. Native cloning also refuses Proxy objects;
descriptor/prototype reflection is not a security boundary against arbitrary Proxy
traps. The copied JSON-domain tree omits optional undefined object fields and
normalizes -0 to 0, then freezes every container. Dense arrays, plain acyclic data
and finite numbers are required. Non-enumerable and symbol properties refuse
instead of silently disappearing. Exact focused unit, item identity and service
revision are rechecked after copying.

Bounds are 100,000 mutations across both directions, depth 64, 4,000,000 nodes,
64 × 1024 × 1024 UTF-16 text units and 128 MiB UTF-8 JSON output. Byte accounting includes
quotes, escapes, commas, braces, numbers and surrogate handling before copying;
it does not allocate an oversized encoded JSON string first. There is no new
history stack, hash family, persisted identity or worksheet authorization grant.

Actual cases cover detached nested data and preserved trigger, same-item public
params changes visible only in a later projection, exact-entry/direction refusal,
getter/cycle/hole/exotic/non-finite refusal, clone-not-called budget negatives,
large Unicode and escaped-control byte overflow and a genuinely bounded large
Unicode positive. Consumed ES/CJS/compat entries are tested directly. The initial
positive API case failed because the query was absent; the behavioral reason is
the separate actual public-listener alias case. That case must turn green through
app-owned pre-entry comparison before the controller is qualified. Standalone UMD
is unconsumed/unqualified. No app controller, asset/history permission, durable
Undo/Redo readiness or browser/release qualification is claimed here.

Qualification: 52 focused cases across seven files, full fork typecheck and guard
passed. This remains a source dependency checkpoint, with no browser or packaged
application qualification for the new projection itself.

A review follow-up found that structuredClone preserves acyclic shared references.
The original freezer could revisit an already frozen params object shared by Undo
and Redo and throw. An actual SDK shared-params/diamond test reproduced that failure.
The clone freezer now tracks visited containers; budget validation still charges
every serialized path, so aliasing does not bypass limits. The three consumed
runtime-entry tests also exercise shared params. No native references are returned.
