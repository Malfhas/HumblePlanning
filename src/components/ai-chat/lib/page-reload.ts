/**
 * The user reloaded the page (F5, reload button): the assistant then starts on
 * its home instead of the conversation it showed. A link that opens a
 * conversation, a new visit or the history (back / forward) keep it.
 *
 * The navigation entry describes how the document was loaded, so it still says
 * "reload" after client-side navigations: each `scope` reads it once, and
 * `pathname` limits it to the page that was reloaded.
 */
const taken = new Set<string>();

export function takePageReload(scope: string, pathname?: string): boolean {
  if (typeof window === "undefined" || taken.has(scope)) return false;
  taken.add(scope);
  const entry = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (entry?.type !== "reload") return false;
  if (!pathname) return true;
  try {
    return new URL(entry.name).pathname === pathname;
  } catch {
    return false;
  }
}
