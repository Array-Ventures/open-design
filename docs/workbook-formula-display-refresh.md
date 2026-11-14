# Scalar formula display invalidation

Candidate 131/74 calculated and saved newly entered scalar formulas correctly, but their canvas text could remain blank until a view rebuild. This is separate from the numeric input correction and the worksheet-management popup notice.

## Actual candidate 131 observation

An owned made-up workbook was edited through the installed browser CLI 0.43.0, using pointer and keyboard input only. On its saved `NumericData` worksheet, changing A1 from 28 to 29 immediately displayed existing formula results 29, 28, and 57. Entering `=SUM(A1)` into previously blank G1 left G1 visibly blank before and after Save. Independent ZIP/XML inspection found G1's formula and numeric cache 29 in the saved file. Clicking Zoom out from 100% to 90% displayed 29 without reloading or changing the source. Returning to 100% and switching away and back retained the visible result.

The scratch receipt is `/tmp/workbook-numeric131-ui/display-reproduction.json`. The browser closed normally, its captured session was signed out through the normal JSON endpoint, and Light mode and 100% zoom were restored. No model calls, messages, programmatic cell writes, or private controller inspection were used. Full-host screenshots remain private scratch evidence.

## Rendering-only correction

The pinned public worksheet `refreshCanvas()` facade recalculates the sheet skeleton and marks render components dirty. Scalar calculation now requests this invalidation after publishing its display state and after checked source-cache rebasing, as the existing array calculation adapter already does. Early requests coalesce until the SDK reaches its Rendered lifecycle stage. The adapter checks current render availability and workbook identity; disposal fences delayed readiness and further paint requests.

This does not modify source cells, calculation inputs, accepted results, cache provenance, leases, history, or writer authority. Existing admission and display policies remain unchanged.

## Source evidence and remaining qualification

A real pinned SDK `SpreadsheetSkeleton` regression first stores the null intercepted view of a newly authored formula. Matching graph and scalar-result admission then produces `sheet.getCell().v === 2` and calculated status, while the old skeleton font cache still contains null. The unchanged source fails on that cached value. The corrected adapter refreshes the real cache through the test's render-facade callback and passes. This is SDK cache evidence with a controlled render endpoint, not a screenshot or full renderer test.

Additional lifecycle cases cover render readiness, a replacement workbook, disposal before readiness, and checked source rebasing without live-input changes. The first five existing calculation-completion cases remain intact. Earlier scratch probes that could not resolve the transitive renderer package, omitted explicit SDK constructor dependencies, or omitted the matching formula graph are retained as harness failures; they are not the claimed cache regression.

The source checks cover the completion controller, formula-display policy, and Grid component. Actual browser acceptance of this correction on a new immutable pair remains pending. Candidate 131 remains the unchanged failing display baseline.
