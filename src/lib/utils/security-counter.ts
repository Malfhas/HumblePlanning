// Security counters (lockouts, cooldowns, rate limits): pure state
// transition. Stored in PostgreSQL by security-counter-service.ts, whose
// atomic upsert computes the same transition in SQL.
import { createHash } from "node:crypto";

export interface CounterPolicy {
  /** Hits allowed per window; reaching it locks the key when `lockMs` > 0. */
  max: number;
  windowMs: number;
  /** Lock duration once `max` hits are reached; 0 = no lock (rate limit, cooldown). */
  lockMs: number;
  /** The window restarts on every hit: the count starts over after `windowMs` without a hit. */
  slidingWindow?: boolean;
}

/** Instants in milliseconds since the epoch. */
export interface CounterState {
  count: number;
  windowStart: number;
  lockedUntil: number | null;
}

/**
 * State after one more hit (failure, request…) at `now`. A hit during the
 * lock changes nothing; the count starts over once the window or the lock is
 * over; the key is locked for `lockMs` once it reaches `max` hits.
 */
export function applyHit(prev: CounterState | null, now: number, policy: CounterPolicy): CounterState {
  if (prev?.lockedUntil != null && prev.lockedUntil > now) return prev;
  const restart = !prev || prev.lockedUntil !== null || now - prev.windowStart >= policy.windowMs;
  const count = restart ? 1 : prev.count + 1;
  return {
    count,
    windowStart: restart || policy.slidingWindow ? now : prev.windowStart,
    lockedUntil: policy.lockMs > 0 && count >= policy.max ? now + policy.lockMs : null,
  };
}

/** Whole seconds until `until` (rounded up), 0 once it is past. */
export function secondsUntil(until: number | null, now: number): number {
  return until !== null && until > now ? Math.ceil((until - now) / 1000) : 0;
}

/** Past this delay without a hit, a key's window and lock are over: its row can be dropped. */
export function counterRetentionMs(policy: CounterPolicy): number {
  return Math.max(policy.windowMs, policy.lockMs);
}

const MAX_KEY_LENGTH = 255;

/** Keys fit the column: long ones (they embed identifiers typed by clients) are hashed. */
export function boundedKey(key: string): string {
  return key.length <= MAX_KEY_LENGTH ? key : `sha256:${createHash("sha256").update(key).digest("hex")}`;
}
