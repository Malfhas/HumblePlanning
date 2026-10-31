import { describe, expect, it } from "bun:test";
import { FailureLimiter } from "./failure-limiter";

const MINUTE = 60 * 1000;

function limiter(maxFailures = 3, windowMs = 15 * MINUTE, lockMs = 15 * MINUTE) {
  let time = 1_000_000;
  const l = new FailureLimiter({ maxFailures, windowMs, lockMs, now: () => time });
  return { l, advance: (ms: number) => { time += ms; } };
}

describe("FailureLimiter", () => {
  it("locks a key once it reaches the maximum number of failures", () => {
    const { l } = limiter(3);
    expect(l.recordFailure("a")).toBe(0);
    expect(l.recordFailure("a")).toBe(0);
    expect(l.lockedFor("a")).toBe(0);
    expect(l.recordFailure("a")).toBe(15 * 60);
    expect(l.lockedFor("a")).toBe(15 * 60);
    // Other keys are independent
    expect(l.lockedFor("b")).toBe(0);
  });

  it("keeps the key locked until the lock expires, then starts over", () => {
    const { l, advance } = limiter(2, 15 * MINUTE, 10 * MINUTE);
    l.recordFailure("a");
    l.recordFailure("a");
    advance(9 * MINUTE);
    expect(l.lockedFor("a")).toBe(60);
    // A failure during the lock does not extend it
    expect(l.recordFailure("a")).toBe(60);
    advance(MINUTE);
    expect(l.lockedFor("a")).toBe(0);
    expect(l.recordFailure("a")).toBe(0);
  });

  it("only counts failures within the window", () => {
    const { l, advance } = limiter(3, 15 * MINUTE);
    l.recordFailure("a");
    l.recordFailure("a");
    advance(15 * MINUTE);
    expect(l.recordFailure("a")).toBe(0);
    expect(l.recordFailure("a")).toBe(0);
    expect(l.recordFailure("a")).toBeGreaterThan(0);
  });

  it("clear() resets the key", () => {
    const { l } = limiter(2);
    l.recordFailure("a");
    l.clear("a");
    expect(l.recordFailure("a")).toBe(0);
  });

  it("prunes expired windows and locks", () => {
    const { l, advance } = limiter(2, 5 * MINUTE, 5 * MINUTE);
    l.recordFailure("idle");
    l.recordFailure("locked");
    l.recordFailure("locked");
    expect(l.size).toBe(2);
    advance(5 * MINUTE);
    // The next failure triggers the periodic cleanup
    l.recordFailure("fresh");
    expect(l.size).toBe(1);
  });
});
