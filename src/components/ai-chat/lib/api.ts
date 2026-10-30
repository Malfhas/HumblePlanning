/** Chat HTTP client: cookies included, readable errors, JSON by default. */
import { createTranslator } from "use-intl/core";
import { documentLocale } from "@/i18n/client-fallback";

// i18n-dynamic: aiChat.http.*

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/** HTTP codes a user can actually run into: `aiChat.http.s<code>`. */
const EXPLAINED_STATUSES = new Set([400, 401, 403, 404, 409, 413, 415, 429, 500, 502, 503, 504]);

/**
 * What an HTTP code means, when the server said nothing more (empty or
 * non-JSON body: proxy, connection drop). Outside React: the `aiChat` catalog
 * of the page language is loaded only at that moment, which stays rare.
 */
export async function explainStatus(status: number): Promise<string> {
  const locale = documentLocale();
  const aiChat =
    locale === "en"
      ? (await import("@/messages/en/aiChat.json")).default
      : (await import("@/messages/fr/aiChat.json")).default;
  const t = createTranslator({ locale, messages: { aiChat } }) as unknown as (key: string, values?: Record<string, unknown>) => string;
  return EXPLAINED_STATUSES.has(status) ? t(`aiChat.http.s${status}`) : t("aiChat.http.generic", { status });
}

export async function api<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!response.ok) {
    let body: unknown;
    let message: string | null = null;
    try {
      body = await response.json();
      // Application routes answer `{ error }` (already translated); `message` for compatibility
      const parsed = body as { error?: string; message?: string };
      if (parsed.error || parsed.message) message = String(parsed.error ?? parsed.message);
    } catch {
      /* non-JSON body */
    }
    throw new ChatApiError(response.status, message ?? (await explainStatus(response.status)), body);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
