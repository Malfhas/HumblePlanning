// In-memory failure counter with a lockout, per process (like the other
// limiters of the application, see rate-limit.ts). A key is locked for
// `lockMs` once it reaches `maxFailures` failures within `windowMs`; the
// caller clears it on success.

export interface FailureLimiterOptions {
  maxFailures: number;
  windowMs: number;
  lockMs: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

type Entry = { count: number; windowStart: number; lockedUntil: number | null };

/** Expired entries are dropped at most once per minute, on the next failure. */
const PRUNE_INTERVAL_MS = 60 * 1000;

export class FailureLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private lastPrune: number;

  constructor(private readonly opts: FailureLimiterOptions) {
    this.now = opts.now ?? Date.now;
    this.lastPrune = this.now();
  }

  /** Remaining lock time of `key` in seconds, 0 when it is not locked. */
  lockedFor(key: string): number {
    const entry = this.entries.get(key);
    if (!entry?.lockedUntil) return 0;
    const remainingMs = entry.lockedUntil - this.now();
    if (remainingMs > 0) return Math.ceil(remainingMs / 1000);
    this.entries.delete(key);
    return 0;
  }

  /**
   * Records a failure for `key`. Returns the lock duration in seconds when
   * the key is (or already was) locked, otherwise 0.
   */
  recordFailure(key: string): number {
    const already = this.lockedFor(key);
    if (already > 0) return already;

    const now = this.now();
    if (now - this.lastPrune >= PRUNE_INTERVAL_MS) this.prune();

    let entry = this.entries.get(key);
    if (!entry || now - entry.windowStart >= this.opts.windowMs) {
      entry = { count: 0, windowStart: now, lockedUntil: null };
      this.entries.set(key, entry);
    }
    entry.count++;
    if (entry.count < this.opts.maxFailures) return 0;
    entry.lockedUntil = now + this.opts.lockMs;
    return Math.ceil(this.opts.lockMs / 1000);
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  /** Drops expired locks and counting windows, so memory stays bounded. */
  prune(): void {
    const now = this.now();
    this.lastPrune = now;
    for (const [key, entry] of this.entries) {
      const expired = entry.lockedUntil !== null
        ? entry.lockedUntil <= now
        : now - entry.windowStart >= this.opts.windowMs;
      if (expired) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
