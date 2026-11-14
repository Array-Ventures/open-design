# Correlated membership probes after listener handoff

Candidate 132 installs an early worksheet-management listener while the private grid initializes. After the existing visibility publisher is installed, that publisher becomes the sole management dispatcher and removes the early listener. Its dispatcher forwarded membership actions and version-one artifact negotiation but omitted `studio:workbook-membership-probe`. A legitimate correlated readiness probe arriving after handoff was therefore dropped.

The correction adds only that message type to the existing delegation branch. Parent-window and same-origin checks still run before delegation. The existing membership handler retains its strict probe schema, exact project/controller checks, lifetime disposal, and correlated readiness reply. The probe supplies readiness correlation only; it neither creates an executable owner nor changes worksheet capabilities or source authority. Blocked views can answer the same readiness probe without executing an action.

## Source regression

The new test installs the actual visibility listener with the actual membership bridge and a real pinned SDK workbook fixture. No early Grid listener is registered, and the probe is dispatched through the one installed window-listener callback. Before the production change, a valid correlated probe produced zero readiness replies: `/tmp/workbook-late-probe-red.log`. With the routing correction, it receives the matching reply. Wrong parent, foreign origin, wrong project/controller, invalid version/UUID and extra fields remain refused. After publisher disposal no listener or reply remains, no execution callback is called, and the actual SDK snapshot is unchanged.

This is installed-listener and SDK source evidence, not an immutable-browser startup qualification. Candidate 132 and its existing browser evidence remain unchanged. The fix does not claim to resolve the separate occasional worksheet-controls-change notice or stored-result/repaint observations.

Author checks: 44 affected cases across live visibility, live management, membership bridge and legacy visibility passed. Full workspace `pnpm typecheck` and `pnpm guard` exited 0; logs are `/tmp/workbook-late-probe-types.log` and `/tmp/workbook-late-probe-guard.log`. Frozen install and diff checks also passed. No Worker, browser, package build, runtime switch, pin or publication was used for this checkpoint.

## Later immutable-browser qualification

The separate [133/76 record](workbook-live133-qualification.md) now qualifies two
actual late correlated probes after normal private worksheet controls were
already enabled. Both replies match the current document/epoch and distinct
probe nonces; saved source bytes remain exact. That bounded actual result does
not relabel the source-only checkpoint above or candidate 132, and does not
qualify the complete startup, controls-change notice or stored-cache matrix.
