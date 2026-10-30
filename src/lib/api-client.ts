import { fallbackMessageForStatus } from "@/i18n/client-fallback";

/**
 * Client-side API call error. The server returns `{ error, code?, params?,
 * fields?, details? }`: `error` is already translated into the request
 * language, `code` is stable (message key), `fields` maps a form field
 * to its translated message.
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public params?: Record<string, string | number>,
    public fields?: Record<string, string>,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * Use in hooks instead of
 * `throw new Error(error.error || "Erreur réseau")`:
 *
 *   const res = await fetch(url, options);
 *   await throwIfNotOk(res);
 *   return res.json();
 */
export async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  throw new ApiClientError(
    (typeof body.error === "string" && body.error) || fallbackMessageForStatus(res.status),
    res.status,
    typeof body.code === "string" ? body.code : undefined,
    body.params as Record<string, string | number> | undefined,
    body.fields as Record<string, string> | undefined,
    body.details,
  );
}

/** `fetch` + `throwIfNotOk` + JSON (JSON header by default). */
export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  await throwIfNotOk(res);
  return res.json() as Promise<T>;
}

const SESSION_CODES = new Set(["errors.unauthenticated", "errors.sessionExpired"]);

/**
 * True for a missing or expired session: code `errors.unauthenticated`
 * (or `errors.sessionExpired`), carried by `ApiClientError` (hooks: `throwIfNotOk`
 * / `apiFetch`), regardless of the language.
 *
 * The 401 status alone is NOT enough: "current password incorrect" or a wrong
 * 2FA code also return 401, without the session being at fault.
 */
export function isUnauthenticatedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && SESSION_CODES.has(code);
}
