# Calculation after renaming an unused worksheet

This source checkpoint follows `db9d0bd6` only to retain its independent scalar-render invalidation change. The Rename correction itself adds a host-issued calculation request after a successfully checked private worksheet sequence. It does not change the worker, deadline, result admission, or source/cache ownership policy.

## Actual candidate 131 failure

The owned controls fixture successfully saved an added empty worksheet. Renaming that worksheet applied to the live SDK, but Save stopped at the calculation deadline. Protected recovery retained the desired renamed sheet; the raw workbook remained at the last successful Add. This is separate from rich-run preservation and the occasional host controls-change notice. The actual browser receipt and retained source are under `/tmp/workbook-controls131-ui/`.

## Cause and bounded correction

A private membership sequence advances the real input epoch and requires a fresh scalar pass when formulas exist. An empty sheet's unreferenced name change may generate no dirty formula range, so the SDK's ordinary trigger does not start the required pass. Waiting for quiescence then correctly reaches the existing deadline.

After checking that the exact private sequence completed and its prospective input digest matches the live workbook, the host now executes the pinned public `SetFormulaCalculationStartMutation` with `forceCalculation: true`. The existing host guard stamps the current input epoch, and the existing serialized RPC queue puts that request after the admitted worksheet mutations. The normal worker guard, execution, graph/result provenance, cache application, and quiescence checks remain required. No old derived value is promoted or synthesized.

An earlier attempt used the public formula facade's `executeCalculation()`. In this pin that emits a syncing trigger mutation as well; the worker then scheduled a local Start without the required host epoch, and its existing guard refused it. That failed attempt is retained, and the guard was not relaxed.

## Evidence boundaries

The new regression uses the real pinned SDK, the production formula Worker entry through Node RPC, the actual private worksheet controller, and the browser's two-formula source model. On unchanged source, Add settles and the unused Rename applies, then its quiescence wait rejects at the original calculation deadline. The corrected host-start path settles and retains both formula caches at 12 with a healthy worker.

The first cold attempt failed the unchanged five-second Worker startup bound before entering the scenario; it is not the Rename regression. The warm, source-located failure is `/tmp/workbook-unused-rename-rpc-located-red.log`; the first successful corrected run is `/tmp/workbook-unused-rename-rpc-host-start.log`. Additional regression checks and immutable browser acceptance are recorded separately when completed. Candidate 131 remains unchanged; no source overlay or runtime activation qualifies this correction.

The final serial RPC run passed 30 cases across the existing membership boundary file and the new unused-Rename file. The new case additionally waits for native Undo and Redo of the unused Rename, then renames the referenced source worksheet and checks its updated cross-sheet formula and numeric cache. The existing cases retain held ACK/cache applications, stale and tampered proof refusals, concurrent epochs, protected scalar updates, and Delete/Undo/Redo coverage. No timeout or assertion was loosened. The final log is `/tmp/workbook-unused-rename-rpc-final.log` (84.83 seconds).

Full workspace typechecking and guard passed on the final source (`/tmp/workbook-unused-rename-types.log` and `/tmp/workbook-unused-rename-guard.log`). The frozen install and diff checks passed. These are source checks; a new immutable pair and actual UI Rename/Save/Undo/Redo acceptance remain pending.
