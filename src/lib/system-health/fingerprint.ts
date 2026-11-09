import { createHash } from "node:crypto";

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

/** Grouping key of a system event: level + category + normalized message (SHA-256, hex). */
export function eventFingerprint(level: string, category: string, message: string): string {
  return createHash("sha256").update(`${level}\u0000${category}\u0000${normalizeMessage(message)}`).digest("hex");
}

/**
 * Values of a failed query removed from an error text: Drizzle appends
 * « params: … » (the bound values, which can be e-mails, hashes, notes) to the
 * message and the stack. The query itself is kept, it says what failed.
 */
export function redactQueryParams(text: string): string {
  return text.replace(/^params: .*$/gm, "params: [redacted]");
}
