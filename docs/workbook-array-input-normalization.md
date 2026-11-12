# Native array formula input normalization

The pinned sheets formula plugin normalizes a person's formula inside its
`beforeCommandExecuted` callback, before the outer range mutation writes its
cells. That nested `SetRangeValuesMutation` is marked `onlyLocal/fromFormula`
and contains the same formula with null shared-formula/cache metadata. It is
not a worker calculation result. Blanket rejection prevented native formula
entry even though isolated projection calculations succeeded.

The Grid now installs an owned input guard before registering SDK plugins.
After the display controller binds its source snapshot, the guard checks the
outer mutation's identity, registered geometry, combined cell/text budget and
projected follower ownership before the SDK can touch formula metadata. Its
allowance covers only one nested normalization of coordinates in that exact
input, with the same formula and null-only `si/v/t`. Numeric/string result
caches, another formula, shared formulas and unrelated coordinates are refused.
Pinned dirty-range/formula metadata notifications do not erase the input scope.

The scope follows the actual synchronous range-mutation dispatch via the
public command service methods, with `try/finally` cleanup on return or throw.
An asynchronous public command executes its before callbacks synchronously;
its returned promise does not retain permission. Disposal restores methods
only while this controller still owns its wrappers. No SDK private execution
stack or fake lifecycle stage is used. The later projection guard checks the
exact admitted command identity; the nested intermediate snapshot does not
start a second worker calculation before the outer input completes.

Qualification uses the real pinned formula plugin in NO_CALCULATION mode and
real range commands. Adding that plugin to the preceding integration fixture
reproduced three read-only-projection failures. Focused tests exercise creation,
source-owner edit/removal/undo/redo, follower and geometry/text-budget refusal
before SDK metadata changes, forged cache/formula/coordinate writes, expired
and thrown-call scopes, async dispatch and ownership-safe disposal. This is
source-level qualification; packaged native editor interaction is a separate
browser acceptance gate.

The input lifetime shares the Grid layer's single cleanup owner; registering a
second owner would replace worker/Univer cleanup in the retained-view manager.
A shared release handle lets calculation retirement stop input promptly while
the layer still guarantees worker and Univer cleanup after failures. The real
Grid component regressions use a verified source array and cover replacement,
setup exceptions and unmount, including snapshot capture before kernel disposal
and exactly-once resource release. Both fail against the preceding owner wiring.
