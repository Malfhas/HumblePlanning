/**
 * Helpers for the schedule's "rolling window" time pagination.
 *
 * The idea: instead of loading every task in the
 * `[startDate, endDate]` range chosen by the user (which can reach
 * ~30,000 tasks over 11 months), we load **per month** with
 * `useInfiniteQuery({ maxPages: 3 })`. On horizontal scroll, adjacent
 * pages are fetched on demand, and the oldest page is
 * evicted from the cache (FIFO).
 *
 * A "month anchor" is the ISO date of the first day of the month (`"2026-05-01"`).
 * It serves as the TanStack Query `pageParam`.
 */

/** Returns the month anchor (first day, ISO `yyyy-MM-dd`) for a date. */
export function getMonthAnchor(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  // We use UTC to avoid time zone flips at month boundaries
  // (e.g. Europe/Paris at 23:59 on May 31 → with a toLocaleDate,
  // we would stay on "2026-05" while UTC is already June 1st).
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Anchor of the next month. */
export function nextMonthAnchor(anchor: string): string {
  const [yearStr, monthStr] = anchor.split("-");
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Anchor of the previous month. */
export function prevMonthAnchor(anchor: string): string {
  const [yearStr, monthStr] = anchor.split("-");
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10) - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** `[startDate, endDate]` bounds of the month for the API request. */
export function getMonthRange(anchor: string): { startDate: string; endDate: string } {
  const [yearStr, monthStr] = anchor.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  // Last day of the month: take day 0 of the next month.
  const last = new Date(Date.UTC(year, month, 0));
  const endDate = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}-${String(last.getUTCDate()).padStart(2, "0")}`;
  return { startDate: anchor, endDate };
}

/** Compares two anchors: returns <0 if a < b, 0 if a == b, >0 if a > b. */
export function compareAnchors(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Builds the list of anchors between two dates (inclusive). */
export function listMonthAnchors(start: Date | string, end: Date | string): string[] {
  const startAnchor = getMonthAnchor(start);
  const endAnchor = getMonthAnchor(end);
  const result: string[] = [];
  let current = startAnchor;
  // Safety net: 60 iterations max (5 years). A schedule should never
  // exceed that in practice, and it avoids an infinite loop on invalid input.
  let safety = 60;
  while (compareAnchors(current, endAnchor) <= 0 && safety > 0) {
    result.push(current);
    current = nextMonthAnchor(current);
    safety -= 1;
  }
  return result;
}
