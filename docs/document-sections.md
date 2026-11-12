# Document section navigation

The document header has an icon-only Outline entry. It opens a compact,
viewport-bounded list of actual Lexical headings in document order. Heading
levels indent the list; duplicate titles retain their existing stable document
block identities. Blank headings read “Untitled section”. Documents with no
headings show an empty state rather than adding content.

The same live outline updates after heading edits, insertion, deletion and undo.
Selecting a section resolves its identity again, scrolls to and focuses its
actual heading in the mounted editor, in both Editing and Viewing. A deleted
queued target never falls back to a same-named heading. Navigation changes no
Lexical nodes, source bytes, save intent, comment draft, or chat destination.
The temporary DOM focus target is removed on blur/unmount and is not serialized.

Opening focuses the selected or first section. Arrow keys, Home and End move
within the section list; normal button activation selects a heading, and Escape
closes the list and restores the trigger. The popover uses the shared BoardUI
surface, semantic tokens and a bounded width/height; heading focus uses the
semantic focus-ring token. No source-file browser or second document editor is
introduced. Suggesting and revision history are separate capabilities.

Focused tests exercise the actual Lexical editor, duplicate identities, real
heading edits/undo, deletion before a queued jump, read-only navigation, focus
and cancellation, unchanged serialized content/no navigation-triggered save,
and a retained selected-text comment draft. Placement is a restrained mapping
of the recorded section-navigation requirement, not a claim of a fresh Claude
visual comparison. Final light/dark/narrow/chat visual qualification remains
pending. No browser, build, service or model is used to qualify this source slice.

The bounded outline list reuses the shared BoardUI `ScrollFade` and
`useScrollFade` primitive. Its stationary overlay sits outside the scrollable
navigation, resets at the top and on reopening, and cannot intercept pointer
input. A focused component regression checks those transitions without any
source save. Light/dark, narrow viewport, zoom and placement remain packaged
visual acceptance gates; this follow-up does not claim browser qualification.
