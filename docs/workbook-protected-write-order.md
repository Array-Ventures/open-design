# Protected checkpoint write ordering

Generic Writer persistence now captures its current checkpoint when the queued
write reaches its serialized storage turn. Previously it captured when queued:
a provider checkpoint requested during a blocked precommand write could retain
an older context pool and desired snapshot, then overwrite the protected root
after the real native Remove had already completed.

The actual SDK regression blocks the exact validated precommand candidate,
queues the provider's normal checkpoint callback, permits Remove and holds the
first subsequent storage attempt. Before the fix that attempted checkpoint had
no deletion context and still contained the removed sheet. After the fix it has
the retained context and current desired deletion. Original pending intent,
source/receipt transfer and subsequent save remain owned by the same Writer.
Explicit precommand writes still use their exact prospective validated candidate.
No callbacks are dropped and no write waits for runningSave or for itself.

A failed earlier storage write does not block the latest queued branch. Closing
still drains queued callbacks before ownership can release; updates after disposal
are ignored. The new lifetime regression keeps the final old draft at20 and a
subsequent independent Writer/draft scope at30 without cross-scope writes. The
existing late-transport checkpoint, lease, cancelled-preparation, ACK-before-
retirement and failed-transfer tests remain green. This is source-level Writer/
SDK/journal proof, not a new packaged browser qualification.

70 affected cases across five files, full repository typecheck, guard and diff
check passed. No artifact source file, container, runtime, production or quota changed.
