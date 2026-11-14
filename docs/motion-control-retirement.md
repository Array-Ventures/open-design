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

No immutable image, packaged app, chat/fullscreen visual or audible playback
qualification has run for this slice. This repairs one control-lifetime gap;
it does not qualify every media format, annotation or export path.

Independent review found an inactive-load liveness gap in the first checkpoint:
its active-only lookup discarded the current nonce reply while hidden, but the
existing activation probe does not repeat that nonce. Two regressions failed
before correction (inactive load and deactivation before the initial reply).
They intentionally publish only raw state after reactivation, without generating
a fresh handshake in their helper. Nonce replies now accept the exact contained,
connected frame while inactive; state publication and controls remain active-only.
The corrected focused activity/player/bridge suite passes 31 cases, with web
types and repository guard. No frozen package was built from the failing source.
