import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import type { z } from "zod";
import { loadUserPermissions, hasPermission, type UserPermissions } from "@/lib/services/permission-service";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { AppError, type ErrorParams } from "@/lib/errors";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator, translateKey, type ServerTranslator } from "@/i18n/server-translator";
import type { AppLocale } from "@/i18n/config";
import { localizeErrorParams } from "@/lib/utils/error-params";

export { AppError } from "@/lib/errors";

const gzipAsync = promisify(gzip);

/** REST API by key (`Bearer hp_…`): allowed requests per minute. */
export const API_RATE_LIMIT_PER_KEY = 120;
export const API_RATE_LIMIT_PER_IP = 300;
const API_RATE_WINDOW_MS = 60 * 1000;

export async function getAuthSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session;
}

export async function requireAuth() {
  // Try session auth first
  const session = await getAuthSession();
  if (session) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { active: true },
    });
    if (!user || user.active === false) {
      throw new AppError("errors.unauthenticated");
    }
    return session;
  }

  // Try API key auth (Bearer token)
  const hdrs = await headers();
  const authHeader = hdrs.get("authorization");
  if (authHeader?.startsWith("Bearer hp_")) {
    const { getConfigValue } = await import("@/lib/services/config-service");
    const apiEnabled = await getConfigValue("API_ENABLED");
    if (apiEnabled !== "true") throw new AppError("errors.apiDisabled", { status: 503 });
    // Rate limiting (in memory, per process): per IP before
    // validation (slows down random key guessing), then per key.
    if (!checkRateLimit(`api-ip:${getClientIp(hdrs)}`, API_RATE_LIMIT_PER_IP, API_RATE_WINDOW_MS)) {
      throw new AppError("errors.rateLimited");
    }
    const { validateApiKey } = await import("@/lib/services/api-key-service");
    const apiKey = authHeader.slice(7);
    const result = await validateApiKey(apiKey);
    if (!result) throw new AppError("errors.invalidApiKey");
    if (!checkRateLimit(`api-key:${result.keyId}`, API_RATE_LIMIT_PER_KEY, API_RATE_WINDOW_MS)) {
      throw new AppError("errors.rateLimited");
    }

    // Verify user is active
    const user = await db.query.users.findFirst({
      where: eq(users.id, result.userId),
      columns: { id: true, name: true, active: true },
    });
    if (!user || user.active === false) {
      throw new AppError("errors.unauthenticated");
    }

    // Return a session-like object for compatibility
    return {
      user: { id: user.id, name: user.name },
      session: { id: result.keyId, token: apiKey },
    } as any;
  }

  throw new AppError("errors.unauthenticated");
}

/**
 * `new ApiError("tasks.errors.notFound")`: positional form of `AppError`
 * (translated code, status derived from the code unless `status` is explicit).
 * Prefer `new AppError(code, { params })` for new code.
 */
export class ApiError extends AppError {
  constructor(code: string, status?: number, details?: unknown, params?: ErrorParams) {
    super(code, { status, details, params });
    this.name = "ApiError";
  }
}

export async function requirePermission(userId: string, permission: string): Promise<UserPermissions> {
  const perms = await loadUserPermissions(userId);
  if (!hasPermission(perms, permission)) {
    throw new AppError("errors.forbidden");
  }
  return perms;
}

/**
 * Error response for a code (message key, translated into the request
 * language). Status: explicit `status`, otherwise derived from the last segment
 * of the code (`statusFromCode`: `notFound` → 404, `forbidden` → 403…, else 400).
 * Async: the translation depends on the request language.
 */
export async function apiError(code: string, status?: number, details?: unknown, params?: ErrorParams): Promise<NextResponse> {
  return handleApiError(new AppError(code, { status, details, params }));
}

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * Variant of `apiSuccess` that gzips the response if the client supports it.
 *
 * Use on endpoints whose JSON payload can be large
 * (e.g. `/api/tasks?unpaginated=true`, which can reach several tens
 * of MB). Without gzip: `Transfer-Encoding: chunked` sends the raw JSON over
 * the wire, which can amount to 30-50 MB for one-year ranges.
 *
 * Next.js / `bun next start` do **not** automatically compress
 * API routes (the `compress: true` flag only applies to static
 * assets). So compression is handled explicitly here, honoring the
 * client's `Accept-Encoding`.
 *
 * ⚡ If `TRUST_PROXY_COMPRESSION=true` is set in the environment
 * (recommended prod config behind Nginx/Caddy, which already gzip
 * in native C), Node compression is **disabled**: we return the
 * raw JSON and the reverse proxy compresses on the fly. Benefits:
 *  - +50-100 ms of Node CPU freed per request (zlib.gzip is synchronous)
 *  - Nginx compression 5× faster than JS zlib
 *  - No double compression
 * In dev (`bun next dev` on localhost without nginx), leave the variable
 * unset → the helper keeps compressing to save bandwidth.
 *
 * Compression cost: ~50-100 ms server-side for 30 MB → 3 MB. Largely
 * offset by the transfer gain (about 10× smaller) when no compressing
 * proxy sits upstream.
 */
export async function apiSuccessCompressed<T>(
  data: T,
  request: Request | { headers: Headers },
  status = 200,
): Promise<Response> {
  // "Delegate to the reverse proxy" mode: we return the raw JSON, and
  // Nginx/Caddy handles on-the-fly compression (gzip config
  // already enabled in nginx_config.md).
  if (process.env.TRUST_PROXY_COMPRESSION === "true") {
    return NextResponse.json(data, { status });
  }

  const accept = request.headers.get("accept-encoding") ?? "";
  const acceptsGzip = accept.includes("gzip");
  const json = JSON.stringify(data);

  if (!acceptsGzip || json.length < 1024) {
    // Small payload or client without gzip support: return as is.
    return NextResponse.json(data, { status });
  }

  const compressed = await gzipAsync(Buffer.from(json, "utf8"));
  return new Response(compressed as unknown as BodyInit, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      "Vary": "Accept-Encoding",
    },
  });
}

/**
 * Checks that a route ID is a UUID before any DB query.
 * Usage (in the `try` of a handler whose `catch` calls handleApiError):
 *   const { id } = await params;
 *   assertUuid(id);
 *
 * Throws `AppError("errors.invalidId")` (400). Returns `null` for legacy
 * calls of the form `const invalid = assertUuid(id); if (invalid) …`.
 *
 * Needed because the client can send optimistic IDs `__optimistic_XXX`
 * when the user clicks create→action-on-the-task very quickly, before the
 * creation POST has returned the real UUID. Without this check, Drizzle/pg
 * attempt a UUID cast and fail → unhandled rejection → the Next.js process
 * crashes and restarts → 502 on every in-flight request.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(id: string): null {
  if (!UUID_RE.test(id)) {
    throw new AppError("errors.invalidId", { status: 400 });
  }
  return null;
}

export async function validateBody<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<z.infer<T>> {
  const body = await request.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError("errors.invalidData", { status: 422, details: result.error.issues });
  }
  return result.data;
}

/** PostgreSQL unique constraint violation (23505), possibly wrapped by Drizzle. */
function isPgUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 3; depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

async function requestTranslator(): Promise<{ t: ServerTranslator; locale: AppLocale } | null> {
  try {
    const locale = await resolveRequestLocale();
    return { t: await getServerTranslator(locale), locale };
  } catch (err) {
    // Error handling must never fail because of i18n.
    logger.error("api", "i18n unavailable in handleApiError", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Converts an error into a JSON response `{ error, code, params?, fields?, details? }`.
 *
 * - `AppError` / `ApiError`: the code is translated into the request language
 *   (cookie → APP_LOCALE → Accept-Language), parameter dates are formatted
 *   (`localizeErrorParams`); `params` stays raw in the response. Code missing
 *   from the catalogs (a bug, reported by `i18n:check`): logged, code returned.
 * - PostgreSQL unique violation: `errors.conflict` (409).
 * - Otherwise: `errors.internal` (500), logged; the original message never
 *   leaves the server.
 */
export async function handleApiError(error: unknown): Promise<NextResponse> {
  if (error instanceof AppError) {
    const ctx = await requestTranslator();
    const tr = async (code: string, params?: ErrorParams) => {
      if (!ctx) return code;
      const localized = await localizeErrorParams(params, ctx.locale).catch(() => params);
      const text = translateKey(ctx.t, code, localized);
      if (text == null) logger.error("api", "Error code without a message", { code });
      return text ?? code;
    };
    const fields = error.fields
      ? Object.fromEntries(
          await Promise.all(Object.entries(error.fields).map(async ([field, spec]) => [field, await tr(spec.code, spec.params)] as const)),
        )
      : undefined;
    const message = fields ? Object.values(fields).join(" ; ") : await tr(error.code, error.params);
    return NextResponse.json(
      {
        error: message,
        code: error.code,
        ...(error.params ? { params: error.params } : {}),
        ...(fields ? { fields } : {}),
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  if (isPgUniqueViolation(error)) {
    return handleApiError(new AppError("errors.conflict"));
  }

  logger.error("api", "Unhandled API error", { error: error instanceof Error ? error.message : String(error) });
  return handleApiError(new AppError("errors.internal", { status: 500 }));
}
