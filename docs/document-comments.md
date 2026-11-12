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
full bounded quote instead of the generic 160-character excerpt.
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
