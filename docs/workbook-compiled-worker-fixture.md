# Compiled workbook worker fixture

This test-only correction starts from merged `8c07d800`. No production worker,
calculation owner, readiness deadline, formula policy, transport authority or
preview runtime changes.

## Observed failure and its boundary

The original real-RPC Writer fixture failed on the clean baseline and again in
a focused serial run: its Node worker did not report ready within the existing
five seconds. A fresh main-tree timing diagnostic, without admitting a kernel,
observed ready at 5276 ms. That diagnostic's original output filename was reused
by a later measurement; the first JSON is preserved explicitly as a copy from
the retained tool read, not an independently preserved original file.

The Node fixture runtime-required raw TypeScript through `tsx/cjs`. The app
instead launches a classic worker already compiled by Next/Turbopack. A separate
cache-disabled source timing probe reached imports at 1640 ms and ready at
1647 ms. This differing probe is not a controlled proof of a particular cache
or resource cause and is not a pass of the five-second admission gate.

Two compiled comparisons narrow the issue. An ahead-of-time esbuild browser
IIFE of the exact production entry passed the unchanged real owner at 406 ms.
The retained actual Next worker graph passed that same owner at 178 ms in an
owned Node compatibility host, with zero network attempts. Its eleven loaded
scripts were checked against the immutable package inventory. Their bytes also
match the newly built `3a561a95` companion. Four generated workbook contract
payloads match both packages exactly, and seventeen tracked source/pin checks
match; the newer candidate's lockfile differs and is recorded as such.

The Next diagnostic supplies only compatibility shims for worker globals and a
strict local `importScripts` map. Its first two attempts failed because the
scratch host did not reproduce the framework's root-relative reversed bootstrap
IDs. Those attempts are retained, and correcting the host changed no distributed
JavaScript. This proves compiled JavaScript initialization in Node, not browser
fetch timing, CSP, caching, or whole-package behavior.

## Portable fixture correction

Production-mode `NodeWorkbookWorker` now builds the actual production entry
before creating its worker and its unchanged five-second runtime owner. The web
package declares the existing pinned esbuild 0.28.0 as a development dependency;
there is no dependency on a private cross-app module or a local packaged build.
A plain Node child performs the browser/classic-IIFE build. This avoids jsdom's
cross-realm typed-array mismatch without changing test globals.

Every build records the compiler version, exact entry, all input checksums and
output checksum. Acquiring an existing artifact rechecks those bytes; it never
silently rebuilds a failed owner. Concurrent fixture workers can share one
immutable artifact, and the final worker exit releases its owned temporary root.
Constructor failure also releases its lease. Raw source, nonproduction and
intentional-stall fixture modes retain their previous behavior.

The portable fixture uses esbuild's browser bundle, not the exact Next artifact.
The independent Next diagnostic is recorded separately to avoid equating the
two compilers. Compilation is a fixture build boundary before worker creation;
no runtime deadline is extended and no warm retry changes a failure into a pass.

## Author qualification

The final affected lane passed 39 cases across four files: the new compiled
fixture controls plus the existing real production RPC/Writer lease, epoch,
budget, deliberate stall and owner-lifetime cases. The five new controls were
then rerun after tightening their failure cleanup. They verify current source
identity, exact output/input tamper refusal, idempotent multi-worker artifact
retention, browser-build rejection of Node-only imports and the existing runtime
network refusal with an owned loopback sentinel receiving zero requests.
Serial workspace types, scripts types and guard each exited zero.

Earlier author attempts are retained: direct builder import failed esbuild's
jsdom typed-array invariant; the next attempt exposed a global URL/Vite asset
rewrite in the new helper. Native Node compilation and the existing `NodeURL`
pattern corrected those fixture errors. The initial lane also retained two
legacy scalar-RPC timeouts; no existing timeout or assertion was changed.

Process-exit cleanup alone left five owned fixture bundles in an earlier pass.
The explicit worker lease cleanup replaced that assumption. Those old residues
were positively identified by owner, canonical temporary path, allowed file
set and recorded source/output hashes, then removed after checks were terminal.
Final inspection found zero owned Node/esbuild processes and zero fixture bundle
roots. Diagnostic packages/logs remain retained. No full suite, Next rebuild,
browser, provider, model, companion activation, reference fixture or production
operation ran in this author cycle.
