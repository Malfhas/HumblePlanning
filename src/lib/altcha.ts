/**
 * ALTCHA: shared server instance for the self-hosted captcha.
 *
 * Provides:
 *  - `altcha.challengeHandler`: GET route handler that generates a challenge
 *  - `altcha.verifyHandler`   : POST route handler that verifies a solution
 *  - `verifyAltchaPayload`    : helper function (used by `verifyCaptcha`)
 *
 * Algorithm: PBKDF2/SHA-256 (recommended by ALTCHA v2/v3; uses the native
 * WebCrypto/Node primitives, faster than the home-made iterated SHA-256
 * loop). No native dependency and no WASM on the server side.
 *
 * PoW parameters = canonical values from the altcha-lib v2 docs:
 *     algorithm: 'PBKDF2/SHA-256'
 *     cost:      5_000           (HMAC-SHA-256 iterations per attempt)
 *     counter:   randomInt(5_000, 10_000)
 *   ≈ 7,500 attempts × 5,000 iterations = ~37 M HMAC-SHA-256 → 1 to 2 s with
 *   multiple Workers in the browser (PoW visible but not frustrating).
 *
 * Separate HMAC secrets (`ALTCHA_HMAC_SECRET` + `ALTCHA_HMAC_KEY_SECRET`)
 * generated automatically by the installer (`install.sh`). Unique per instance
 * → no cross-validation possible between deployments.
 *
 * Docs: https://altcha.org/docs/v2/
 */

import { create, randomInt, CappedMap } from "altcha-lib/frameworks/nextjs";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";

// Secrets are read when the module loads. If missing, we log a warning
// but still instantiate (the routes simply won't work until the secrets
// are in .env).
const HMAC_SECRET = process.env.ALTCHA_HMAC_SECRET ?? "";
const HMAC_KEY_SECRET = process.env.ALTCHA_HMAC_KEY_SECRET ?? "";

if (!HMAC_SECRET || !HMAC_KEY_SECRET) {
  console.warn(
    "[ALTCHA] ALTCHA_HMAC_SECRET or ALTCHA_HMAC_KEY_SECRET missing from .env. " + // i18n-ignore server log (internal)
    "The /api/altcha/challenge and /api/altcha/verify routes will not work. " + // i18n-ignore server log (internal)
    "Rerun `install.sh` (or generate them with `openssl rand -hex 32`) to add the missing secrets." // i18n-ignore server log (internal)
  );
}

/** ALTCHA instance shared by all verification routes / functions. */
export const altcha = create({
  hmacSignatureSecret: HMAC_SECRET,
  hmacKeySignatureSecret: HMAC_KEY_SECRET,
  createChallengeParameters: () => ({
    algorithm: "PBKDF2/SHA-256",
    cost: 5_000,
    counter: randomInt(5_000, 10_000),
    expiresAt: new Date(Date.now() + 600_000), // 10 minutes
  }),
  deriveKey,
  // In-memory anti-replay store: prevents reusing the same solution
  // twice. Capped at 5000 entries (enough for ~5000 simultaneous logins
  // over 10 min). For a multi-instance cluster, replace with a shared
  // Redis store.
  store: new CappedMap<string, boolean>({ maxSize: 5_000 }),
});

/** True if the ALTCHA secrets are properly configured. Lets
 *  `verifyCaptcha()` return false for this provider if the admin
 *  selected ALTCHA but forgot to generate the secrets. */
export function isAltchaConfigured(): boolean {
  return !!HMAC_SECRET && !!HMAC_KEY_SECRET;
}

/** Verifies an ALTCHA payload received from a form (base64-JSON string).
 *  Returns `true` if the solution is valid, `false` otherwise. The standalone
 *  `altcha.verify` function has no partial application of the
 *  secrets, so we pass them explicitly here. */
export async function verifyAltchaPayload(payload: string): Promise<boolean> {
  if (!isAltchaConfigured()) return false;
  const result = await altcha.verify(
    payload,
    deriveKey,
    HMAC_SECRET,
    HMAC_KEY_SECRET,
  );
  return !result.error && result.verification?.verified === true;
}
