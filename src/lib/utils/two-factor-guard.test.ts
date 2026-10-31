import { describe, expect, it } from "bun:test";
import { createTwoFactorLimiter, TotpReplayGuard, TWO_FACTOR_MAX_FAILURES } from "./two-factor-guard";

const MINUTE = 60 * 1000;

describe("2FA failure limiter", () => {
  it("locks the user for 15 minutes after 5 failures", () => {
    let time = 0;
    const limiter = createTwoFactorLimiter(() => time);
    for (let i = 1; i < TWO_FACTOR_MAX_FAILURES; i++) expect(limiter.recordFailure("user")).toBe(0);
    expect(limiter.recordFailure("user")).toBe(15 * 60);
    time += 14 * MINUTE;
    expect(limiter.lockedFor("user")).toBe(60);
    time += MINUTE;
    expect(limiter.lockedFor("user")).toBe(0);
  });
});

describe("TotpReplayGuard", () => {
  it("refuses a time step already used by the same user", () => {
    const guard = new TotpReplayGuard();
    expect(guard.isReplay("u1", 100)).toBe(false);
    guard.markUsed("u1", 100);
    expect(guard.isReplay("u1", 100)).toBe(true);
    expect(guard.isReplay("u1", 99)).toBe(true);
    expect(guard.isReplay("u1", 101)).toBe(false);
    // Other users are independent
    expect(guard.isReplay("u2", 100)).toBe(false);
  });

  it("never moves the recorded step backwards", () => {
    const guard = new TotpReplayGuard();
    guard.markUsed("u1", 100);
    guard.markUsed("u1", 98);
    expect(guard.isReplay("u1", 100)).toBe(true);
  });

  it("forgets steps after the retention delay", () => {
    let time = 0;
    const guard = new TotpReplayGuard(5 * MINUTE, () => time);
    guard.markUsed("u1", 100);
    time += 5 * MINUTE;
    expect(guard.isReplay("u1", 100)).toBe(false);
  });
});
