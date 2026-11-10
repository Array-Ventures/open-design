/** A fenced lease drains bounded HTTP requests before the host stops the companion.
 * It does not freeze filesystem watchers, bot sandboxes or other databases. */
export class EmbeddedWriteGate {
  private lease: { owner: string; epoch: number; deadline: number } | null = null;
  private epoch = 0;
  private writes = 0;
  constructor(private readonly now = () => performance.now(), private readonly ttlMs = 60_000) {}

  private current() {
    if (this.lease && this.lease.deadline <= this.now()) this.lease = null;
    return this.lease;
  }
  acquire(owner: string, expectedEpoch?: number) {
    const lease = this.current();
    if (lease && (lease.owner !== owner || expectedEpoch !== undefined && expectedEpoch !== lease.epoch)) return null;
    // A heartbeat cannot silently reacquire an expired lease with a new fence.
    if (!lease && expectedEpoch !== undefined) return null;
    this.lease = lease ?? { owner, epoch: ++this.epoch, deadline: 0 };
    this.lease.deadline = this.now() + this.ttlMs;
    return this.status(owner, this.lease.epoch);
  }
  status(owner: string, epoch: number) {
    const lease = this.current();
    if (!lease || lease.owner !== owner || lease.epoch !== epoch) return null;
    return { owner, epoch, expiresInMs: Math.max(0, lease.deadline - this.now()), activeWrites: this.writes, requestsDrained: this.writes === 0 };
  }
  release(owner: string, epoch: number) {
    if (!this.status(owner, epoch)) return false;
    this.lease = null;
    return true;
  }
  enterWrite(): (() => void) | null {
    if (this.current()) return null;
    this.writes++;
    let finished = false;
    return () => { if (!finished) { finished = true; this.writes--; } };
  }
}
