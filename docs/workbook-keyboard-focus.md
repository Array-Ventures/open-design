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


## Menu dismissal follow-up (source only)

Actual candidate 123 preserves focus on a deliberately focused Sheet tabs button,
so trusted Enter opens its menu. This is not keyboard-only Tab reachability:
trusted Tab still enters the canvas and hidden editor. Root's actual Escape
observation then leaves focus on the child document BODY rather than the trigger.

The pinned design DropdownMenu passes its direct child to Radix's `asChild`
trigger. SheetBarMenu supplies a plain, nonfocusable div around SheetBarButton;
Radix therefore holds that div as its focus-return target. The narrow correction
uses the existing design Button, which forwards its ref, as the direct child.
It preserves the localized name, icon, small size, text variant and existing
sheet-bar control marker. It adds no styled component, focus setter, observer,
public type change or keyboard shortcut.

The real standalone SDK producer cases now exercise Enter, Escape, closed-menu
button focus and expanded state before the original two-sheet selection/data
checks. Against the previous producer all six English/French cases across CJS,
ESM and compatibility entries fail at the focus assertion, with BODY active.
The correction passes all six alongside the existing 24 layout-policy cases.
A frozen installation, full workspace typecheck and guard also passed.
These jsdom producer/service tests do not include the complete rendered grid or
prove trusted browser modality, Tab reachability or host chat focus. Candidate
123 remains the original b7 source; this follow-up requires a new immutable
pair and actual keyboard/pointer acceptance before any packaged claim.


## Scoped sheet-menu chord (source only)

The consumer now registers Alt+Shift+K (Option+Shift+K on Mac) for the existing
public `ShowMenuListCommand`. This matches the documented Google Sheets
[Display list of sheets shortcut](https://support.google.com/docs/answer/181110?hl=en).
The inspected pinned SDK entries and host shortcuts have no matching binding.
Chrome's [published shortcuts](https://support.google.com/chrome/answer/157179?hl=en)
reserve F6 for browser focus; no F6 or Tab behavior is changed here. Operating
system, keyboard-layout and extension overrides are not universally qualified.

The binding uses the SDK shortcut service, not a new host key listener. It requires
the current ready grid and the SDK's focused, nonediting sheet context; drawings,
retired sources, history/discard pauses, pending saves and errors do not admit it.
Navigation is independent of write permission, so an otherwise ready read-only
workbook can view and switch sheets. The grid owner disposes the registration; CSV views without a sheet bar do not
install it.
The original first-cell shortcut retains the same scoped readiness policy.

The native trigger's title derives the platform display from the actual shortcut
service registration and subscribes to its changes. A standalone producer with no
binding has no shortcut title; registering and removing the binding updates it.
The existing forwarded native Button remains the direct Radix child. No wrapper,
extra toolbar, custom focus handler or hardcoded translated shortcut label is added.

A real SDK shortcut-service/window-listener fixture invokes the actual public
menu command and SheetBarService callback. Two baseline cases fail for the absent
binding/invocation; the negative control already passes. All three pass with the
registration, alongside a CSV no-menu control: editing, unavailable readiness, wrong sheet context and outside
layout owners do not consume the key; disposal removes dispatch and display.
The fixture supplies layout containment and child-runtime lookup through the
public service constructor rather than running a complete rendered grid. Its
edit-API sentinel and unchanged workbook snapshot guard against edit calls.
The six localized real menu cases additionally prove registered title updates,
Escape focus return and original two-sheet switching. Together with the 24 focus
policy cases, all 34 pass. Frozen installation, full workspace types and guard
also passed. Actual packaged trusted-chord entry before/after cell
editing, dismissal, host chat focus and source preservation remain pending; no
new pair, runtime change or keyboard-only browser claim is included.
