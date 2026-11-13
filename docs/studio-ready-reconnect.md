# Retained Studio readiness

The embedded provider accepts `studio:ready-request` only from its exact parent
window, at its own origin, for its current project. It replies with the existing
`studio:ready` message without remounting or resetting viewer state. Normal mount
readiness and host-context handling remain unchanged. Removing the provider
removes its request listener.

This closes a protocol gap when a parent readiness subscription reconnects while
the child remains mounted. It does not establish the cause of the two intermittent
native/companion loading failures recorded by Evebot's document-pair qualification.
The native parent must initiate the request and retain its frame/origin/project
checks; that integration and browser qualification are separate.

The real provider regression failed before implementation because no matching
request reply was emitted. The provider/theme suite passes with the change,
including wrong origin/window/project refusals, retained identity and listener
cleanup. Web typecheck and repository guard pass. No package, renderer, preview,
release or publication was changed for this source slice.
