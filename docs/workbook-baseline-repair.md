# Workbook baseline repair

This bounded checkpoint is based on `87e63fa8`. The earlier comparison of the
keyboard candidate and clean baseline retained all eleven full-web failures;
there were no candidate-only failures. This repair does not qualify a new
packaged runtime or repeat the full web suite.

## Confirmed product correction

The confirmed-paint manual-edit test failed on the baseline. A stricter
assertion localizes replacement to entering Edit a second time, before any
second save. Temporary payload-free diagnostics showed the first save correctly
installed its new source fingerprint, then the asynchronous exit handler
replaced it with the pre-save fingerprint captured by its older render.
The next render consequently retired the otherwise valid latch.

Exit now uses the current saved source, applying the existing deck visual
normalization, for its structural-retention fallback. It cannot overwrite a
newer paint proof merely because the old render described the old document.
Paint verification, failed-proof reload, external-source invalidation, explicit
reload and scoped transport identity remain unchanged. All 33 manual-edit cases
pass, including failed paint, watcher echo and later external replacement.

## Fixture contracts corrected

- Recovery deletion fixtures explicitly declare the membership capability
  required by the existing deletion guard. A new negative proves removing that
  permission still refuses before native mutation.
- Surface and structural recovery host seams return the full applied receipt,
  bound to each actual operation/project/file/source/render identity and fresh
  target. Legacy history fields remain null: these fixtures grant no automatic
  historical Undo authority. Incomplete and wrong-operation receipts retain the
  dirty/error state and do not publish a successful save.
- The structural callback assertions include its current second, undefined
  history-ticket argument instead of omitting that argument.
- Undoing an unsaved private birth does not erase its protected journal while
  its exact native Redo remains reachable. The test now checks the retained
  serialized descriptor and independently performs the real Redo. This does not
  change Writer retention or lease-end cleanup behavior.

## Author qualification and remaining uncertainty

Three final focused commands passed 127 distinct cases across nine files:
33 manual-edit cases; 41 workbook fixture cases; and 53 provenance,
protected-root-retirement, actual calculation-worker and Writer-lease cases.
Serial workspace types, scripts types and guard each exited zero.

A separate unchanged Writer-lease run failed one of eighteen cases because its
owned Node RPC worker did not become ready within the existing five seconds.
The same case later passed in the 53-case neighbor command. Its root cause is
unproven; no timeout, startup, restart or cache behavior was changed, and this
checkpoint does not claim to have fixed that refusal. The earlier full-suite
failure, first fixture correction failures and all diagnostic logs are retained.

The evidence JSON hashes the six owning source/test paths and sixteen retained
logs/receipts. Temporary diagnostic statements are absent from the qualified
source. The keyboard branch is untouched. No browser, current preview, service,
companion pair, renderer, reference content or production data was changed.
