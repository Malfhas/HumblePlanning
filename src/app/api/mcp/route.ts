import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextRequest, NextResponse } from "next/server";
import { validateMcpKey } from "@/lib/services/mcp-service";
import { fetchUserPermissions, hasPermission, type UserPermissions } from "@/lib/services/permission-service";
import { getConfigValue } from "@/lib/services/config-service";
import { registerAllTools } from "@/lib/services/mcp-tools";
import { getOAuthUrls, getPublicBaseUrl, MCP_SCOPE } from "@/lib/services/mcp-oauth-service";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "@/lib/logger";
import type { AppLocale } from "@/i18n/config";
import { resolveRecipientLocale, resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator, type ServerTranslator } from "@/i18n/server-translator";

/**
 * MCP server (Streamable HTTP transport, `Mcp-Session-Id` sessions).
 *
 * Authentication on EVERY request: OAuth token (`mcp_at_…`) or static key
 * (`mcp_…`), active account, `mcp:use` permission. Permissions are re-read from
 * the DB on each request and injected into the session: removing `mcp:write`
 * or `mcp:use`, or deactivating the account, applies without reconnecting.
 *
 * Message language: before authentication, the request's; afterwards,
 * the token owner's (`users.locale`, read at `initialize` for the
 * session's tools).
 */

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  userId: string;
  setPermissions: (perms: UserPermissions) => void;
  lastSeen: number;
}

const SESSION_IDLE_MS = 60 * 60 * 1000;
const sessions = new Map<string, McpSession>();

/** Closes idle sessions (clients do not always send a DELETE). */
function sweepIdleSessions() {
  const limit = Date.now() - SESSION_IDLE_MS;
  for (const [id, s] of sessions) {
    if (s.lastSeen < limit) {
      sessions.delete(id);
      s.transport.close().catch(() => {});
    }
  }
}

/**
 * Extract the JSON-RPC request id from the body, if parseable.
 * Returns 0 as a fallback (not null) because the MCP client Zod schema
 * rejects `id: null` — it expects `string | number`.
 */
function extractRequestId(body: unknown): string | number {
  const first = Array.isArray(body) ? body[0] : body;
  if (first && typeof first === "object") {
    const id = (first as { id?: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return 0;
}

function jsonRpcError(status: number, code: number, message: string, id: string | number, headers?: Record<string, string>) {
  return NextResponse.json({ jsonrpc: "2.0", error: { code, message }, id }, { status, headers });
}

/** Translator for a given language, otherwise for the request language. */
async function translator(locale?: AppLocale): Promise<ServerTranslator> {
  return getServerTranslator(locale ?? (await resolveRequestLocale()));
}

/**
 * OAuth token or static key: only via `Authorization: Bearer …`.
 * The MCP specification forbids the token in the URL (it ends up in
 * logs and history): `?token=` is no longer read, see handleMcpRequest.
 */
function readToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim() || null;
  return null;
}

/** DNS rebinding protection: a browser request must come from the instance itself. */
async function isAllowedOrigin(request: NextRequest): Promise<boolean> {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Claude, ChatGPT… call from their servers, without Origin
  try {
    return new URL(origin).origin === new URL(await getPublicBaseUrl()).origin;
  } catch {
    return false;
  }
}

async function unauthorized(reason: "missing" | "invalid" | "query", requestId: string | number) {
  const { resourceMetadata } = await getOAuthUrls();
  // ASCII value only (HTTP header); the readable (translated) message is in the body.
  const error = {
    missing: [],
    invalid: [`error="invalid_token"`, `error_description="The access token is invalid, expired or revoked"`], // i18n-ignore ASCII HTTP header (RFC 6750), never translated
    query: [`error="invalid_request"`, `error_description="Access tokens in the URL query are not accepted; use the Authorization header"`], // i18n-ignore ASCII HTTP header (RFC 6750), never translated
  }[reason];
  const challenge = [...error, `resource_metadata="${resourceMetadata}"`, `scope="${MCP_SCOPE}"`].join(", ");
  const t = await translator();
  const message = {
    missing: t("mcpTools.transport.authMissing"),
    invalid: t("mcpTools.transport.authInvalid"),
    query: t("mcpTools.transport.authQuery"),
  }[reason];
  return jsonRpcError(401, -32001, message, requestId, { "WWW-Authenticate": `Bearer ${challenge}` });
}

async function handleMcpRequest(request: NextRequest, method: "GET" | "POST" | "DELETE") {
  // Parse body early (if POST) so we can echo the request id in error responses.
  const body: unknown = method === "POST" ? await request.clone().json().catch(() => null) : null;
  const requestId = extractRequestId(body);

  if ((await getConfigValue("MCP_ENABLED")) !== "true") {
    return jsonRpcError(503, -32000, (await translator())("mcpTools.transport.disabled"), requestId);
  }
  if (!(await isAllowedOrigin(request))) {
    return jsonRpcError(403, -32000, (await translator())("mcpTools.transport.originNotAllowed"), requestId);
  }

  // A token in the URL is rejected even if the header is present: the request
  // must not appear accepted (and the token is already exposed in the URL).
  if (request.nextUrl.searchParams.has("token")) return unauthorized("query", requestId);
  const token = readToken(request);
  const auth = token?.startsWith("mcp_") ? await validateMcpKey(token) : null;
  if (!auth) return unauthorized(token ? "invalid" : "missing", requestId);
  // Token owner's language: last known language, otherwise the instance's
  const ownerLocale = await resolveRecipientLocale(auth.locale);

  const perms = await fetchUserPermissions(auth.userId);
  if (!hasPermission(perms, "mcp:use")) {
    return jsonRpcError(403, -32001, (await translator(ownerLocale))("mcpTools.transport.permissionDenied"), requestId);
  }

  const sessionId = request.headers.get("mcp-session-id");
  if (sessionId) {
    const session = sessions.get(sessionId);
    // Unknown session (restart, expiration) or belonging to another account:
    // 404 → the client re-sends `initialize` (Streamable HTTP specification).
    if (!session || session.userId !== auth.userId) {
      return jsonRpcError(404, -32001, (await translator(ownerLocale))("mcpTools.transport.sessionNotFound"), requestId);
    }
    session.lastSeen = Date.now();
    session.setPermissions(perms);
    return session.transport.handleRequest(request);
  }

  if (method !== "POST" || !isInitializeRequest(body)) {
    return jsonRpcError(400, -32000, "Bad Request: No valid session ID provided (send an initialize request first)", requestId);
  }

  sweepIdleSessions();

  const server = new McpServer({ name: "HumblePlanning", version: "1.0.0" });
  const { setPermissions } = registerAllTools(server, { userId: auth.userId, permissions: perms, locale: ownerLocale });

  const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport, userId: auth.userId, setPermissions, lastSeen: Date.now() });
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  await server.connect(transport);
  return transport.handleRequest(request);
}

/** 500 error: error handling must never fail because of i18n. */
async function internalError() {
  const message = await translator()
    .then((t) => t("mcpTools.transport.internal"))
    .catch(() => "Internal error");
  return jsonRpcError(500, -32603, message, 0);
}

export async function POST(request: NextRequest) {
  try {
    return await handleMcpRequest(request, "POST");
  } catch (error) {
    logger.error("mcp", "MCP POST error", { error: error instanceof Error ? error.message : String(error) });
    return internalError();
  }
}

export async function GET(request: NextRequest) {
  try {
    return await handleMcpRequest(request, "GET");
  } catch (error) {
    logger.error("mcp", "MCP GET error", { error: error instanceof Error ? error.message : String(error) });
    return internalError();
  }
}

export async function DELETE(request: NextRequest) {
  try {
    return await handleMcpRequest(request, "DELETE");
  } catch (error) {
    logger.error("mcp", "MCP DELETE error", { error: error instanceof Error ? error.message : String(error) });
    return internalError();
  }
}
