/**
 * GET /api/altcha/challenge — issues a fresh ALTCHA challenge.
 *
 * The client widget (`<altcha-widget challengeurl="/api/altcha/challenge">`)
 * calls this endpoint on mount, solves the challenge as proof-of-work
 * (~0.5-1 s on a modern CPU with `cost=50000`), then sends the solution
 * back in the form it protects.
 *
 * Public endpoint (no auth required): by design, it is a pre-step
 * of auth. No PII exposed — just an HMAC-signed challenge
 * with a 10 min expiration.
 */
import { altcha } from "@/lib/altcha";

export const GET = altcha.challengeHandler;
