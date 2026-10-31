import { NextResponse } from "next/server";
import { getConfigValue } from "@/lib/services/config-service";
import { registerClient, checkPersistentRateLimit, getClientIp, OAUTH_CORS_HEADERS } from "@/lib/services/mcp-oauth-service";
import { logger } from "@/lib/logger";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";

// Dynamic OAuth client registration (RFC 7591), used by Claude,
// ChatGPT, etc. when adding the connector. Public endpoint: rate-limited.
// The `error` codes stay those of the RFCs; only `error_description` is translated.
export async function POST(request: Request) {
  const headers = { ...OAUTH_CORS_HEADERS, "Cache-Control": "no-store" };
  try {
    const locale = await resolveRequestLocale();
    const t = await getServerTranslator(locale);
    const mcpEnabled = await getConfigValue("MCP_ENABLED");
    if (mcpEnabled !== "true") {
      return NextResponse.json({ error: "temporarily_unavailable", error_description: t("mcpTools.oauth.disabled") }, { status: 503, headers });
    }

    // Claude / ChatGPT requests share a few egress IPs: generous limit.
    if (!(await checkPersistentRateLimit(`mcp-register:${getClientIp(request.headers)}`, 60, 10 * 60 * 1000))) {
      return NextResponse.json({ error: "slow_down", error_description: t("mcpTools.oauth.registerRateLimited") }, { status: 429, headers });
    }

    const body = await request.json().catch(() => null);
    const result = await registerClient(body, locale);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, error_description: result.description }, { status: 400, headers });
    }
    return NextResponse.json(result.body, { status: 201, headers });
  } catch (error) {
    logger.error("mcp", "MCP register error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "server_error" }, { status: 500, headers });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}
