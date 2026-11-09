/** A new sign-in QR code can be asked for 30 s after the last one (the server allows 10 per 10 minutes). */
export const REGENERATE_COOLDOWN_MS = 30 * 1000;

/** Whole seconds before a new code can be asked for; 0 when it can. */
export function cooldownSecondsLeft(generatedAt: number | null, now: number, cooldownMs = REGENERATE_COOLDOWN_MS): number {
  if (generatedAt === null) return 0;
  return Math.max(0, Math.ceil((generatedAt + cooldownMs - now) / 1000));
}
