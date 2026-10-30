import { NextResponse } from "next/server";
import { getConfigValue } from "@/lib/services/config-service";
import { handleTokenRequest, checkRateLimit, getClientIp, OAUTH_CORS_HEADERS } from "@/lib/services/mcp-oauth-service";
import { logger } from "@/lib/logger";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";

// RFC 6749 §5.1: token endpoint responses must not be cached.
const HEADERS = { ...OAUTH_CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache" };

/** Reads the body (standard OAuth form-urlencoded, or JSON) in a single read. */
async function readParams(request: Request): Promise<Record<string, string>> {
  const text = await request.text();
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const json = JSON.parse(text);
      if (!json || typeof json !== "object") return {};
      return Object.fromEntries(
        Object.entries(json as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => [k, v as string]),
      );
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/** `client_id` sent via HTTP Basic (client_secret_basic): the secret is ignored, public clients only. */
function readBasicClientId(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const id = decoded.split(":")[0];
    return id ? decodeURIComponent(id) : null;
  } catch {
    return null;
  }
}

// The `error` codes stay those of RFC 6749; only `error_description` follows the request language.
export async function POST(request: Request) {
  try {
    const locale = await resolveRequestLocale();
    const t = await getServerTranslator(locale);
    const mcpEnabled = await getConfigValue("MCP_ENABLED");
    if (mcpEnabled !== "true") {
      return NextResponse.json({ error: "temporarily_unavailable", error_description: t("mcpTools.oauth.disabled") }, { status: 503, headers: HEADERS });
    }

    const ip = getClientIp(request.headers);
    if (!checkRateLimit(`mcp-token:${ip}`, 120, 60 * 1000)) {
      return NextResponse.json({ error: "slow_down", error_description: t("mcpTools.oauth.tokenRateLimited") }, { status: 429, headers: HEADERS });
    }

    const params = await readParams(request);
    const result = await handleTokenRequest(params, readBasicClientId(request), {
      ip,
      userAgent: request.headers.get("user-agent"),
    }, locale);
    return NextResponse.json(result.body, { status: result.status, headers: HEADERS });
  } catch (error) {
    logger.error("mcp", "MCP token error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: HEADERS });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}
