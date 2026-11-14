# Explicit synchronous history dispatch development checkpoint

Controls remain off. This dependency checkpoint does not install worksheet
history interception, grant retained descriptors, or qualify complete pending-save
Undo/Redo. It adds optional `ICommand.syncHandler`: synchronous execution chooses
it explicitly, while async execution still uses the normal handler. Existing
`asyncOnly: true` registrations continue to refuse before either handler.

## Why this boundary

The pinned full workbook plugin set registers the exact known base Undo and Redo
commands; public identity-scoped replacement succeeded and restored them normally
in an actual initialized UI. The existing multiple-implementation replacement
refusal remains strict. Blanket `asyncOnly` replacement would nevertheless break
native Docs `DocClipboardService.changePasteMode`, which calls synchronous Undo
and sometimes Redo. It cannot delegate after the unconditional refusal.

An explicit synchronous handler is smaller than a new execution interceptor or
mutable execution-mode stack. A future scoped owner can synchronously delegate
unrelated editor history and refuse relevant protected sheet history without any
async callback. The async handler can await protection, revalidate the actual
focused-history checkpoint, lease, issuer and registration, then invoke the same
known native handler. Imported names or matching metadata never choose authority.
No exported SDK command object is mutated and no base implementation bypasses a
resolved multi-command dispatcher. Installation must refuse unknown registrations.

## Source evidence

Two tests genuinely failed on the previous implementation: synchronous execution
invoked the async handler instead of the explicit sync result/refusal. The strict
asyncOnly negative already passed. The final seven new cases plus existing related
boundaries pass28 cases across4 files, including actual ES/CJS/compat entry loaders,
params/options identity and listener order. Standalone UMD remains unconsumed and
unqualified. The patch and lockfile retain every preceding boundary.

## Actual isolated SDK UI probe

The local-only scratch probe used the pinned App plugin order, CSS, actual classic
formula worker/RPC, source grid/axis identity and actual calculation adapter, with
made-up data. Native header/toolbar were enabled only to exercise their dispatch;
Evebot hides that native toolbar. It was not the Evebot shell or a production
companion build, and its deferred gate was not durable journal storage.

Observed manually through a separately named Chromium session:

- Baseline keyboard and native toolbar Undo/Redo each changed17→12→17.
- With a scoped prototype installed, protected workbook sync Undo refused with
  value17 and unchanged history, with no queued async protection or delayed edit.
- Real CtrlZ held17 and the same native checkpoint until the gate opened, then
  changed to12. Native toolbar Redo similarly held12, then changed to17.
- A real standalone Doc in the same kernel accepted clipboard text. Choosing
  native Paste options → Keep text only used the synchronous Undo delegate and
  retained the complete pasted text. The formula worker remained live.
- Formula-bar keyboard Undo targeted its actual internal Docs history. Explicit
  sync Redo/Undo changed that editor's empty→9→empty stream while workbook17
  remained unchanged.

The first scratch attempt omitted the App calculation adapter, so the guarded
worker correctly withdrew on an untagged edit. That was an invalid probe setup,
not a product failure; corrected final runs retained live worker ownership. CSP
permitted SDK-created blob worker scripts but all asset/network origins stayed
loopback. The scratch browser, worker/kernel and listener were closed normally;
its unused loopback port24684 was verified free afterward. No shared preview,
production, credentials, model calls or publication were involved.

Remaining gates: actual Writer pre-pop durability, live descriptors and restored
configuration selection, lease/focus/revision interleaving, same-kernel own-ACK
history, membership worker input epochs/results, lost-ACK recovery, contained
historical assets and packaged light/dark application behavior. This source seam
and prototype do not satisfy those remaining feature gates.
