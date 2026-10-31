import { describe, expect, it } from "bun:test";
import { generateSecret, generateSync } from "otplib";
import { applyHit, secondsUntil, type CounterState } from "./security-counter";
import { matchTotpStep, TWO_FACTOR_MAX_FAILURES, TWO_FACTOR_POLICY } from "./two-factor-guard";

const MINUTE = 60 * 1000;

describe("2FA failure policy", () => {
  it("locks the user for 15 minutes after 5 failures", () => {
    let time = 0;
    let state: CounterState | null = null;
    for (let i = 1; i < TWO_FACTOR_MAX_FAILURES; i++) {
      state = applyHit(state, time, TWO_FACTOR_POLICY);
      expect(secondsUntil(state.lockedUntil, time)).toBe(0);
    }
    state = applyHit(state, time, TWO_FACTOR_POLICY);
    expect(secondsUntil(state.lockedUntil, time)).toBe(15 * 60);
    time += 14 * MINUTE;
    expect(secondsUntil(state.lockedUntil, time)).toBe(60);
    time += MINUTE;
    expect(secondsUntil(state.lockedUntil, time)).toBe(0);
  });
});

describe("matchTotpStep", () => {
  const secret = generateSecret();

  it("returns the current time step of a valid code", async () => {
    // Not across a step boundary between generation and check
    if (Date.now() % 30_000 > 29_000) await Bun.sleep(1_100);
    const step = matchTotpStep(` ${generateSync({ secret })} `, secret);
    expect(step).toBe(Math.floor(Date.now() / 30_000));
  });

  it("returns null for a wrong or malformed code", () => {
    const valid = generateSync({ secret });
    const wrong = String((Number(valid) + 1) % 1_000_000).padStart(6, "0");
    expect(matchTotpStep(wrong, secret)).toBeNull();
    expect(matchTotpStep("abc", secret)).toBeNull();
    expect(matchTotpStep("", secret)).toBeNull();
  });
});
