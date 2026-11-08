import { expect, test } from "bun:test";
import { compareVersions } from "./app-version";

test("orders versions numerically", () => {
  expect(compareVersions("1.10.0", "1.9.3")).toBeGreaterThan(0);
  expect(compareVersions("1.9.3", "1.10.0")).toBeLessThan(0);
  expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
});

test("ignores suffixes and missing segments", () => {
  expect(compareVersions("1.2.0-debug", "1.2.0")).toBe(0);
  expect(compareVersions("1.2", "1.2.0")).toBe(0);
  expect(compareVersions(" 1.2.1 ", "1.2")).toBeGreaterThan(0);
});

test("a malformed version counts as the oldest", () => {
  expect(compareVersions("abc", "0.0.1")).toBeLessThan(0);
});
