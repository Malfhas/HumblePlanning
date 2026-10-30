/**
 * Global avatar cache for the planning canvas.
 *
 * Canvas rendering is synchronous while `Image.onload` is async.
 * Loaded images are stored in a Map and an `onLoad` callback is called
 * on each arrival, so the renderer can trigger a new frame with the
 * image available.
 *
 * - **Cache hit**: returns the image (HTMLImageElement) immediately.
 * - **Cache miss + already loading**: returns null, the callback
 *   will be invoked when the image arrives (already registered).
 * - **404 error / corruption**: the URL is marked as "failed" so it is
 *   not retried in a loop, and null is returned forever (initials fallback).
 *
 * Client-side architecture (no SSR). Cleanly no-ops when `window` is
 * missing — the canvas is never rendered server-side anyway.
 */
const cache = new Map<string, HTMLImageElement>();
const failed = new Set<string>();
const loading = new Map<string, Set<() => void>>();

/**
 * Gets an image from the cache, or loads it if not yet available.
 *
 * @param url Avatar URL (e.g. `/api/avatars/abc123.png`).
 * @param onLoad Callback invoked when the image finishes loading. Used
 *   by the canvas to trigger a re-render. Several renderers
 *   can subscribe to the same URL — all are notified once.
 * @returns The image if already cached, `null` otherwise (the callback
 *   will be called later).
 */
export function getCachedAvatar(
  url: string,
  onLoad: () => void,
): HTMLImageElement | null {
  if (typeof window === "undefined") return null;
  if (failed.has(url)) return null;

  const cached = cache.get(url);
  if (cached) return cached;

  // Already loading: just register the callback.
  const subscribers = loading.get(url);
  if (subscribers) {
    subscribers.add(onLoad);
    return null;
  }

  // First call for this URL: start loading.
  const newSubscribers = new Set<() => void>();
  newSubscribers.add(onLoad);
  loading.set(url, newSubscribers);

  const img = new Image();
  img.onload = () => {
    cache.set(url, img);
    const subs = loading.get(url);
    loading.delete(url);
    if (subs) for (const cb of subs) cb();
  };
  img.onerror = () => {
    failed.add(url);
    loading.delete(url);
  };
  img.src = url;
  return null;
}

/**
 * Builds an avatar URL from the value stored in the DB.
 * The `user.image` field looks like `avatars/<hash>.<ext>` or just
 * `<hash>.<ext>`. The served route is `/api/avatars/<filename>`.
 */
export function buildAvatarUrl(image: string | null | undefined): string | null {
  if (!image) return null;
  const filename = image.replace(/^avatars\//, "");
  return `/api/avatars/${filename}`;
}
