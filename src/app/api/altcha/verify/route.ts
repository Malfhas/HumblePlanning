/**
 * POST /api/altcha/verify — verifies an ALTCHA solution sent back by the client.
 *
 * Optional: most integrations verify the solution directly in the
 * application route that consumes the form (login, forgot-password,
 * etc.) via `altcha.verify(payload)` — that is what `verifyCaptcha()`
 * does in `src/lib/captcha.ts`. This endpoint is exposed for setups that
 * prefer a dedicated verification round-trip (e.g. middleware, third-party
 * forms).
 */
import { altcha } from "@/lib/altcha";

export const POST = altcha.verifyHandler;
