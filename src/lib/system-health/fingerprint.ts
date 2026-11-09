const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL_RE = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi;
const HEX_RE = /\b(?:0x[0-9a-f]+|[0-9a-f]{16,})\b/gi;
const NUMBER_RE = /\d+(?:[.,]\d+)?/g;
/** Normalized length taken into account: two messages differing further on are the same incident. */
const MAX_NORMALIZED_LENGTH = 500;

/**
 * Message with its variable parts replaced (identifiers, e-mails, hashes,
 * numbers), so that the same incident repeated with other values is grouped
 * on one row: « Task 3f2a… not found » and « Task 91bc… not found » match.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(UUID_RE, "<id>")
    .replace(EMAIL_RE, "<email>")
    .replace(HEX_RE, "<hex>")
    .replace(NUMBER_RE, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NORMALIZED_LENGTH);
}

/**
 * 64-bit FNV-1a of a string (UTF-16 code units), as 16 hex digits. Not a cryptographic hash, on purpose: the
 * fingerprint only groups the repeats of an incident, it protects nothing, and a cryptographic hash of logged
 * text reads to code scanners as a weakly hashed secret.
 */
// BigInt() rather than literals: the TypeScript target (ES2017) has no BigInt literals
const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const MASK_64 = BigInt("0xffffffffffffffff");

function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Grouping key of a system event: level + category + normalized message (64-bit FNV-1a, 16 hex digits). */
export function eventFingerprint(level: string, category: string, message: string): string {
  return fnv1a64(`${level}\u0000${category}\u0000${normalizeMessage(message)}`);
}

/**
 * Values of a failed query removed from an error text: Drizzle appends
 * « params: … » (the bound values, which can be e-mails, hashes, notes) to the
 * message and the stack. The query itself is kept, it says what failed.
 */
export function redactQueryParams(text: string): string {
  return text.replace(/^params: .*$/gm, "params: [redacted]");
}
