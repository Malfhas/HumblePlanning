import { getConfigValue } from "./services/config-service";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * Single store for the whole process: Next.js instantiates this module once
 * per layer (server pages, API routes…), and an invalidation done by a
 * route (settings, roles) must also apply to the pages, which otherwise kept
 * the old value until expiry.
 */
const globalForCache = globalThis as unknown as { __appCacheStore?: Map<string, CacheEntry<unknown>> };
const store: Map<string, CacheEntry<unknown>> = (globalForCache.__appCacheStore ??= new Map());
let _enabled = true;
let _defaultTtlMs = 5 * 60 * 1000; // 5 min
let _initialized = false;

/**
 * Initialize cache settings from app_config.
 * Called lazily on first cache access.
 */
async function ensureInitialized() {
  if (_initialized) return;
  _initialized = true;
  try {
    const [enabled, ttl] = await Promise.all([
      getConfigValue("CACHE_ENABLED"),
      getConfigValue("CACHE_TTL"),
    ]);
    _enabled = enabled !== "false";
    const ttlSec = parseInt(ttl || "300", 10);
    if (ttlSec > 0) _defaultTtlMs = ttlSec * 1000;
  } catch {
    // Fallback to defaults
  }
}

/**
 * Get a value from cache or fetch it.
 * If cache is disabled, always fetches.
 *
 * NOTE: expired entries encountered are deleted (lazy purge)
 * to avoid a memory leak when short-TTL keys pile up.
 */
export async function cached<T>(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T> {
  await ensureInitialized();

  if (_enabled) {
    const entry = store.get(key);
    if (entry) {
      if (entry.expiresAt > Date.now()) {
        return entry.data as T;
      }
      store.delete(key);
    }
  }

  const data = await fetcher();

  if (_enabled) {
    store.set(key, { data, expiresAt: Date.now() + (ttlMs ?? _defaultTtlMs) });
  }

  return data;
}

/**
 * Invalidate a specific cache key.
 */
export function invalidateCache(key: string) {
  store.delete(key);
}

/**
 * Invalidate all cache keys matching a prefix.
 * e.g. invalidateCachePrefix("permissions:") clears all user permissions.
 */
export function invalidateCachePrefix(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Clear the entire cache.
 */
export function clearCache() {
  store.clear();
}

/**
 * Reload cache settings from DB (call after admin changes cache config).
 */
export function reloadCacheSettings() {
  _initialized = false;
}

/**
 * Get cache stats for monitoring.
 * Uses the iteration to purge expired entries (lazy cleanup).
 */
export function getCacheStats() {
  let active = 0;
  let expired = 0;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt > now) {
      active++;
    } else {
      expired++;
      store.delete(key);
    }
  }
  return { enabled: _enabled, ttlSeconds: _defaultTtlMs / 1000, entries: active, expired };
}
