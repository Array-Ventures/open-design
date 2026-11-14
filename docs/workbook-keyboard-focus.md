# Workbook keyboard focus ownership checkpoint

An actual local 122 full-grid diagnostic distinguished two paths. Trusted Tab
navigation from the host header entered the SDK's positive-tabindex canvas and
then its hidden editor; further Tab/Shift+Tab used grid navigation. Those Enter
attempts never reached the menu and are not evidence that its Enter handler is
broken. Separately, CLI focus reached the real **Sheet tabs** button, after which
the SDK immediately returned focus to the hidden editor.

A transparent native-focus observer delegated to the original implementation
and recorded `DesktopLayoutService.focus` through the registered sheet focus
handler. The pinned service's window `focusin` listener includes the generic
`sheet-bar-append-button` control kind in its queued editor-return policy. The
initial hypothesis that only the consumer's auto-focus context caused this was
not supported by that stack. The public plugin override replaces an entire
layout service; it offers no narrow focus-policy callback.

The maintained UI producer patch instead respects keyboard focus-visible native
and semantic interactive controls in the existing listener. A queued return also
rechecks its target's current focus, current root containment and keyboard
ownership. Canvas and pointer-toolbar return behavior is retained. The change adds no
Sheet-tabs-only bypass, observer, focus setter, global consumer monkeypatch or
replacement service.

The final unchanged fixtures against the original producer genuinely fail 18
cases, while six pointer/canvas/input controls already pass. The corrected
producer passes all 24 policy cases across CommonJS, ESM and compatibility
entries, plus the six existing English/French menu cases. They use the real SDK
layout service/window listener, workbook/context and public focus registration.
The native `:focus-visible` result is explicitly modeled for jsdom; an actual DOM
editor callback is registered instead of a complete canvas/render-engine stack.
These cases do not claim trusted browser keyboard entry or editing acceptance.
An initial extra modality fixture recursively wrapped its own observer, causing
three unhandled setup errors; the reference was corrected, and the clean final
run exited successfully without those errors. Frozen installation, full workspace
types and guard passed. The earlier failure log is retained.

The diagnostic browser restored Dark and the first sheet, removed its read-only
observers, restored the pass-through native method and closed normally; its named
process was absent. Source bytes stayed exactly 6,775 bytes, SHA256
`368a1e57b2de4916f8fc975c2fd75c2f31f691c02ac39a36ef92594cf35cd627`.
No cell edits, saves, exports or messages were made. Local trace and artifact-only
captures remain under `/tmp/workbook-keyboard122-diagnostic/`; none are committed.

A new matched immutable pair still needs actual full-grid acceptance before and
after canvas entry and F2 activity: keyboard menu entry and dismissal, toolbar and
Zoom input/popover focus, real edit/Save/Undo, and retention of chat drafts. Local
122 remains unchanged and is not relabeled as a build of this correction. No new
package, runtime activation, publication or pin update is included here.
