# Workbook history capacity at the commit boundary

Workbook binary history is retained without automatic per-version eviction. Its
manifest admits at most 10,000 entries and 16 MiB; each binary revision is bounded
at 25 MiB. Those limits are retention policy, not a promise that arbitrary future
writes will succeed or a client-side reservation.

The workbook commit coordinator holds the existing canonical-file version lock.
After retaining its checked before-source revision, it constructs the complete
target entry and exact serialized target manifest before replacing working
bytes. UUID, timestamp, parent, label, schema and byte/count admission are shared
with ordinary version creation; publication reuses that admitted manifest rather
than constructing a different entry after replacement.

At capacity, a changed target refuses before working-file replacement and before
publishing any target history entry or blob. An already-current identical binary
can still deduplicate at capacity. If capturing a previously unrecorded source
uses the last entry, its target is refused while original working bytes remain
intact. Existing conditional receipt/CAS and permission checks remain in place.
Unexpected I/O failure after a working-file write keeps the existing uncertain
receipt/reconciliation behavior; this guard adds no rollback or new journal.

The regression reproduces the former deterministic failure: a valid full
manifest passed source capture, working bytes were replaced, and only target
publication rejected the 10,001st entry. Actual pinned-file hashes prove the
ordering failure and fix. Boundary fixtures seed valid large manifests and the
current blob; they do not allocate thousands of duplicate large workbooks.
Positive tests cover 9,999→10,000 and deduplication at capacity; negatives cover a
new before-source consuming the last entry and the real manifest byte bound.
A clock change at the file-write boundary verifies the published target retains
its pre-admission timestamp. These source tests do not establish new worksheet
UI, historical-template restoration or its pending-ACK recovery properties.
