/**
 * Cursor returned by the app's incremental reads (`serverTime` of
 * /api/mobile/tasks/sync and /api/mobile/alerts): a little before the read
 * started. A row committed while the read ran can carry an earlier date than
 * the read's start (its transaction began before); without the margin, the next
 * read would skip it for good. The app merges tasks and alerts by id, so the
 * rows of the margin coming back once more are harmless.
 */
export const SYNC_CURSOR_MARGIN_MS = 5_000;

export function syncCursor(readStartedAt: Date): Date {
  return new Date(readStartedAt.getTime() - SYNC_CURSOR_MARGIN_MS);
}
