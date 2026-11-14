# Discarded clean History capture

This source correction is isolated from frozen `7a911ff5`. A real hook/SDK
regression reproduced a replacement in the microtask gap after the private clean
capture resolved and before `pause()` accepted it. The capture had paused native
history and retained its private `captured` flag. The hook correctly refused the
stale pause, but retained no resume closure. Later observation of a genuinely
issued replacement lease therefore requested no kernel rebuild: the orphaned
capture continued to suppress normal replacement forever.

The initial RED is `/tmp/workbook-discarded-clean-capture-red.log`. It uses the
actual editor hook, hook-issued lease, actual SDK controller and actual
`prepareCleanResume` result. No capture ticket is fabricated or decoded. A
controlled quiescence promise places actual `ready()` replacement in the exact
nested microtask; positive assertions prove real capture preceded replacement.

The hook now owns a per-attempt abort signal, linked to the old Writer run only
until capture acceptance. Stale/refused/thrown capture aborts that attempt. The
private owner retires its discarded resume closure and clears its capture marker,
then only an actual issued, current owned replacement can request the normal
one-time kernel rebuild. The old revoked kernel stays fenced; cancellation does
not unfreeze it, rebind its Writer or restore source/ACK/native data from JSON.

Acceptance detaches the old-run signal before the normal Writer close. That close
therefore cannot cancel a valid retained no-effect handoff. Successful private
resume removes the attempt listener, rebinds through the existing private checks
and releases the original freezes. Abort/disposal/refused handoff retires the old
closure; checks before and after quiescence prevent a discarded closure from
transferring authority later.

Four focused Worker-free cases cover actual Writer replacement, same-byte source
object replacement, revoked ownership without any new owned lease, and accepted
capture followed by normal close/no-effect resume. They assert one reset only for
a genuine new owned replacement, old history refusal, unchanged SDK snapshot and
native checkpoint, unchanged protected source/ACK state, and zero HTTP save/load.
The source-pointer case explicitly commits real React props at the selected task
boundary. An initial batched uncommitted rerender did not create that boundary;
its failed assertion is retained in the first expanded-run log, not called a
second product failure. No production flushSync or timing delay was added.

The quiescence/freeze adapter is controlled for this scheduling test. It does not
prove actual formula Worker draining, full authored-cell blocking, a packaged
browser, real restore/worker receipt or process-kill crash behavior. The private
capture/controller and hook lease transitions are real; the original capture
is never reconstructed. Those broader checks remain separate integration work.
No runtime, build, API fixture write, installer pin or publication changed.
