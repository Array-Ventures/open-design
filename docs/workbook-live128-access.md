# Candidate 128 HTTP access qualification

This record covers **131 qualified HTTP requests in two separate lanes: 110 + 21** on the existing owned 6261 preview, pair **128/71**, native `04b852999f19c29501fef961324c5f3e7bc9d88c`. These are request counts, not 131 independent test cases or a count of every exploratory attempt. No application service, access wrapper or response was mocked. No stack restart, configuration, release pin, production update, model call, invite, outbound email or chat message was involved.

## Policy and the 110-request lane

The implemented human policy allows an **active human to read every active private, group and team workspace**. Private means owned by one bot; it does not mean private to one human. Human visibility preferences are list filters, and there is no separate human group-membership ACL to simulate. Bot ownership, group membership and session/thread checks are separate policies and were not exercised by forging an HTTP bot actor.

The first lane used uniquely labelled new bot/group/project rows and one new fake human. Fixture setup used only the owned preview database after checking its identity, avoiding the normal group greeting and bot memory-seeding paths. Revocations changed only those new rows. Real signed-in routes established:

- The existing fixture owner and active fake peer could read all three scopes. Seven workbook-source GET bodies matched the same **6,770-byte** input, SHA-256 `c20f955801f3baaacaee4152c1c75ab9f2fa9a1eb9701500107e241dbadeb97b`. SVG originals downloaded with exact bytes and attachment headers; workbook-source HEAD requests also succeeded.
- Anonymous requests and a spoofed human header returned 401. Cross-project or tampered preview grants, a grant used for a raw path, foreign-project gateway paths and caller-selected workspace queries returned 403. POST to the read-grant route returned 405. Successful grant reads retained the artifact sandbox.
- After the new private bot was deleted and new group archived, the still-active owner received 404 for their project/source/download requests and writes. The deactivated fake peer received 401, and its previously issued grants returned 403. The owner's unchanged team source remained readable with the exact original hash, and its team write remained authorized.

There were **55 expected denial responses** among these 110 requests. Because peer deactivation occurred alongside the scope changes, the peer-grant 403 responses alone do **not** isolate bot/group grant revocation. The separate lane below closes that specific evidence gap.

Receipt: `/tmp/workbook-access128-qualification/receipt.json`. The seven source hashes qualify these copied access fixtures; they are not seven additional editor Save/Undo checks of the core-flow workbook.

## Separate 21-request owner-grant lane

All three read grants in this lane belonged to the **same existing active fixture owner**; no new human was created or deactivated. After only the new private bot was deleted and new group archived, anonymous requests using those owner-bound grants returned:

| Grant scope | Before | After scope withdrawal |
| --- | --- | --- |
| Private | 200 | 404 |
| Group | 200 | 404 |
| Team positive control | 200 | 200 |

The owner also retained normal team-project access. This isolates bot/group grant revalidation from human deactivation and from a general service outage. It does not add a human-private policy or prove bot-session/tool authorization.

Receipt: `/tmp/workbook-access128-grant-scope-final/receipt.json`. Its 21 requests are counted separately from the first 110. A preliminary shorter attempt was not counted: receipt finalization failed at its sign-out assertion, and its exact fixture cleanup is retained in `/tmp/workbook-access128-grant-scope-qualification/failed-lane-cleanup.json`.

## Cleanup and limits

New fixture project, bot, group, fake-human and account rows, source project directories and companion registrations were removed by their exact owned identities. Companion cleanup checked UUID, name, embedded ownership and base directory, with foreign-key cleanup enabled. The first lane verified zero remaining rows for its new fake peer's sessions; **that is not a claim that every fixture-owner session was removed**. Fixture message count was zero. No existing bot, group, user, project, setting or browser session was deliberately changed, and no global preview cache was flushed.

**Two earlier fixture-owner login sessions have unverified cleanup.** Bodyless sign-out returned 415, and their exact session IDs were not retained. No existing owner sessions were guessed or deleted. The final owner-grant lane sent the required JSON sign-out, returned 200, and verified its exact newly created session was absent. Separate manual readback helpers also lacked a session ledger; no broader or aggregate auth-session cleanup is claimed.

The initial companion-cleanup read used a TypeScript column alias; it failed before any deletion and was corrected to the actual SQLite column. That setup correction is recorded in the receipt. No cookie, read-grant token or service credential is included in the receipts.

These lanes cover future HTTP requests after durable revocation. They do **not** qualify bot tool/session actors, bot group-membership withdrawal, in-flight long-stream cancellation, prepared exports or historical asset downloads, live editor lease withdrawal, or the full access/recovery matrix. Existing source-level and earlier stream tests remain separate evidence. This record does not make the live-membership PR merge-ready or production-ready.
