# Motion control lifetime

The host playback row now belongs to one active preview frame/document lease.
Removing, deactivating, loading or disposing that owner emits a matching
`studio:motion-unavailable`. New host commands echo `controllerId`; an obsolete
command cannot drive a replacement owner. This bridge does not pause media:
existing preview activity remains the only pause/activation owner.

WindowProxy identity survives navigation. The existing probe/request exchange
therefore has an additive current-document check: new players always advertise
`probeVersion: 1` in initial requests and state, and echo a bounded parent probe
nonce in requests. A load withdraws the old lease and issues a new nonce. Capable
state is admitted only for its current nonce-qualified document ID. A genuine
player that reports before load is challenged again after load; its ID is not
blacklisted. Capability survives parking of the same iframe, preventing a queued
unversioned state from downgrading it. Records/listeners are retired when frames
leave the surface; capability alone is a weak reference, not retained history.

## Compatibility and limits

- New host + new companion: owned state/commands and exact matching withdrawal.
- Old host + new companion: extra state fields are ignored; parent commands
  without `controllerId` retain basic playback. These legacy commands cannot
  claim owner freshness and are explicitly the compatibility fallback.
- New host + old companion: unowned state and commands remain accepted. The old
  companion cannot emit the new withdrawal protocol, so its stale-row lifetime
  is not repaired by the new host alone.
- Unversioned players in the new companion retain basic playback until that
  frame advertises probe capability. They have no current-document freshness
  guarantee; capable frames never downgrade through a missing version field.

The new messages do not grant source access or weaken the exact parent/project/
origin checks. Opaque preview messages still require the exact mounted active
iframe; wildcard target origins remain necessary for that existing sandbox.

## Source qualification

Four genuine pre-change bridge cases failed for removal/deactivation, stale
commands and retained WindowProxy load handling. The player echo regression also
failed against its old runtime. Final focused qualification passes 29 web cases
(including existing activity/playback), eight shared runtime cases, separate web
and full workspace types, and repository guard. No retired-ID blacklist ships.
The initial draft's first-load hazard was found during source analysis and fixed
before qualification. Source tests cover pre-load state, nonce replacement,
capability downgrade, parking, cleanup and legacy basic playback.

At this source checkpoint packaged qualification had not run. The subsequent
local candidate110/53 checks below repair one control-lifetime gap; they do not
qualify every media format, annotation or export path.

Independent review found an inactive-load liveness gap in the first checkpoint:
its active-only lookup discarded the current nonce reply while hidden, but the
existing activation probe does not repeat that nonce. Two regressions failed
before correction (inactive load and deactivation before the initial reply).
They intentionally publish only raw state after reactivation, without generating
a fresh handshake in their helper. Nonce replies now accept the exact contained,
connected frame while inactive; state publication and controls remain active-only.
The corrected focused activity/player/bridge suite passes 31 cases, with web
types and repository guard. No frozen package was built from the failing source.


## Local candidate 110/53 checkpoint

Clean source `5b6b39dfc487dd63962236416d6fc1e4a0b43e85` produced companion
build `bd0a08bfa356fd6bc70ee8b7666aaa078d0dadf096b500b891a5e9705d9dae28`
and actual renderer image
`sha256:0a7bced276c8e1b435481e778b8e1ea202badb65855e290eb99ba82173fdc6fb`.
No source overlays were used. A separate production-mode native test stack on
7361 required the unpublished-candidate override; no publication or installer
qualification is implied.

Actual owned GSAP/audio playback covered replay, held pause, exact pointer seek,
mute/unmute and user-enabled decoded audio. Artifact-link navigation to static
content withdrew controls; Back restored a replacement owner. Delayed old-owner
messages could not control or clear that replacement. Actual file revision and
removal/restoration flows withdrew/restored controls. The native audio fallback
played its full eight-second local WAV. Chat/fullscreen transitions retained the
outer Studio iframe and clock. Wide/narrow light/dark artifact views were inspected.
The paired native checkpoint records cropped images and detailed limitations.

OS audibility and retained inactive motion-document reactivation remain unverified.
Public chat/fullscreen transitions do not deactivate the inner player. A scratch
same-srcdoc reassignment instead reloaded the lazy transport shell; its timeout
is invalid harness evidence, not a product handshake failure. No source change
was made from it. The initial removal oracle counted an inactive auxiliary frame
outside ArtifactSurface; the corrected scoped check retained that observation
and proved withdrawal without requiring global iframe absence. A rapid keyboard
seek sequence did not reach its assumed position; exact pointer seek is the
qualified positional check. All owned stack, model, browser, companion and
Postgres resources were stopped. Production and shared previews were untouched.

The later normal main merge is source integration only; it does not relabel the
immutable 110/53 pair as containing later worksheet or comment changes.
