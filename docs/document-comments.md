# Structured document comments

Rich HTML and Markdown documents use the same authorized project comment
storage, idempotent root writes, reply API, author permissions, status changes,
mentions and contextual Evebot chat handoff as other artifacts. Comment actions
come from the existing native artifact header; the document supplies a compact
resizable comments pane, not an HTML picker or a second editing surface.

## Anchor contract

The document identity adapter preserves existing block IDs across import/export.
Missing IDs on initial import are deterministic from the authorized source hash
and block ordinal, so comment-only reopen needs no document write. Subsequent
insertions/pastes keep the existing UUID ownership transform.
A version-1 structured anchor records start/end block IDs, UTF-16 text offsets
and the exact selected quote (up to 4,000 characters, offsets up to one million).
It is stored as inert versioned JSON with the `eve-document-anchor:` prefix in
the existing target `htmlHint`; `filePath`, `elementId`, selector and selected text
remain ordinary comment context. It never inserts a comment span into the file. A shared pure codec strictly
bounds the payload, identities and offsets. SQLite preserves canonical valid
structured anchors in the existing TEXT column; malformed/oversized reserved
payloads fail before writes. Generic HTML hints retain their old whitespace
normalization and 180-character limit. Saved-document chat context carries the
full bounded quote instead of the generic 160-character excerpt. Human-facing
quote previews also decode that payload; saved/editing thread quotes preserve
whitespace and scroll within a bounded focusable region. List previews remain
compact. Pointer and keyboard resizing both follow the pane's text direction.
A selected thread resolves only when both block identities, offsets and quote
still match. Changed/deleted text is explicitly unavailable; the thread remains
readable. There is no fuzzy retargeting or coordinate-based canvas selection.
Forward/backward selections, split inline text, Unicode, line breaks and
cross-block ranges are covered by actual Lexical tests. Viewing mode uses a
DOM text selection mapped through the current Lexical editor, without enabling
editing. Invalid/collapsed selections cannot reuse an earlier valid selection.

## Drafts, scope and permissions

Unsent roots, replies and pending chat handoffs participate in the existing host
navigation/beforeunload guard. Root CAS baselines, failed-save identity reuse,
reply revisions and attachment preservation use existing implementations.
Typing while an older save completes does not replace newer text. An agent's
file refresh waits while a comment draft is dirty. Explicit reload confirmation
also captures the document/comment revision so newer typing cancels that reload.
Viewer/project/file remounts withdraw old controls and asynchronous callbacks.
These composer drafts are in-memory, matching existing comment composers;
there is no new offline draft store or queue.

Author permissions come from the existing shared helpers and remain server
validated. Thread resolve/reopen and reply editing/deletion reuse the existing
components. `@` suggestions use only the current host-provided bot directory.
Adding a saved comment to chat stages its selection, note and file context;
it does not send a message autonomously. Rejected handoff remains retryable.

The paired native header recognizes additive `markupAvailable` (default true
for existing companions). Structured documents advertise false because this
slice supports text comments, not document markup. Other artifact envelopes
remain unchanged when that capability is omitted.

## Qualification

Focused component tests exercise the real Lexical editor, header control
receiver, composer/mentions, root/reply CRUD, resolve/reopen, foreign-author
affordances, draft retention, source refresh, confirmation races and chat
handoff. Existing comment-write/CAS/authority suites cover reused storage
semantics. No model calls, services, paired packages or Docker images were used. Only
owned source/dependency compilation was used for focused tests/types; the own
SQLite binding was verified against the pinned package and Node ABI.
Packaged persistence/reopen and visual acceptance in light/dark mode, chat-open
and full-screen layouts remain required; do not claim Claude visual parity
from these component tests. The retained reference records a compact selected-
content header, replies and Resolve. No fresh Claude session was available.

## Retained reply list navigation source checkpoint

Manual inspection of local companion 109 found inconsistent navigation: the
in-card All comments control retained an unsent reply without prompting, while
the native header's Show all comments asked to discard it. Accepting that
confirmation still retained the exact reply. The fake source remained 281 bytes,
SHA256 `3e7fb3c71f1d54177d778ff94a562504ae775c3732cd28176445556654b82cac`,
with one existing comment and no replies. The unsent draft was cleared and the
owned browser closed normally; no chat handoff was requested.

The next source change treats host list navigation as retention when a saved
thread is selected and its root is not being edited. It keeps that thread and
reply mounted, matching the in-card navigation behavior. Pending root operations
still block navigation. Leaving a new or edited root, closing a dirty reply, and
changing targets retain their existing draft protections. This is an observed
local consistency correction, not a claim about saved-reply behavior in the
reference product.

The actual component regression failed before the change because the denied
confirmation prevented the list from opening (36 other cases passed). The fixed
suite verifies the same reply and thread DOM identities, exact draft, no
confirmation, and no extra reply or document writes, plus pending-handoff and
dirty new/edit-root/close safeguards. Packaged browser acceptance of this source
change remains pending; candidate 109 keeps its original frozen source.

Review found a second inconsistency in the first source checkpoint: after
accepting discard for an edited saved root, returning from the list still showed
that root draft. A real component regression failed on this accepted edit path
while the accepted new-root case and 38 other cases passed. The handler now
resets any root composer after consent before listing comments; returning to a
saved row shows its persisted note. Denied new/edit consent and retained reply
navigation keep their separate protections.

### Removed-thread recovery source follow-up

A separate component refresh removed the selected root while its reply draft
remained mounted. Both list entrypoints hid that draft, but the persisted row
was gone, so there was no route back. Both recoverability regressions failed
before this follow-up (40 other component cases passed).

The list header now reuses a compact back icon labelled Return to deleted thread
only when its retained selection is missing from the current comments. It opens
the same retained thread and reply DOM with the exact draft. The existing deleted
notice, disabled submission, readable draft and close-confirmation behavior stay
in place. There is no fake persisted row, new storage, history or automatic write.
The recovery control is disabled during a busy root operation.

Viewing mode keeps the same member's retained reply available. A different
existing boundary remains unchanged: withdrawing the member identity resets the
reply scope and clears its draft before showing a disabled reply field. An
initial combined test incorrectly expected draft retention across that identity
boundary; separate final cases verify stable-member Viewing-mode retention and
identity-withdrawal reset/disabled-write behavior. This source checkpoint does
not claim cross-account draft retention. Packaged browser acceptance is pending.

### Expected missing-thread reads

The actual 112 deleted-thread walk-through retained the reply and disabled its
writes, but the reply poll's 404 also displayed the generic red Comments could
not be loaded message beside the accurate deletion notice. The next source
checkpoint distinguishes read failure from write failure. Only a typed 404 read
for a root already confirmed deleted uses the existing deletion notice alone.
An unconfirmed 404, permission/server refusal or network failure remains a
retryable load error; write failures remain visible even after deletion.

Initial-load and polling/deletion-transition component cases failed before this
change (two failures, 30 passing cases). Final cases retain the exact reply,
disable submission, cover 403/500/network errors and preserve a failed write.
Abort signals, request versions, thread/member reset, draft protection and the
underlying requests are unchanged. This is source verification; actual packaged
browser acceptance of the notice-only change is still pending.
