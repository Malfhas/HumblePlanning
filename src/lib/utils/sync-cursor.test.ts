import { expect, test } from "bun:test";
import { SYNC_CURSOR_MARGIN_MS, syncCursor } from "./sync-cursor";

test("the cursor is a few seconds before the start of the read", () => {
  const start = new Date("2026-11-08T10:00:00.000Z");
  expect(syncCursor(start).toISOString()).toBe("2026-11-08T09:59:55.000Z");
  expect(start.getTime() - syncCursor(start).getTime()).toBe(SYNC_CURSOR_MARGIN_MS);
});
