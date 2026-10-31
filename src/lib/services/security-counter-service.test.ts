// Integration test of the SQL upsert against a real PostgreSQL (the one of
// DATABASE_URL, migrations applied). Opt-in: SECURITY_COUNTERS_DB_TEST=1
// bun test src/lib/services/security-counter-service.test.ts
// Only touches keys under a random `test:` prefix, deleted at the end.
import { afterAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { applyHit, boundedKey, secondsUntil, type CounterPolicy, type CounterState } from "@/lib/utils/security-counter";

const ENABLED = process.env.SECURITY_COUNTERS_DB_TEST === "1";
const PREFIX = `test:${randomUUID()}:`;
const MINUTE = 60 * 1000;
const LONG_KEY = `${PREFIX}${"x".repeat(300)}`;

async function load() {
  const [service, { db }, { securityCounters }, { like, eq }] = await Promise.all([
    import("./security-counter-service"),
    import("@/db"),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);
  return { ...service, db, securityCounters, like, eq };
}

describe.skipIf(!ENABLED)("security counters in PostgreSQL", () => {
  afterAll(async () => {
    const { db, securityCounters, like, eq } = await load();
    await db.delete(securityCounters).where(like(securityCounters.key, `${PREFIX}%`));
    await db.delete(securityCounters).where(eq(securityCounters.key, boundedKey(LONG_KEY)));
    await db.$client.end();
  });

  const scenarios: { name: string; policy: CounterPolicy; steps: number[] }[] = [
    // Advance (ms) before each hit
    { name: "lockout", policy: { max: 3, windowMs: 15 * MINUTE, lockMs: 10 * MINUTE }, steps: [0, MINUTE, MINUTE, MINUTE, 9 * MINUTE, 0, 15 * MINUTE, 0, 0] },
    { name: "sliding window", policy: { max: 3, windowMs: 24 * 60 * MINUTE, lockMs: 5 * MINUTE, slidingWindow: true }, steps: [0, 23 * 60 * MINUTE, 23 * 60 * MINUTE, 0, 5 * MINUTE, 24 * 60 * MINUTE] },
    { name: "rate limit", policy: { max: 2, windowMs: MINUTE, lockMs: 0 }, steps: [0, 1000, 1000, 1000, MINUTE, 0] },
  ];

  for (const { name, policy, steps } of scenarios) {
    it(`computes the same transition as applyHit (${name})`, async () => {
      const { recordHit } = await load();
      const key = `${PREFIX}${name}`;
      let time = Date.now();
      let expected: CounterState | null = null;
      for (const advance of steps) {
        time += advance;
        expected = applyHit(expected, time, policy);
        expect(await recordHit(key, policy, { now: time })).toEqual(expected);
      }
    });
  }

  it("counts concurrent failures exactly and locks once", async () => {
    const { recordFailure, lockedFor } = await load();
    const key = `${PREFIX}concurrent`;
    const policy = { max: 5, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE };
    const locks = await Promise.all(Array.from({ length: 20 }, () => recordFailure(key, policy)));
    expect(locks.filter((s) => s === 0)).toHaveLength(4);
    expect(await lockedFor(key)).toBeGreaterThan(14 * 60);
  });

  it("lets exactly `max` concurrent requests through a rate limit", async () => {
    const { checkPersistentRateLimit } = await load();
    const results = await Promise.all(Array.from({ length: 20 }, () => checkPersistentRateLimit(`${PREFIX}rate`, 5, MINUTE)));
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("grants a cooldown to one concurrent caller, until released", async () => {
    const { claimCooldown, clearCounters } = await load();
    const key = `${PREFIX}cooldown`;
    const results = await Promise.all(Array.from({ length: 10 }, () => claimCooldown(key, MINUTE)));
    expect(results.filter((s) => s === 0)).toHaveLength(1);
    expect(Math.min(...results.filter((s) => s > 0))).toBeGreaterThan(55);
    await clearCounters([key]);
    expect(await claimCooldown(key, MINUTE)).toBe(0);
  });

  it("reads and clears locks, long keys included", async () => {
    const { recordFailure, lockedFor, clearCounters } = await load();
    const policy = { max: 1, windowMs: MINUTE, lockMs: MINUTE };
    const now = Date.now();
    expect(await recordFailure(LONG_KEY, policy, { now })).toBe(60);
    expect(await lockedFor(LONG_KEY, { now: now + 30_000 })).toBe(30);
    expect(await lockedFor(LONG_KEY, { now: now + MINUTE })).toBe(0);
    await clearCounters([LONG_KEY]);
    expect(await lockedFor(LONG_KEY, { now })).toBe(secondsUntil(null, now));
  });
});
