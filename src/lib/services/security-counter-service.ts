// Security counters stored in PostgreSQL (table security_counters): login
// and 2FA lockouts, password reset cooldowns, rate limits of the public
// OAuth endpoints. Shared by every process and kept across restarts; a hit is
// one atomic upsert, so concurrent requests cannot lose an increment.
// Pure transition (and its tests): src/lib/utils/security-counter.ts.
import { and, eq, gt, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { securityCounters } from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  applyHit, boundedKey, counterRetentionMs, reservationPolicy, secondsUntil,
  type CounterPolicy, type CounterState,
} from "@/lib/utils/security-counter";

/** `db` or a transaction, to update a counter together with other rows. */
export type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

interface CounterOptions {
  tx?: DbExecutor;
  /** Clock, injectable for tests. */
  now?: number;
}

const t = securityCounters;

/** Timestamp parameter: Drizzle's postgres-js driver does not serialize a `Date` inside `sql`. */
function at(ms: number): SQL {
  const iso = new Date(ms).toISOString();
  return sql`${iso}::timestamptz`;
}

/**
 * Records a hit on `key` and returns the new state: `applyHit` computed by a
 * single INSERT … ON CONFLICT DO UPDATE … RETURNING (the SET expressions read
 * the row as it was before the hit).
 */
export async function recordHit(
  key: string,
  policy: CounterPolicy,
  { tx = db, now = Date.now() }: CounterOptions = {},
): Promise<CounterState> {
  pruneExpiredCounters();
  const first = applyHit(null, now, policy);
  const locked = sql`${t.lockedUntil} > ${at(now)}`;
  // The window or a past lock is over: the count starts over
  const restart = sql`(${t.lockedUntil} IS NOT NULL OR ${t.windowStart} <= ${at(now - policy.windowMs)})`;
  const count = sql`CASE WHEN ${restart} THEN 1 ELSE ${t.count} + 1 END`;
  const lock = policy.lockMs > 0 ? sql`WHEN ${count} >= ${policy.max} THEN ${at(now + policy.lockMs)}` : sql``;

  const [row] = await tx.insert(t)
    .values({
      key: boundedKey(key),
      count: first.count,
      windowStart: new Date(first.windowStart),
      lockedUntil: first.lockedUntil === null ? null : new Date(first.lockedUntil),
      expiresAt: new Date(now + counterRetentionMs(policy)),
    })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        // A hit during the lock changes nothing
        count: sql`CASE WHEN ${locked} THEN ${t.count} ELSE ${count} END`,
        windowStart: policy.slidingWindow
          ? sql`CASE WHEN ${locked} THEN ${t.windowStart} ELSE ${at(now)} END`
          : sql`CASE WHEN ${locked} OR NOT ${restart} THEN ${t.windowStart} ELSE ${at(now)} END`,
        lockedUntil: sql`CASE WHEN ${locked} THEN ${t.lockedUntil} ${lock} END`,
        expiresAt: new Date(now + counterRetentionMs(policy)),
      },
    })
    .returning({ count: t.count, windowStart: t.windowStart, lockedUntil: t.lockedUntil });

  return { count: row.count, windowStart: row.windowStart.getTime(), lockedUntil: row.lockedUntil?.getTime() ?? null };
}

/** Records a failure: lock time left in seconds when the key is (or already was) locked, otherwise 0. */
export async function recordFailure(key: string, policy: CounterPolicy, opts: CounterOptions = {}): Promise<number> {
  const now = opts.now ?? Date.now();
  const state = await recordHit(key, policy, { ...opts, now });
  return secondsUntil(state.lockedUntil, now);
}

/** Lock time left on `key` in seconds, 0 when it is not locked. */
export async function lockedFor(key: string, { tx = db, now = Date.now() }: CounterOptions = {}): Promise<number> {
  const [row] = await tx.select({ lockedUntil: t.lockedUntil }).from(t)
    .where(and(eq(t.key, boundedKey(key)), gt(t.lockedUntil, new Date(now))));
  return secondsUntil(row?.lockedUntil?.getTime() ?? null, now);
}

/** An attempt reserved on a lock before the check it guards (`reserveAttempt`). */
export interface AttemptReservation {
  key: string;
  policy: CounterPolicy;
  /** Rank of the attempt in the current window (meaningless when refused). */
  attempt: number;
  /** Lock time left in seconds when the attempt is refused, otherwise 0. */
  lockedSeconds: number;
}

/**
 * Reserves an attempt on `key` before a slow check (password verification):
 * one atomic upsert, so parallel requests cannot all pass a lock check made
 * before any of them records its failure. Refused (`lockedSeconds` > 0) while
 * the key is locked. Then `failAttempt` (the hit stays), `clearCounters` or
 * `releaseAttempt`. Transitions and tests: `reservationPolicy`, `applyFailure`,
 * `applyRelease` (src/lib/utils/security-counter.ts).
 */
export async function reserveAttempt(
  key: string,
  policy: CounterPolicy,
  { tx = db, now = Date.now() }: CounterOptions = {},
): Promise<AttemptReservation> {
  const state = await recordHit(key, reservationPolicy(policy), { tx, now });
  return { key, policy, attempt: state.count, lockedSeconds: secondsUntil(state.lockedUntil, now) };
}

/** The reserved attempt failed: from the max-th one, the key is locked. Lock time left in seconds, 0 below the max. */
export async function failAttempt(
  { key, policy, attempt }: AttemptReservation,
  { tx = db, now = Date.now() }: CounterOptions = {},
): Promise<number> {
  if (attempt < policy.max || policy.lockMs <= 0) return 0;
  const lockedUntil = now + policy.lockMs;
  const expiresAt = now + counterRetentionMs(policy);
  const [row] = await tx.insert(t)
    // Cleared meanwhile (a success): the lock starts a new row
    .values({ key: boundedKey(key), count: attempt, windowStart: new Date(now), lockedUntil: new Date(lockedUntil), expiresAt: new Date(expiresAt) })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        // A running lock is kept
        lockedUntil: sql`CASE WHEN ${t.lockedUntil} > ${at(now)} THEN ${t.lockedUntil} ELSE ${at(lockedUntil)} END`,
        expiresAt: sql`GREATEST(${t.expiresAt}, ${at(expiresAt)})`,
      },
    })
    .returning({ lockedUntil: t.lockedUntil });
  return secondsUntil(row.lockedUntil?.getTime() ?? null, now);
}

/** Gives a reservation back: its attempt does not count. One hit less, the row dropped at zero; a locked key is left as it is. */
export async function releaseAttempt(
  { key, lockedSeconds }: AttemptReservation,
  { tx = db, now = Date.now() }: CounterOptions = {},
): Promise<void> {
  if (lockedSeconds > 0) return;
  const unlocked = and(eq(t.key, boundedKey(key)), or(isNull(t.lockedUntil), lte(t.lockedUntil, new Date(now))));
  const [row] = await tx.update(t)
    .set({ count: sql`${t.count} - 1` })
    .where(and(unlocked, gt(t.count, 0)))
    .returning({ count: t.count });
  if (row?.count === 0) await tx.delete(t).where(and(unlocked, eq(t.count, 0)));
}

/** Forgets the keys (successful login, cooldown released after a failed action). */
export async function clearCounters(keys: string[], { tx = db }: Pick<CounterOptions, "tx"> = {}): Promise<void> {
  await tx.delete(t).where(inArray(t.key, keys.map(boundedKey)));
}

/** Fixed-window rate limit: `false` once `key` exceeded `max` requests over the window. */
export async function checkPersistentRateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const state = await recordHit(key, { max, windowMs, lockMs: 0 });
  return state.count <= max;
}

/**
 * Starts a cooldown of `cooldownMs` on `key` unless one is running: 0 when
 * claimed, otherwise the seconds left. `clearCounters` releases it.
 */
export async function claimCooldown(key: string, cooldownMs: number): Promise<number> {
  const now = Date.now();
  const state = await recordHit(key, { max: 1, windowMs: cooldownMs, lockMs: 0 }, { now });
  return state.count === 1 ? 0 : secondsUntil(state.windowStart + cooldownMs, now);
}

/** Expired rows are dropped at most once per minute and process, on the next hit (no timer). */
const PRUNE_INTERVAL_MS = 60 * 1000;
let lastPrune = 0;

function pruneExpiredCounters(): void {
  // Real clock: an injected test clock must not drop live rows
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  db.delete(t).where(lte(t.expiresAt, new Date(now))).catch((error: unknown) => {
    logger.warn("auth", "Security counters cleanup failed", { error: error instanceof Error ? error.message : String(error) });
  });
}
