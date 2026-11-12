# Retaining feedback while opening artifact chat

An unbound artifact opened from the library first asks for a chat destination.
Choosing a chat on a compact viewport hides the existing Studio frame until
Return to artifact. Its DOM host temporarily measures zero width and height.

The comment composer previously selected its React portal from those layout
measurements. Zero geometry switched it to an inline child, and return switched
it back to a portal. The artifact iframe and selected comment survived, but the
mounted reply editor and its fresh attachment files did not.

Portal ownership now follows the actual comment host DOM element. Geometry
remains positioning data; it does not select another component owner. This is
not a conversation-keyed draft cache or a new feedback store. Existing project,
file, access and actor boundaries remain responsible for withdrawing their
surfaces and canceling old operations. In particular a same-human context
refresh retains the reply; a different viewer identity still clears its private
text and pending images. No reply or chat message is sent by hiding or returning.

Qualification: an actual FileViewer/SavedCommentThread component regression
reproduces the old zero-layout remount with a reply and fresh image. It passes
with stable portal ownership; separate real host-context messages verify the
same-human refresh and actual actor-change distinction. Existing comment scope,
thread and composer cases remain green. A native paired Playwright regression
covers library → Choose artifact chat → compact selection → Return to artifact,
including DOM identity, slide, reply/image retention and no send. That browser
spec is authored and typechecked but not run in this source-only slice. Final
packaged visual and browser acceptance remains separate.
