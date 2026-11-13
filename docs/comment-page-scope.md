# Artifact comment page scope

The compact comment filter offers **This page**, **All pages**, and the existing
**Show resolved** choice. All pages is the initial scope, preserving the current
list behavior. In the generic artifact viewer, This page is available whenever
the current page is known, including a list opened directly from the native header in interactive preview. Decks wait for
the active slide report; while it is unknown the list shows all pages without
forgetting the person's previous scope choice.

Pages belong to the current artifact file. For a deck, This page shows the active
slide plus legacy comments without a slide identity; All pages shows all slides.
For a plain HTML page both scopes describe that one page. Neither scope lists
comments from the project's internal files. Structured documents keep their
existing selection-aware surface with no modeled page boundary, so its page
choice remains unavailable; this change does not add a document outline.

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

The discard guard now binds each pending consent to its current project/file/
authority and composer lifetime, its exact draft revision and one pending
attempt. Unmount, replacement, newer typing or another accepted retarget makes
the old consent inert. Tests include delayed affirmative responses after each
boundary and the unchanged normal confirmed retarget. These are local UI
lifecycle fences, not a change to server authorization.
