# Artifact comment page scope

The compact comment filter offers **This page**, **All pages**, and the existing
**Show resolved** choice. All pages is the initial scope, preserving the current
list behavior. This page is available while commenting and, on decks, after the
active slide is known. Outside comment mode the list shows all pages without
forgetting the person's previous scope choice.

Pages belong to the current artifact file. For a deck, This page shows the active
slide plus legacy comments without a slide identity; All pages shows all slides.
For a plain HTML page both scopes describe that one page. Neither scope lists
comments from the project's internal files. Structured documents keep their
existing selection-aware surface; this change does not add a document outline.

Changing a filter only changes list membership. It does not retarget the saved
thread, clear a reply/root draft, remove image receipts, close markup, save a
comment, or stage chat. Selecting a different thread still uses the existing
discard guard. Selecting an off-slide deck thread uses the existing slide bridge
inside that accepted retarget, so a refused discard cannot navigate the canvas.
Resolved visibility and existing authorization remain independent of page scope.

Qualification is source/component-level: focused tests cover current-file and
slide membership, resolved composition, disabled scope, actual FileViewer slide
navigation, a retained reply across filters and external slide changes, and root
text/image receipt retention. The two FileViewer regressions fail with the
preceding FileViewer source. No browser, packaged build, service, or model was
started for this slice. Final light/dark/narrow/chat visual acceptance is pending.
