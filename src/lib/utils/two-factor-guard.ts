// Brute-force and replay protection of the second login step
// (/api/auth/2fa/verify). In memory, per process, like the password lockout.
import { FailureLimiter } from "./failure-limiter";

export const TWO_FACTOR_MAX_FAILURES = 5;
export const TWO_FACTOR_LOCK_MS = 15 * 60 * 1000;

/**
 * Failed codes counted per user, across pending tokens: each successful
 * password login creates a new token, so a per-token counter would leave
 * TOTP guesses unlimited.
 */
export function createTwoFactorLimiter(now?: () => number): FailureLimiter {
  return new FailureLimiter({
    maxFailures: TWO_FACTOR_MAX_FAILURES,
    windowMs: TWO_FACTOR_LOCK_MS,
    lockMs: TWO_FACTOR_LOCK_MS,
    now,
  });
}

/**
 * Last TOTP time step accepted per user: a code is valid for its whole
 * 30-second step, so without this record it could be replayed.
 */
export class TotpReplayGuard {
  private readonly used = new Map<string, { step: number; at: number }>();
  private readonly now: () => number;

  /** `retentionMs` must exceed the validity of a step (30 s, no tolerance). */
  constructor(private readonly retentionMs = 5 * 60 * 1000, now?: () => number) {
    this.now = now ?? Date.now;
  }

  /** True when `step` is not newer than the last step accepted for the user. */
  isReplay(userId: string, step: number): boolean {
    const entry = this.used.get(userId);
    if (!entry) return false;
    if (this.now() - entry.at >= this.retentionMs) {
      this.used.delete(userId);
      return false;
    }
    return step <= entry.step;
  }

  markUsed(userId: string, step: number): void {
    const now = this.now();
    for (const [id, entry] of this.used) {
      if (now - entry.at >= this.retentionMs) this.used.delete(id);
    }
    const previous = this.used.get(userId);
    this.used.set(userId, { step: Math.max(step, previous?.step ?? step), at: now });
  }
}
