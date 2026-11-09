import { describe, expect, test } from "bun:test";
import { DELETE_CONFIRM_MS, deleteOpensDialog, isDeleteKey, isRecurringTask, isSharedTask, pressDelete } from "./delete-shortcut";

describe("pressDelete", () => {
  test("nothing without a task under the cursor", () => {
    expect(pressDelete(null, null, 1000)).toEqual({ action: "none" });
    expect(pressDelete({ key: "a", at: 900 }, null, 1000)).toEqual({ action: "none" });
  });

  test("a first press arms the task", () => {
    expect(pressDelete(null, "a", 1000)).toEqual({ action: "arm", armed: { key: "a", at: 1000 } });
  });

  test("a second press on the same task within the delay confirms", () => {
    expect(pressDelete({ key: "a", at: 1000 }, "a", 1000 + DELETE_CONFIRM_MS)).toEqual({ action: "confirm", key: "a" });
  });

  test("past the delay, the press arms again", () => {
    expect(pressDelete({ key: "a", at: 1000 }, "a", 1001 + DELETE_CONFIRM_MS)).toEqual({ action: "arm", armed: { key: "a", at: 1001 + DELETE_CONFIRM_MS } });
  });

  test("another task arms that one instead of deleting the first", () => {
    expect(pressDelete({ key: "a", at: 1000 }, "b", 1200)).toEqual({ action: "arm", armed: { key: "b", at: 1200 } });
  });

  test("when a dialog follows, the first press goes straight to it", () => {
    expect(pressDelete(null, "a", 1000, { opensDialog: true })).toEqual({ action: "confirm", key: "a" });
    expect(pressDelete({ key: "b", at: 900 }, "a", 1000, { opensDialog: true })).toEqual({ action: "confirm", key: "a" });
  });
});

describe("deleteOpensDialog", () => {
  test("the menu's rule: a shared or recurring task opens a dialog", () => {
    expect(deleteOpensDialog(isSharedTask({ users: [1, 2] }), isRecurringTask({ parentId: null }))).toBe(true);
    expect(deleteOpensDialog(isSharedTask({ users: [1] }), isRecurringTask({ parentId: "p" }))).toBe(true);
    expect(deleteOpensDialog(isSharedTask({ users: [1] }), isRecurringTask({ parentId: null }))).toBe(false);
    expect(deleteOpensDialog(isSharedTask(null), isRecurringTask(undefined))).toBe(false);
  });
});

describe("isDeleteKey", () => {
  test("Delete everywhere, Backspace on a Mac only", () => {
    expect(isDeleteKey({ key: "Delete" }, false)).toBe(true);
    expect(isDeleteKey({ key: "Delete" }, true)).toBe(true);
    expect(isDeleteKey({ key: "Backspace" }, true)).toBe(true);
    expect(isDeleteKey({ key: "Backspace" }, false)).toBe(false);
    expect(isDeleteKey({ key: "d" }, false)).toBe(false);
  });

  test("a held key (repeat) or a combination never counts", () => {
    expect(isDeleteKey({ key: "Delete", repeat: true }, false)).toBe(false);
    expect(isDeleteKey({ key: "Delete", ctrlKey: true }, false)).toBe(false);
    expect(isDeleteKey({ key: "Backspace", metaKey: true }, true)).toBe(false);
    expect(isDeleteKey({ key: "Delete", shiftKey: true }, false)).toBe(false);
  });
});
