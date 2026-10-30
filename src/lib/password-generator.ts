import type { PasswordPolicy } from "./password-policy";
import { policyFromConfig } from "./password-policy";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SPECIAL = "!@#$%^&*()-_=+[]{}|;:,.<>?";

/** Uniform random integer in [0, max) using rejection sampling (CSPRNG) */
function cryptoRandom(max: number): number {
  const array = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    crypto.getRandomValues(array);
    if (array[0] < limit) return array[0] % max;
  }
}

/** Fisher-Yates shuffle using CSPRNG */
function shuffle(arr: string[]): string[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = cryptoRandom(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generatePassword(
  policy: PasswordPolicy,
  length?: number,
  includeSpecial?: boolean
): string {
  const targetLen = Math.max(policy.minLength, length ?? 16);

  // Build character pool
  let pool = "";
  const required: string[] = [];

  if (policy.requireUppercase) {
    pool += UPPER;
    required.push(UPPER[cryptoRandom(UPPER.length)]);
  }
  if (policy.requireLowercase) {
    pool += LOWER;
    required.push(LOWER[cryptoRandom(LOWER.length)]);
  }
  if (policy.requireDigit) {
    pool += DIGITS;
    required.push(DIGITS[cryptoRandom(DIGITS.length)]);
  }
  if (policy.requireSpecial || includeSpecial) {
    pool += SPECIAL;
    required.push(SPECIAL[cryptoRandom(SPECIAL.length)]);
  }

  // Fallback: at least upper + lower + digits
  if (!pool) {
    pool = UPPER + LOWER + DIGITS;
    required.push(UPPER[cryptoRandom(UPPER.length)]);
    required.push(LOWER[cryptoRandom(LOWER.length)]);
    required.push(DIGITS[cryptoRandom(DIGITS.length)]);
  }

  // Fill remaining with random chars from pool
  const chars = [...required];
  while (chars.length < targetLen) {
    chars.push(pool[cryptoRandom(pool.length)]);
  }

  return shuffle(chars).join("");
}

export function generatePasswordFromConfig(
  config: Record<string, string | null>
): string {
  const policy = policyFromConfig(config);
  const length = parseInt(config.PWD_GEN_LENGTH ?? "") || 16;
  const includeSpecial = (config.PWD_GEN_INCLUDE_SPECIAL ?? "true") === "true";
  return generatePassword(policy, length, includeSpecial);
}
