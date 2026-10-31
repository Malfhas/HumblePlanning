import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getConfigValue } from "@/lib/services/config-service";
import {
  readAuthorizeParams,
  authorizeParamsToQuery,
  validateAuthorizeRequest,
  verifyConsentToken,
  checkMcpEligibility,
  createAuthorizationCode,
  buildAccessDeniedRedirect,
  buildCodeRedirect,
  checkPersistentRateLimit,
  getPublicBaseUrl,
} from "@/lib/services/mcp-oauth-service";
import { validateOrigin } from "@/lib/utils/csrf";
import { logAudit } from "@/lib/services/audit-service";
import { logger } from "@/lib/logger";
import { AppError, handleApiError } from "@/lib/utils/api";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";

/**
 * OAuth entry point (`authorization_endpoint`). Errors that can be
 * sent back to the client (verified redirect_uri) are returned immediately; everything
 * else (login, consent, blocking errors) is displayed by the
 * `/mcp-authorize` page, which revalidates the request server-side.
 */
export async function GET(request: NextRequest) {
  try {
    const params = readAuthorizeParams((k) => request.nextUrl.searchParams.get(k));
    const baseUrl = await getPublicBaseUrl();
    const consentUrl = `${baseUrl}/mcp-authorize?${authorizeParamsToQuery(params)}`;

    if ((await getConfigValue("MCP_ENABLED")) === "true") {
      const validation = await validateAuthorizeRequest(params, await resolveRequestLocale());
      if (!validation.ok && !validation.fatal) {
        return NextResponse.redirect(validation.redirectTo, 302);
      }
    }
    return NextResponse.redirect(consentUrl, 302);
  } catch (error) {
    logger.error("mcp", "MCP authorize GET error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/**
 * The user's decision on the consent screen (JSON `fetch` call
 * from `/mcp-authorize`). Returns `{ redirect }`: the page itself navigates
 * to Claude / ChatGPT (an HTTP redirect after POST would be blocked by the
 * CSP directive `form-action 'self'`).
 *
 * Anti-CSRF: verified Origin + `Content-Type: application/json` (no cross-site
 * POST without a CORS preflight) + HMAC token bound to the session and the request.
 *
 * Errors: `{ error, code }` translated in the request language (handleApiError).
 */
export async function POST(request: NextRequest) {
  try {
    if (!validateOrigin(request) || !(request.headers.get("content-type") || "").includes("application/json")) {
      return handleApiError(new AppError("mcp.errors.consentRejected", { status: 403 }));
    }
    if ((await getConfigValue("MCP_ENABLED")) !== "true") {
      return handleApiError(new AppError("mcp.errors.connectorDisabled", { status: 503 }));
    }

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return handleApiError(new AppError("mcp.errors.sessionExpired"));
    }
    const userId = session.user.id;

    if (!(await checkPersistentRateLimit(`mcp-consent:${userId}`, 30, 10 * 60 * 1000))) {
      return handleApiError(new AppError("mcp.errors.consentRateLimited", { status: 429 }));
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return handleApiError(new AppError("errors.invalidRequest"));
    }
    const params = readAuthorizeParams((k) => (typeof body[k] === "string" ? (body[k] as string) : null));

    if (typeof body.csrf !== "string" || !verifyConsentToken(body.csrf, session.session.id, params)) {
      return handleApiError(new AppError("mcp.errors.invalidCsrf", { status: 403 }));
    }

    const locale = await resolveRequestLocale();
    const validation = await validateAuthorizeRequest(params, locale);
    if (!validation.ok) {
      return validation.fatal
        ? handleApiError(new AppError(validation.code, { status: 400 }))
        : NextResponse.json({ redirect: validation.redirectTo });
    }
    const { client, params: p } = validation;
    const t = await getServerTranslator(locale);

    if (body.decision !== "approve") {
      return NextResponse.json({ redirect: await buildAccessDeniedRedirect(p.redirectUri, p.state, t("mcpTools.oauth.accessDenied")) });
    }

    const eligibility = await checkMcpEligibility(userId);
    if (!eligibility.ok) {
      return NextResponse.json({
        redirect: await buildAccessDeniedRedirect(p.redirectUri, p.state, t("mcpTools.oauth.accountNotAllowed")),
      });
    }

    const code = await createAuthorizationCode(userId, client, p);
    logAudit({
      userId,
      action: "mcp_key_create",
      entityType: "mcp_key",
      metadata: { name: `OAuth : ${client.clientName}`, clientId: client.clientId, redirectUri: p.redirectUri },
    }).catch(() => {});
    return NextResponse.json({ redirect: await buildCodeRedirect(p.redirectUri, code, p.state) });
  } catch (error) {
    logger.error("mcp", "MCP authorize POST error", { error: error instanceof Error ? error.message : String(error) });
    return handleApiError(new AppError("errors.internal", { status: 500 }));
  }
}
