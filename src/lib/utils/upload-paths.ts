import { join, resolve, sep } from "node:path";

/**
 * Paths of uploaded files. File metadata stored in the database (`storageKey`,
 * `name`) must never reach the filesystem unchecked: a value such as
 * `../../data/backups/x.enc` would point outside the uploads directory.
 */

/** Deduplicated attachments: `<sha256 hex>.<extension>`. */
const STORAGE_KEY_RE = /^[a-f0-9]{64}\.[a-z0-9]{1,10}$/;

export function isValidStorageKey(key: unknown): key is string {
  return typeof key === "string" && STORAGE_KEY_RE.test(key);
}

/**
 * Absolute path of `parts` inside `uploads/<area>`, or null when the result
 * would leave that directory (`..`, absolute paths, separators in a name).
 */
export function safeUploadPath(area: string, ...parts: string[]): string | null {
  const base = resolve(process.cwd(), "uploads", area);
  if (parts.some((p) => !p || p.includes("\0"))) return null;
  const target = resolve(join(base, ...parts));
  return target.startsWith(base + sep) ? target : null;
}
