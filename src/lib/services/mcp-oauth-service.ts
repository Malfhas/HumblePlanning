/**
 * OAuth 2.1 authorization server of the MCP connector (`/api/mcp`).
 *
 * Flow (MCP Authorization specification):
 *   1. `POST /api/mcp` without a token → 401 + `WWW-Authenticate: Bearer resource_metadata=…`
 *   2. The client reads the metadata (RFC 9728 then RFC 8414), identifies itself
 *      with a Client ID Metadata Document (CIMD, `client_id` = HTTPS URL, method
 *      recommended by the spec) or registers (RFC 7591, public client without
 *      secret), then opens `/api/mcp/oauth/authorize`.
 *   3. The user logs in with their account (login + password + 2FA),
 *      then approves the `/mcp-authorize` consent screen.
 *   4. The client exchanges the code (PKCE S256 mandatory) for a short-lived
 *      access token + a rotating refresh token.
 *
 * All secrets (codes, access tokens, refresh tokens) are stored hashed
 * (SHA-256). The `mcp:use` / `mcp:write` permissions are not frozen in the
 * token: they are re-read on every MCP request.
 */
import { db } from "@/db";
import { mcpClients, mcpAuthorizationCodes, mcpTokens, users } from "@/db/schema";
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getConfigValue } from "./config-service";
import { fetchUserPermissions, hasPermission, type UserPermissions } from "./permission-service";
import type { AppLocale } from "@/i18n/config";
import { getServerTranslator, type ServerTranslator } from "@/i18n/server-translator";

export const MCP_SCOPE = "mcp";
const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 min, single use
const ACCESS_TOKEN_TTL_S = 60 * 60; // 1 h
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 d (sliding, rotated on every use)
// Two simultaneous refreshes from the same client (network race): we reject the
// second one without revoking the whole connection if it arrives in this window.
const REFRESH_REUSE_GRACE_MS = 30 * 1000;

/** Resolved OAuth client, whether it comes from a CIMD or from the `mcp_clients` table (DCR). */
export interface OAuthClient {
  /** `client_id` as sent by the client (URL for a CIMD). */
  clientId: string;
  /** Value stored in the `client_id` columns (varchar 100) of codes and tokens. */
  storageId: string;
  clientName: string;
  redirectUris: string[];
  /** Host of the CIMD document (verifiable identity), `null` for a DCR client. */
  metadataHost: string | null;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ─── Public URLs ───

/**
 * Public URL of the instance. `.env` is authoritative (like `server.ts` and
 * `csrf.ts`), then the Settings value. The OAuth issuer and the resource URL
 * must be exactly those seen by Claude / ChatGPT.
 */
export async function getPublicBaseUrl(): Promise<string> {
  const raw = process.env.APP_BASE_URL || (await getConfigValue("APP_BASE_URL")) || "http://localhost:3000";
  return raw.trim().replace(/\/+$/, "");
}

export async function getOAuthUrls() {
  const base = await getPublicBaseUrl();
  return {
    issuer: base,
    resource: `${base}/api/mcp`,
    resourceMetadata: `${base}/.well-known/oauth-protected-resource/api/mcp`,
    authorizationEndpoint: `${base}/api/mcp/oauth/authorize`,
    tokenEndpoint: `${base}/api/mcp/oauth/token`,
    registrationEndpoint: `${base}/api/mcp/oauth/register`,
  };
}

/** Authorization server metadata (RFC 8414). */
export async function buildAuthorizationServerMetadata() {
  const urls = await getOAuthUrls();
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorizationEndpoint,
    token_endpoint: urls.tokenEndpoint,
    registration_endpoint: urls.registrationEndpoint,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
    // CIMD (recommended method); DCR is still offered for older clients.
    client_id_metadata_document_supported: true,
    // RFC 9207: `iss` is returned in every authorization response. Required by
    // ChatGPT to use its stable redirect URI.
    authorization_response_iss_parameter_supported: true,
  };
}

/** Metadata of the protected resource `/api/mcp` (RFC 9728). */
export async function buildProtectedResourceMetadata() {
  const urls = await getOAuthUrls();
  const appTitle = (await getConfigValue("APP_TITLE")) || "Humble Planning";
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: appTitle,
  };
}

/**
 * CORS of the public OAuth endpoints (metadata, registration, token).
 * No cookie is used there (no `Allow-Credentials`): the `*` origin lets
 * clients running in a browser (MCP Inspector…) perform discovery without
 * opening the cookie-authenticated API.
 */
export const OAUTH_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

// ─── Rate limiting (in memory, per process — like /api/auth/login) ───
// Implementation shared with the REST API (src/lib/utils/rate-limit.ts).

export { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";

// ─── Redirect URI ───

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set([
  "javascript:", "data:", "vbscript:", "file:", "about:", "blob:", "filesystem:", "ws:", "wss:", "ftp:",
]);

/**
 * URI accepted at registration: HTTPS, HTTP only on loopback (local
 * clients), or private-use scheme of a native app (RFC 8252, e.g.
 * `cursor://…`). Never a fragment or credentials.
 */
export function isAcceptableRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000 || value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return !!url.hostname;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/** Exact comparison; only exception: any port on loopback (RFC 8252 §7.3). */
function redirectUriMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.protocol !== "http:" || !LOOPBACK_HOSTS.has(req.hostname)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return u.protocol === "http:" && u.hostname === req.hostname && u.pathname === req.pathname && u.search === req.search;
    } catch {
      return false;
    }
  });
}

const KNOWN_CLIENTS: { hosts: string[]; label: string }[] = [
  { hosts: ["claude.ai", "claude.com"], label: "Claude (Anthropic)" },
  { hosts: ["chatgpt.com", "chat.openai.com", "openai.com"], label: "ChatGPT (OpenAI)" },
];

/**
 * Identifies the client from the redirect domain (the only reliable data:
 * `client_name` is self-declared and anyone can call itself "Claude").
 */
export function describeRedirectTarget(redirectUri: string): { host: string; knownLabel: string | null } {
  try {
    const url = new URL(redirectUri);
    const host = url.protocol === "https:" || url.protocol === "http:" ? url.host : `${url.protocol}//${url.host}`;
    const hostname = url.hostname.toLowerCase();
    const known = KNOWN_CLIENTS.find((c) => c.hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`)));
    return { host, knownLabel: known && url.protocol === "https:" ? known.label : null };
  } catch {
    return { host: redirectUri, knownLabel: null };
  }
}

/** Authorization response sent back to the client: always adds `iss` (RFC 9207). */
async function buildClientRedirect(redirectUri: string, params: Record<string, string | undefined>): Promise<string> {
  const { issuer } = await getOAuthUrls();
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries({ ...params, iss: issuer })) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

export function buildAccessDeniedRedirect(redirectUri: string, state: string, description: string): Promise<string> {
  return buildClientRedirect(redirectUri, { error: "access_denied", error_description: description, state: state || undefined });
}

export function buildCodeRedirect(redirectUri: string, code: string, state: string): Promise<string> {
  return buildClientRedirect(redirectUri, { code, state: state || undefined });
}

// ─── Client ID Metadata Documents (CIMD) ───

const CIMD_MAX_BYTES = 5 * 1024;
const CIMD_TIMEOUT_MS = 5000;
const cimdCache = new Map<string, { client: OAuthClient; expiresAt: number }>();

/** Publicly routable address (rejects special-purpose ranges, RFC 6890) — anti-SSRF. */
function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const v6 = address.toLowerCase();
    if (v6 === "::" || v6 === "::1") return false;
    if (v6.startsWith("::ffff:")) return isPublicAddress(v6.slice(7));
    if (/^(f[cd]|fe[89ab]|ff)/.test(v6) || v6.startsWith("2001:db8") || v6.startsWith("64:ff9b")) return false;
    return true;
  }
  return false;
}

/** URL shape required for a CIMD `client_id` (https, with a path, no fragment or credentials). */
function isCimdClientId(clientId: string): boolean {
  if (!clientId.startsWith("https://") || clientId.length > 2000) return false;
  try {
    const url = new URL(clientId);
    return url.href === clientId
      && url.pathname !== "/"
      && !url.hash
      && !url.username
      && !url.password
      && !/\/\.\.?(\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

/** `client_id` columns limited to 100 characters: beyond that, a stable hash of the URL. */
function toStorageId(clientId: string): string {
  return clientId.length <= 100 ? clientId : `cimd:${sha256Hex(clientId)}`;
}

async function fetchCimdClient(clientId: string): Promise<OAuthClient | null> {
  const cached = cimdCache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.client;

  const url = new URL(clientId);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) return null;

  // No redirect followed, 200 response mandatory, bounded size
  const res = await fetch(clientId, {
    redirect: "manual",
    signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (res.status !== 200 || !res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CIMD_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  if (doc.client_id !== clientId) return null;
  if (typeof doc.client_name !== "string" || !doc.client_name.trim()) return null;
  const redirectUris = doc.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every(isAcceptableRedirectUri)) return null;
  // A CIMD cannot carry a shared secret
  if ("client_secret" in doc) return null;
  if (typeof doc.token_endpoint_auth_method === "string" && doc.token_endpoint_auth_method.startsWith("client_secret")) return null;

  const client: OAuthClient = {
    clientId,
    storageId: toStorageId(clientId),
    clientName: doc.client_name.trim().slice(0, 255),
    redirectUris: redirectUris as string[],
    metadataHost: url.host,
  };

  const maxAge = Number(/max-age=(\d+)/i.exec(res.headers.get("cache-control") || "")?.[1] ?? 300);
  const ttlMs = Math.min(Math.max(Number.isFinite(maxAge) ? maxAge : 300, 60), 3600) * 1000;
  if (cimdCache.size > 500) cimdCache.clear();
  cimdCache.set(clientId, { client, expiresAt: Date.now() + ttlMs });
  return client;
}

/** Resolves a `client_id`: CIMD document if it is an HTTPS URL, otherwise registered client (DCR). */
export async function resolveClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId) return null;
  if (clientId.startsWith("https://")) {
    if (!isCimdClientId(clientId)) return null;
    return fetchCimdClient(clientId).catch(() => null);
  }
  const row = await db.query.mcpClients.findFirst({ where: eq(mcpClients.clientId, clientId) });
  if (!row) return null;
  return {
    clientId: row.clientId,
    storageId: row.clientId,
    clientName: row.clientName,
    redirectUris: row.redirectUris,
    metadataHost: null,
  };
}

/** Canonical form of a resource URI: lowercase host, no default port or trailing "/". */
function canonicalResource(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

async function isAcceptedResource(resource: string): Promise<boolean> {
  const { issuer, resource: canonical } = await getOAuthUrls();
  const value = canonicalResource(resource);
  // The origin alone is tolerated (older metadata published `resource: <origin>`).
  return value !== null && (value === canonicalResource(canonical) || value === canonicalResource(issuer));
}

// ─── Dynamic registration (RFC 7591) ───

export type RegistrationResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string; description: string };

/** `error` (RFC 7591 §3.2.2) stays a stable code; only `description` follows the request language. */
export async function registerClient(input: unknown, locale: AppLocale): Promise<RegistrationResult> {
  const t = await getServerTranslator(locale);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "invalid_client_metadata", description: t("mcpTools.oauth.jsonBodyExpected") };
  }
  const body = input as Record<string, unknown>;

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
    return { ok: false, error: "invalid_redirect_uri", description: t("mcpTools.oauth.redirectUrisCount") };
  }
  if (!redirectUris.every(isAcceptableRedirectUri)) {
    return { ok: false, error: "invalid_redirect_uri", description: t("mcpTools.oauth.redirectUriRejected") };
  }

  const grantTypes = body.grant_types;
  if (grantTypes !== undefined && (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code"))) {
    return { ok: false, error: "invalid_client_metadata", description: t("mcpTools.oauth.grantTypesMissingCode") };
  }
  const responseTypes = body.response_types;
  if (responseTypes !== undefined && (!Array.isArray(responseTypes) || !responseTypes.includes("code"))) {
    return { ok: false, error: "invalid_client_metadata", description: t("mcpTools.oauth.responseTypesMissingCode") };
  }

  const clientName = (typeof body.client_name === "string" ? body.client_name.trim() : "").slice(0, 255) || "Client MCP";
  const httpsOrNull = (v: unknown) =>
    typeof v === "string" && v.length <= 2000 && /^https:\/\//i.test(v) ? v : null;
  const clientUri = httpsOrNull(body.client_uri);
  const logoUri = httpsOrNull(body.logo_uri);

  const clientId = randomBytes(16).toString("hex");
  await db.insert(mcpClients).values({
    clientId,
    clientName,
    clientUri,
    redirectUris: redirectUris as string[],
    logoUri,
    isPublic: true,
  });

  // Public client: no secret (PKCE mandatory). RFC 7591 §3.2.1 allows
  // the server to replace the requested authentication method.
  return {
    ok: true,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: MCP_SCOPE,
      ...(clientUri ? { client_uri: clientUri } : {}),
      ...(logoUri ? { logo_uri: logoUri } : {}),
    },
  };
}

// ─── Authorization request ───

export interface AuthorizeParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string;
  resource: string;
}

export function readAuthorizeParams(get: (key: string) => string | null | undefined): AuthorizeParams {
  const v = (key: string) => (get(key) ?? "").toString();
  return {
    responseType: v("response_type"),
    clientId: v("client_id"),
    redirectUri: v("redirect_uri"),
    codeChallenge: v("code_challenge"),
    codeChallengeMethod: v("code_challenge_method"),
    state: v("state"),
    scope: v("scope"),
    resource: v("resource"),
  };
}

export function authorizeParamsToQuery(p: AuthorizeParams): string {
  const q = new URLSearchParams();
  const entries: [string, string][] = [
    ["response_type", p.responseType],
    ["client_id", p.clientId],
    ["redirect_uri", p.redirectUri],
    ["code_challenge", p.codeChallenge],
    ["code_challenge_method", p.codeChallengeMethod],
    ["state", p.state],
    ["scope", p.scope],
    ["resource", p.resource],
  ];
  for (const [k, val] of entries) if (val) q.set(k, val);
  return q.toString();
}

/** Blocking errors of the authorization request (`mcp.errors.*` keys, translated by the caller). */
export type AuthorizeFatalCode =
  | "mcp.errors.missingClientId"
  | "mcp.errors.clientUnverifiable"
  | "mcp.errors.unknownClient"
  | "mcp.errors.missingRedirectUri"
  | "mcp.errors.redirectUriNotRegistered";

export type AuthorizeValidation =
  | { ok: true; client: OAuthClient; params: AuthorizeParams }
  /** Untrusted client or redirect_uri: we show the error, we NEVER redirect. */
  | { ok: false; fatal: true; code: AuthorizeFatalCode }
  /** Invalid request but verified redirect_uri: OAuth error returned to the client. */
  | { ok: false; fatal: false; redirectTo: string };

/** `locale`: request language, for the `error_description` returned to the OAuth client. */
export async function validateAuthorizeRequest(p: AuthorizeParams, locale: AppLocale): Promise<AuthorizeValidation> {
  if (!p.clientId) return { ok: false, fatal: true, code: "mcp.errors.missingClientId" };
  const client = await resolveClient(p.clientId);
  if (!client) {
    return {
      ok: false,
      fatal: true,
      code: p.clientId.startsWith("https://") ? "mcp.errors.clientUnverifiable" : "mcp.errors.unknownClient",
    };
  }

  let redirectUri = p.redirectUri;
  if (!redirectUri) {
    if (client.redirectUris.length !== 1) {
      return { ok: false, fatal: true, code: "mcp.errors.missingRedirectUri" };
    }
    redirectUri = client.redirectUris[0];
  }
  if (!redirectUriMatches(client.redirectUris, redirectUri)) {
    return { ok: false, fatal: true, code: "mcp.errors.redirectUriNotRegistered" };
  }

  const t = await getServerTranslator(locale);
  const fail = async (error: string, description: string): Promise<AuthorizeValidation> => ({
    ok: false,
    fatal: false,
    redirectTo: await buildClientRedirect(redirectUri, { error, error_description: description, state: p.state || undefined }),
  });

  if (p.responseType !== "code") return fail("unsupported_response_type", t("mcpTools.oauth.unsupportedResponseType"));
  if (!p.codeChallenge) return fail("invalid_request", t("mcpTools.oauth.codeChallengeRequired"));
  if (p.codeChallengeMethod !== "S256") return fail("invalid_request", t("mcpTools.oauth.codeChallengeMethodRequired"));
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(p.codeChallenge)) return fail("invalid_request", t("mcpTools.oauth.codeChallengeInvalid"));
  if (p.resource && !(await isAcceptedResource(p.resource))) return fail("invalid_target", t("mcpTools.oauth.unknownResource"));

  return { ok: true, client, params: { ...p, redirectUri } };
}

// ─── Consent (anti-CSRF bound to the session) ───

const FALLBACK_SECRET = randomBytes(32).toString("hex");

function consentDigest(sessionId: string, p: AuthorizeParams): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET || FALLBACK_SECRET;
  return createHmac("sha256", secret)
    .update(["mcp-consent", sessionId, p.clientId, p.redirectUri, p.codeChallenge, p.state, p.resource].join("\n"))
    .digest();
}

export function computeConsentToken(sessionId: string, p: AuthorizeParams): string {
  return consentDigest(sessionId, p).toString("base64url");
}

export function verifyConsentToken(token: string, sessionId: string, p: AuthorizeParams): boolean {
  const expected = consentDigest(sessionId, p);
  const given = Buffer.from(token || "", "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ─── Account eligibility ───

export type McpEligibility =
  | { ok: true; perms: UserPermissions }
  | { ok: false; reason: "inactive" | "no_mcp_use" };

/** Active account + `mcp:use` permission, read from the database (no cache). */
export async function checkMcpEligibility(userId: string): Promise<McpEligibility> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { active: true } });
  if (!user || user.active === false) return { ok: false, reason: "inactive" };
  const perms = await fetchUserPermissions(userId);
  if (!hasPermission(perms, "mcp:use")) return { ok: false, reason: "no_mcp_use" };
  return { ok: true, perms };
}

// ─── Authorization codes ───

export async function createAuthorizationCode(userId: string, client: OAuthClient, p: AuthorizeParams): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db.insert(mcpAuthorizationCodes).values({
    code: sha256Hex(code),
    clientId: client.storageId,
    userId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    codeChallengeMethod: "S256",
    scope: MCP_SCOPE,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
  });
  // Lazy cleanup of codes expired for more than a day
  db.delete(mcpAuthorizationCodes)
    .where(lt(mcpAuthorizationCodes.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))
    .catch(() => {});
  return code;
}

// ─── Endpoint token ───

export type TokenResult = { status: number; body: Record<string, unknown> };

function oauthError(status: number, error: string, description: string): TokenResult {
  return { status, body: { error, error_description: description } };
}

async function revokeClientTokens(userId: string, clientId: string, since?: Date) {
  const conditions = [eq(mcpTokens.userId, userId), eq(mcpTokens.clientId, clientId), isNull(mcpTokens.revokedAt)];
  if (since) conditions.push(gte(mcpTokens.createdAt, since));
  await db.update(mcpTokens).set({ revokedAt: new Date() }).where(and(...conditions));
}

async function issueTokens(client: OAuthClient, userId: string, meta: { ip: string; userAgent: string | null }): Promise<TokenResult> {
  const accessToken = `mcp_at_${randomBytes(32).toString("hex")}`;
  const refreshToken = `mcp_rt_${randomBytes(32).toString("hex")}`;
  await db.insert(mcpTokens).values({
    userId,
    clientId: client.storageId,
    clientName: client.clientName.slice(0, 255),
    accessToken: sha256Hex(accessToken),
    refreshToken: sha256Hex(refreshToken),
    scope: MCP_SCOPE,
    accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_S * 1000),
    refreshTokenExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    userAgent: meta.userAgent?.slice(0, 1000) ?? null,
    ipAddress: meta.ip.slice(0, 255),
  });
  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refreshToken,
      scope: MCP_SCOPE,
    },
  };
}

function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** `locale`: request language; only `error_description` is translated, `error` (RFC 6749) stays stable. */
export async function handleTokenRequest(
  params: Record<string, string>,
  basicClientId: string | null,
  meta: { ip: string; userAgent: string | null },
  locale: AppLocale,
): Promise<TokenResult> {
  const t = await getServerTranslator(locale);
  const clientId = params.client_id || basicClientId || "";
  if (!clientId) return oauthError(401, "invalid_client", t("mcpTools.oauth.clientIdRequired"));
  const client = await resolveClient(clientId);
  if (!client) return oauthError(401, "invalid_client", t("mcpTools.oauth.unknownClient"));
  if (params.resource && !(await isAcceptedResource(params.resource))) {
    return oauthError(400, "invalid_target", t("mcpTools.oauth.unknownResource"));
  }

  if (params.grant_type === "authorization_code") return exchangeAuthorizationCode(client, params, meta, t);
  if (params.grant_type === "refresh_token") return refreshTokens(client, params, meta, t);
  return oauthError(400, "unsupported_grant_type", t("mcpTools.oauth.unsupportedGrantType"));
}

async function exchangeAuthorizationCode(
  client: OAuthClient,
  params: Record<string, string>,
  meta: { ip: string; userAgent: string | null },
  t: ServerTranslator,
): Promise<TokenResult> {
  const { code, code_verifier: verifier, redirect_uri: redirectUri } = params;
  if (!code) return oauthError(400, "invalid_request", t("mcpTools.oauth.codeRequired"));
  if (!verifier || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) {
    return oauthError(400, "invalid_request", t("mcpTools.oauth.codeVerifierRequired"));
  }

  const row = await db.query.mcpAuthorizationCodes.findFirst({
    where: eq(mcpAuthorizationCodes.code, sha256Hex(code)),
  });
  if (!row || row.clientId !== client.storageId) return oauthError(400, "invalid_grant", t("mcpTools.oauth.invalidCode"));
  if (row.usedAt) {
    // Code replay: revoke the tokens issued from it (RFC 6749 §4.1.2)
    await revokeClientTokens(row.userId, row.clientId, row.createdAt);
    return oauthError(400, "invalid_grant", t("mcpTools.oauth.codeAlreadyUsed"));
  }
  if (row.expiresAt < new Date()) return oauthError(400, "invalid_grant", t("mcpTools.oauth.codeExpired"));
  if (redirectUri && redirectUri !== row.redirectUri) return oauthError(400, "invalid_grant", t("mcpTools.oauth.redirectUriMismatch"));
  if (!verifyPkceS256(verifier, row.codeChallenge)) return oauthError(400, "invalid_grant", t("mcpTools.oauth.pkceFailed"));

  // Atomic consumption: a single exchange possible, even with concurrent requests
  const consumed = await db.update(mcpAuthorizationCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(mcpAuthorizationCodes.id, row.id), isNull(mcpAuthorizationCodes.usedAt)))
    .returning({ id: mcpAuthorizationCodes.id });
  if (consumed.length === 0) return oauthError(400, "invalid_grant", t("mcpTools.oauth.codeAlreadyUsed"));

  const eligibility = await checkMcpEligibility(row.userId);
  if (!eligibility.ok) return oauthError(400, "invalid_grant", t("mcpTools.oauth.accountIneligible"));

  return issueTokens(client, row.userId, meta);
}

async function refreshTokens(
  client: OAuthClient,
  params: Record<string, string>,
  meta: { ip: string; userAgent: string | null },
  t: ServerTranslator,
): Promise<TokenResult> {
  const refreshToken = params.refresh_token;
  if (!refreshToken) return oauthError(400, "invalid_request", t("mcpTools.oauth.refreshTokenRequired"));

  const row = await db.query.mcpTokens.findFirst({
    where: eq(mcpTokens.refreshToken, sha256Hex(refreshToken)),
  });
  if (!row || row.clientId !== client.storageId) return oauthError(400, "invalid_grant", t("mcpTools.oauth.invalidRefreshToken"));
  if (row.revokedAt) {
    // Refresh token already rotated or revoked: sign of theft → cut the connection
    if (Date.now() - row.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
      await revokeClientTokens(row.userId, row.clientId);
    }
    return oauthError(400, "invalid_grant", t("mcpTools.oauth.refreshTokenRevoked"));
  }
  if (!row.refreshTokenExpiresAt || row.refreshTokenExpiresAt < new Date()) {
    return oauthError(400, "invalid_grant", t("mcpTools.oauth.refreshTokenExpired"));
  }

  // Rotation: the old pair (access + refresh) is invalidated atomically
  const rotated = await db.update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpTokens.id, row.id), isNull(mcpTokens.revokedAt)))
    .returning({ id: mcpTokens.id });
  if (rotated.length === 0) return oauthError(400, "invalid_grant", t("mcpTools.oauth.refreshTokenRevoked"));

  const eligibility = await checkMcpEligibility(row.userId);
  if (!eligibility.ok) return oauthError(400, "invalid_grant", t("mcpTools.oauth.accountIneligible"));

  return issueTokens(client, row.userId, meta);
}
