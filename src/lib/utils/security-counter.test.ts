import { describe, expect, it } from "bun:test";
import {
  applyFailure, applyHit, applyRelease, boundedKey, reservationPolicy, secondsUntil,
  type CounterPolicy, type CounterState,
} from "./security-counter";

const MINUTE = 60 * 1000;

/** One key replayed through `applyHit` with a fake clock, like the stored row. */
function counter(policy: CounterPolicy) {
  let time = 1_000_000;
  let state: CounterState | null = null;
  return {
    /** Records a hit: lock time left in seconds (0 = not locked). */
    hit: () => {
      state = applyHit(state, time, policy);
      return secondsUntil(state.lockedUntil, time);
    },
    count: () => state?.count ?? 0,
    lockedFor: () => secondsUntil(state?.lockedUntil ?? null, time),
    clear: () => { state = null; },
    advance: (ms: number) => { time += ms; },
  };
}

const failures = (max: number, windowMs = 15 * MINUTE, lockMs = 15 * MINUTE) => counter({ max, windowMs, lockMs });

describe("security counter: failure lockout", () => {
  it("locks a key once it reaches the maximum number of failures", () => {
    const c = failures(3);
    expect(c.hit()).toBe(0);
    expect(c.hit()).toBe(0);
    expect(c.lockedFor()).toBe(0);
    expect(c.hit()).toBe(15 * 60);
    expect(c.lockedFor()).toBe(15 * 60);
  });

  it("keeps the key locked until the lock expires, then starts over", () => {
    const c = failures(2, 15 * MINUTE, 10 * MINUTE);
    c.hit();
    c.hit();
    c.advance(9 * MINUTE);
    expect(c.lockedFor()).toBe(60);
    // A failure during the lock neither extends it nor counts
    expect(c.hit()).toBe(60);
    expect(c.count()).toBe(2);
    c.advance(MINUTE);
    expect(c.lockedFor()).toBe(0);
    expect(c.hit()).toBe(0);
    expect(c.count()).toBe(1);
  });

  it("only counts failures within the window", () => {
    const c = failures(3, 15 * MINUTE);
    c.hit();
    c.hit();
    c.advance(15 * MINUTE);
    expect(c.hit()).toBe(0);
    expect(c.hit()).toBe(0);
    expect(c.hit()).toBeGreaterThan(0);
  });

  it("with a sliding window, keeps counting while failures are less than a window apart", () => {
    const c = counter({ max: 3, windowMs: 24 * 60 * MINUTE, lockMs: 5 * MINUTE, slidingWindow: true });
    c.hit();
    c.advance(23 * 60 * MINUTE);
    c.hit();
    c.advance(23 * 60 * MINUTE);
    expect(c.hit()).toBe(5 * 60);
    c.clear();
    c.hit();
    c.advance(24 * 60 * MINUTE);
    c.hit();
    expect(c.count()).toBe(1);
  });

  it("clearing the key resets it", () => {
    const c = failures(2);
    c.hit();
    c.clear();
    expect(c.hit()).toBe(0);
  });
});

/**
 * One key guarding a slow check (a password verification), replayed through the
 * pure transitions like the stored row: `reserve` runs before the check, then
 * `fail`, `clear` (success) or `release` (the attempt did not count).
 */
function guarded(policy: CounterPolicy) {
  let time = 1_000_000;
  let state: CounterState | null = null;
  return {
    /** Reserves an attempt: its rank, or null when the key refuses it. */
    reserve: () => {
      state = applyHit(state, time, reservationPolicy(policy));
      return secondsUntil(state.lockedUntil, time) > 0 ? null : state.count;
    },
    /** The reserved attempt failed: lock time left in seconds (0 = not locked). */
    fail: (attempt: number) => {
      state = applyFailure(state, attempt, time, policy);
      return attempt < policy.max ? 0 : secondsUntil(state?.lockedUntil ?? null, time);
    },
    release: () => { state = applyRelease(state, time); },
    clear: () => { state = null; },
    count: () => state?.count ?? 0,
    lockedFor: () => secondsUntil(state?.lockedUntil ?? null, time),
    advance: (ms: number) => { time += ms; },
  };
}

/** The former flow: lock checked, then the check runs, then its failure is recorded. */
function checkedAfter(policy: CounterPolicy) {
  const c = counter(policy);
  return {
    /** Null when locked before the check, else the lock time left after a failure. */
    failedAttempt: () => (c.lockedFor() > 0 ? null : c.hit()),
    advance: c.advance,
  };
}

describe("security counter: attempts reserved before the check", () => {
  const policies: CounterPolicy[] = [
    { max: 5, windowMs: 24 * 60 * MINUTE, lockMs: 5 * MINUTE, slidingWindow: true },
    { max: 20, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE },
    { max: 1, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE },
  ];

  it("sequential failures give the same answers as when they were counted after the check", () => {
    for (const policy of policies) {
      const before = checkedAfter(policy);
      const now = guarded(policy);
      for (let i = 0; i < 3 * policy.max + 3; i++) {
        const attempt = now.reserve();
        const answer = attempt === null ? null : now.fail(attempt);
        expect(answer).toBe(before.failedAttempt());
        // Some attempts while locked, then past the lock
        const step = i % 4 === 3 ? policy.lockMs : MINUTE;
        before.advance(step);
        now.advance(step);
      }
    }
  });

  it("the max-th attempt still runs and its success clears the key", () => {
    const c = guarded({ max: 3, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE });
    expect(c.fail(c.reserve()!)).toBe(0);
    expect(c.fail(c.reserve()!)).toBe(0);
    expect(c.reserve()).toBe(3);
    c.clear();
    expect(c.reserve()).toBe(1);
  });

  it("parallel attempts: only `max` of them run, the next reservation locks the key", () => {
    const c = guarded({ max: 5, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE });
    // 50 requests reserve before any password check is over
    const attempts = Array.from({ length: 50 }, () => c.reserve());
    expect(attempts.filter((a) => a !== null)).toEqual([1, 2, 3, 4, 5]);
    expect(c.lockedFor()).toBe(15 * 60);
    // Their failures keep the running lock
    for (const attempt of attempts) if (attempt !== null) c.fail(attempt);
    expect(c.lockedFor()).toBe(15 * 60);
  });

  it("a released reservation does not count, and none is left at zero", () => {
    const c = guarded({ max: 2, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE });
    c.reserve();
    c.release();
    expect(c.count()).toBe(0);
    c.fail(c.reserve()!);
    c.reserve();
    c.release();
    expect(c.count()).toBe(1);
    expect(c.fail(c.reserve()!)).toBe(15 * 60);
  });

  it("a release leaves a locked key as it is", () => {
    const c = guarded({ max: 1, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE });
    c.fail(c.reserve()!);
    c.release();
    expect(c.lockedFor()).toBe(15 * 60);
    expect(c.count()).toBe(1);
  });

  it("a failure after the key was cleared meanwhile still locks at the max-th attempt", () => {
    const policy = { max: 2, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE };
    expect(applyFailure(null, 2, 0, policy)).toEqual({ count: 2, windowStart: 0, lockedUntil: 15 * MINUTE });
    expect(applyFailure(null, 1, 0, policy)).toBeNull();
  });
});

describe("security counter: rate limit and cooldown (no lock)", () => {
  it("counts every request of the window, then starts over", () => {
    const c = counter({ max: 2, windowMs: MINUTE, lockMs: 0 });
    expect([c.hit(), c.hit(), c.hit()]).toEqual([0, 0, 0]);
    expect(c.count()).toBe(3); // over the limit: refused by the caller
    c.advance(MINUTE);
    c.hit();
    expect(c.count()).toBe(1);
  });

  it("a refused request does not extend the cooldown", () => {
    let state = applyHit(null, 0, { max: 1, windowMs: 60_000, lockMs: 0 });
    state = applyHit(state, 30_000, { max: 1, windowMs: 60_000, lockMs: 0 });
    expect(state.count).toBe(2);
    expect(secondsUntil(state.windowStart + 60_000, 30_000)).toBe(30);
  });
});

describe("secondsUntil", () => {
  it("rounds up and is 0 once past", () => {
    expect(secondsUntil(1001, 0)).toBe(2);
    expect(secondsUntil(1000, 1000)).toBe(0);
    expect(secondsUntil(null, 0)).toBe(0);
  });
});

describe("boundedKey", () => {
  it("keeps short keys and hashes long ones to a stable, bounded value", () => {
    expect(boundedKey("login:id:alice")).toBe("login:id:alice");
    const long = `login:id:${"x".repeat(5000)}`;
    expect(boundedKey(long)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(boundedKey(long)).toBe(boundedKey(long));
    expect(boundedKey(`${long}y`)).not.toBe(boundedKey(long));
  });
});
