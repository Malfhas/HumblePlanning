// Brute-force and replay protection of the second login step
// (/api/auth/2fa/verify): pure pieces. The failures are counted in
// PostgreSQL (security_counters), the last accepted TOTP step is stored on
// the user (users.two_factor_last_step).
import { verifySync } from "otplib";
import type { CounterPolicy } from "./security-counter";

export const TWO_FACTOR_MAX_FAILURES = 5;
export const TWO_FACTOR_LOCK_MS = 15 * 60 * 1000;

/**
 * Failed codes counted per user, across pending tokens: each successful
 * password login creates a new token, so a per-token counter would leave
 * TOTP guesses unlimited.
 */
export const TWO_FACTOR_POLICY: CounterPolicy = {
  max: TWO_FACTOR_MAX_FAILURES,
  windowMs: TWO_FACTOR_LOCK_MS,
  lockMs: TWO_FACTOR_LOCK_MS,
};

export function twoFactorFailureKey(userId: string): string {
  return `2fa:${userId}`;
}

/**
 * Time step matched by a TOTP code, or null when the code is invalid
 * (malformed codes included). A code is valid for its whole 30-second step:
 * the caller accepts a step only if it is newer than the last one accepted.
 */
export function matchTotpStep(code: string, secret: string): number | null {
  try {
    const result = verifySync({ token: code.trim(), secret });
    return result.valid && "timeStep" in result ? result.timeStep : null;
  } catch {
    return null;
  }
}
