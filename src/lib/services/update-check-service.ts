/**
 * Update check — Settings > Version.
 *
 * The admin panel only INFORMS: it runs nothing. Updates are done from the
 * command line on the server (`humble-planning update`, see
 * `deploy/humble-planning`), which reads the same GitHub releases.
 *
 * Privacy:
 *  - the request leaves from the server, at most once every 24 h (the result
 *    is persisted in `app_config`, internal key `UPDATE_CHECK_STATE`, never
 *    returned by GET /api/config); « Vérifier maintenant » forces a call;
 *  - it is a plain GET on the public GitHub Releases API: no cookie,
 *    no token, generic User-Agent (neither version nor instance identifier);
 *  - `UPDATE_CHECK_ENABLED=false` (admin setting): no outgoing request,
 *    neither automatic nor manual.
 *
 * Security update: at least one release newer than the installed version
 * carries the `[security]` marker (case-insensitive) in its title or its
 * body. Convention documented in README.md ("Updating").
 */

import { db } from "@/db";
import { appConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { isDemoMode } from "@/lib/demo";
import { UPDATE_CHECK_STATE_KEY } from "./config-secrets";

// ════════════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════════════

/** Admin setting (app_config). Missing = enabled. */
export const UPDATE_CHECK_ENABLED_KEY = "UPDATE_CHECK_ENABLED";
/** Same default as `deploy/humble-planning` (DEFAULT_UPDATE_REPO). */
const DEFAULT_UPDATE_REPO = "Malfhas/HumblePlanning";
const GITHUB_API_URL = "https://api.github.com";
/** Command shown to the admin: the CLI refuses to run without root. */
export const UPDATE_COMMAND = "sudo humble-planning update";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
/**
 * Releases requested in a single request. More than the 5 displayed: the
 * [security] marker must be seen on ALL releases newer than the installed
 * one, even when the instance is several versions behind.
 */
const RELEASES_PER_PAGE = 20;
/** Releases of the displayed history, in addition to the latest one. */
const HISTORY_SIZE = 5;
const MAX_NOTES_LENGTH = 20_000;
const USER_AGENT = "humble-planning-update-check";
const SECURITY_MARKER = /\[security\]/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const STATE_VERSION = 1;

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

// ════════════════════════════════════════════════════════════════════════
// Types (shared with the front end via `import type`)
// ════════════════════════════════════════════════════════════════════════

export type UpdateStatus =
  | "up_to_date"
  | "update_available"
  | "security_update"
  | "disabled"
  | "no_release"
  | "error";

export type UpdateCheckError =
  | "network"
  | "timeout"
  | "rate_limited"
  | "not_found"
  | "http"
  | "invalid_response"
  | "invalid_repo";

export interface ReleaseInfo {
  /** Normalized version, without "v" (e.g. "1.2.0"). */
  version: string;
  tag: string;
  /** Release title without the [security] marker, or null. */
  name: string | null;
  /** Raw release notes (Markdown, truncated to 20,000 characters). */
  notes: string;
  publishedAt: string | null;
  url: string;
  prerelease: boolean;
  security: boolean;
  /** Newer than the installed version. */
  newer: boolean;
}

export interface VersionStatusResponse {
  status: UpdateStatus;
  enabled: boolean;
  currentVersion: string;
  /** Latest known release (ignored if the check is disabled). */
  latest: ReleaseInfo | null;
  /** Releases preceding `latest`, from newest to oldest. */
  history: ReleaseInfo[];
  newerCount: number;
  updateAvailable: boolean;
  securityUpdate: boolean;
  /** Last attempt (successful or not). */
  checkedAt: string | null;
  /** Last successful check (the displayed data comes from it). */
  lastSuccessAt: string | null;
  error: UpdateCheckError | null;
  repo: string;
  repoUrl: string;
  /** Exact URL contacted (null if the configured repository is invalid). */
  sourceUrl: string | null;
  updateCommand: string;
}

interface StoredRelease {
  tag: string;
  name: string | null;
  body: string;
  publishedAt: string | null;
  url: string | null;
  prerelease: boolean;
}

interface PersistedState {
  v: number;
  source: string;
  checkedAt: string;
  error: UpdateCheckError | null;
  successAt: string | null;
  /** Releases (excluding drafts) of the last successful check. */
  releases: StoredRelease[];
}

// ════════════════════════════════════════════════════════════════════════
// Semver
// ════════════════════════════════════════════════════════════════════════

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: (string | number)[];
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/i;

/** "v1.2.3", "1.2.3-rc.1", "1.2.3+build" → SemVer; anything else → null. */
export function parseSemver(input: string | null | undefined): SemVer | null {
  const m = SEMVER_RE.exec(String(input ?? "").trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [],
  };
}

/** Semver 2.0 order: 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-beta < 1.0.0. Build ignored. */
export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1; // numeric < alphanumeric
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function formatSemver(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}${v.pre.length ? `-${v.pre.join(".")}` : ""}`;
}

// ════════════════════════════════════════════════════════════════════════
// Configuration
// ════════════════════════════════════════════════════════════════════════

function resolveRepo(): string {
  return (process.env.HUMBLE_UPDATE_REPO || "").trim() || DEFAULT_UPDATE_REPO;
}

/**
 * API URL. `HUMBLE_UPDATE_API_URL` is RESERVED FOR TESTS (local mock):
 * in production, api.github.com is always queried.
 */
function resolveApiBase(): string {
  const override = (process.env.HUMBLE_UPDATE_API_URL || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s]+$/i.test(override) ? override : GITHUB_API_URL;
}

function resolveSource(repo: string): string | null {
  if (!REPO_RE.test(repo)) return null;
  return `${resolveApiBase()}/repos/${repo}/releases?per_page=${RELEASES_PER_PAGE}`;
}

/**
 * Read directly from the database (without the config cache, which is per route
 * bundle): disabling must cut outgoing requests immediately.
 */
async function isUpdateCheckEnabled(): Promise<boolean> {
  if (isDemoMode()) return false;
  const row = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, UPDATE_CHECK_ENABLED_KEY),
    columns: { value: true },
  });
  return row?.value !== "false";
}

// ════════════════════════════════════════════════════════════════════════
// Persisted state (app_config)
// ════════════════════════════════════════════════════════════════════════

// Process memory, shared between route bundles via `globalThis`:
// request in progress (only one at a time: double click, banner and tab
// open together…) and a copy of the last state, in case the database write
// failed.
const memory = globalThis as typeof globalThis & {
  __hpUpdateCheck?: { inflight: Promise<PersistedState> | null; last: PersistedState | null };
};
const store = (memory.__hpUpdateCheck ??= { inflight: null, last: null });

async function readState(): Promise<PersistedState | null> {
  try {
    const row = await db.query.appConfig.findFirst({
      where: eq(appConfig.key, UPDATE_CHECK_STATE_KEY),
      columns: { value: true },
    });
    if (row?.value) {
      const state = JSON.parse(row.value) as PersistedState;
      if (state?.v === STATE_VERSION && Array.isArray(state.releases) && typeof state.checkedAt === "string") return state;
    }
  } catch {
    // Unreadable value: treated as missing.
  }
  return store.last;
}

async function writeState(state: PersistedState): Promise<void> {
  try {
    const value = JSON.stringify(state);
    await db
      .insert(appConfig)
      // i18n-ignore technical description of an internal app_config row (database data, never displayed)
      .values({ key: UPDATE_CHECK_STATE_KEY, value, description: "État interne de la vérification des mises à jour" })
      .onConflictDoUpdate({ target: appConfig.key, set: { value } });
  } catch (err) {
    // Non-blocking: the result is still returned to the admin.
    logger.warn("system", "Update check: state not saved", { error: String(err) });
  }
}

function isStale(state: PersistedState | null, source: string): boolean {
  if (!state || state.source !== source) return true;
  const age = Date.now() - Date.parse(state.checkedAt);
  // Negative age = clock went backwards: check again.
  return !(age >= 0 && age < CHECK_INTERVAL_MS);
}

// ════════════════════════════════════════════════════════════════════════
// GitHub request
// ════════════════════════════════════════════════════════════════════════

type FetchResult = { ok: true; releases: StoredRelease[] } | { ok: false; error: UpdateCheckError };

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function fetchReleases(source: string): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(source, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }

  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    const rateLimited =
      res.status === 429 ||
      (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")));
    if (rateLimited) return { ok: false, error: "rate_limited" };
    if (res.status === 404) return { ok: false, error: "not_found" };
    return { ok: false, error: "http" };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    // The timeout also covers reading the body.
    const name = err instanceof Error ? err.name : "";
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "invalid_response" };
  }
  if (!Array.isArray(data)) return { ok: false, error: "invalid_response" };

  const releases: StoredRelease[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.draft === true) continue;
    const tag = str(r.tag_name);
    if (!tag || !parseSemver(tag)) continue;
    const body = typeof r.body === "string" ? r.body.replace(/\r\n?/g, "\n") : "";
    releases.push({
      tag,
      name: str(r.name),
      // i18n-ignore ellipsis only (release notes truncation)
      body: body.length > MAX_NOTES_LENGTH ? `${body.slice(0, MAX_NOTES_LENGTH)}\n\n…` : body,
      publishedAt: str(r.published_at),
      url: str(r.html_url),
      prerelease: r.prerelease === true,
    });
  }
  return { ok: true, releases };
}

function runCheck(source: string, previous: PersistedState | null): Promise<PersistedState> {
  if (store.inflight) return store.inflight;
  const promise = (async () => {
    const result = await fetchReleases(source);
    const now = new Date().toISOString();
    // Same source: keep the data of the last success in case of failure.
    const kept = previous && previous.source === source ? previous : null;
    const state: PersistedState = result.ok
      ? { v: STATE_VERSION, source, checkedAt: now, error: null, successAt: now, releases: result.releases }
      : { v: STATE_VERSION, source, checkedAt: now, error: result.error, successAt: kept?.successAt ?? null, releases: kept?.releases ?? [] };
    if (!result.ok) {
      logger.warn("system", `Update check failed (${result.error})`, { source });
    }
    store.last = state;
    await writeState(state);
    return state;
  })().finally(() => {
    store.inflight = null;
  });
  store.inflight = promise;
  return promise;
}

// ════════════════════════════════════════════════════════════════════════
// Result
// ════════════════════════════════════════════════════════════════════════

function safeUrl(url: string | null, fallback: string): string {
  return url && /^https?:\/\//i.test(url) ? url : fallback;
}

function buildResponse(opts: {
  enabled: boolean;
  state: PersistedState | null;
  repo: string;
  source: string | null;
  error?: UpdateCheckError | null;
}): VersionStatusResponse {
  const { enabled, state, repo, source } = opts;
  const repoUrl = `https://github.com/${repo}`;
  const current = parseSemver(APP_VERSION) ?? { major: 0, minor: 0, patch: 0, pre: [] };
  const currentIsPre = current.pre.length > 0;
  const error = opts.error ?? state?.error ?? null;

  const releases: ReleaseInfo[] = enabled && state
    ? state.releases
        .map((r) => ({ r, v: parseSemver(r.tag) }))
        .filter((x): x is { r: StoredRelease; v: SemVer } => x.v !== null)
        // Pre-releases ignored, unless the installed version is one.
        .filter((x) => currentIsPre || (!x.r.prerelease && x.v.pre.length === 0))
        .sort((a, b) => compareSemver(b.v, a.v))
        .map(({ r, v }) => {
          const name = r.name ? r.name.replace(SECURITY_MARKER, "").replace(/\s{2,}/g, " ").trim() || null : null;
          return {
            version: formatSemver(v),
            tag: r.tag,
            name: name && name !== r.tag ? name : null,
            notes: r.body,
            publishedAt: r.publishedAt,
            url: safeUrl(r.url, `${repoUrl}/releases/tag/${encodeURIComponent(r.tag)}`),
            prerelease: r.prerelease || v.pre.length > 0,
            security: SECURITY_MARKER.test(r.name ?? "") || SECURITY_MARKER.test(r.body),
            newer: compareSemver(v, current) > 0,
          };
        })
    : [];

  const newer = releases.filter((r) => r.newer);
  const updateAvailable = newer.length > 0;
  const securityUpdate = newer.some((r) => r.security);
  const status: UpdateStatus = !enabled
    ? "disabled"
    : error
      ? "error"
      : releases.length === 0
        ? "no_release"
        : securityUpdate
          ? "security_update"
          : updateAvailable
            ? "update_available"
            : "up_to_date";

  return {
    status,
    enabled,
    currentVersion: APP_VERSION,
    latest: releases[0] ?? null,
    history: releases.slice(1, 1 + HISTORY_SIZE),
    newerCount: newer.length,
    updateAvailable,
    securityUpdate,
    checkedAt: enabled ? state?.checkedAt ?? null : null,
    lastSuccessAt: enabled ? state?.successAt ?? null : null,
    error: enabled ? error : null,
    repo,
    repoUrl,
    sourceUrl: source,
    updateCommand: UPDATE_COMMAND,
  };
}

/**
 * Update state. Contacts GitHub only if the check is enabled AND (`force`
 * OR last attempt more than 24 h ago). Never throws for a network or
 * GitHub problem: it is returned in `error`.
 */
export async function getVersionStatus({ force = false }: { force?: boolean } = {}): Promise<VersionStatusResponse> {
  const repo = resolveRepo();
  const source = resolveSource(repo);

  if (!(await isUpdateCheckEnabled())) {
    return buildResponse({ enabled: false, state: null, repo, source });
  }
  if (!source) {
    return buildResponse({ enabled: true, state: null, repo, source, error: "invalid_repo" });
  }

  let state = await readState();
  if (force || isStale(state, source)) {
    state = await runCheck(source, state);
  }
  return buildResponse({ enabled: true, state, repo, source });
}
