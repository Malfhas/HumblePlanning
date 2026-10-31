import { describe, expect, it } from "bun:test";
import { isValidStorageKey, safeUploadPath } from "./upload-paths";

describe("upload paths", () => {
  it("accepts only content-hash storage keys", () => {
    expect(isValidStorageKey(`${"a".repeat(64)}.pdf`)).toBe(true);
    for (const bad of ["../../.env", `${"a".repeat(64)}.pdf/../x`, "x.pdf", `${"A".repeat(64)}.pdf`, null, 42]) {
      expect(isValidStorageKey(bad)).toBe(false);
    }
  });

  it("keeps paths inside uploads/<area>", () => {
    expect(safeUploadPath("files", `${"a".repeat(64)}.pdf`)).toContain("/uploads/files/");
    expect(safeUploadPath("tasks", "1234", "report.pdf")).toContain("/uploads/tasks/1234/report.pdf");
    // An absolute part is joined as a relative one: it stays inside the area
    expect(safeUploadPath("files", "/etc/passwd")).toContain("/uploads/files/etc/passwd");
    for (const parts of [["../../.env"], ["..", "x"], ["a", "../../.."], [""], ["a\0b"]]) {
      expect(safeUploadPath("files", ...parts)).toBeNull();
    }
  });
});
