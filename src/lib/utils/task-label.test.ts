import { expect, test } from "bun:test";
import { getTaskLabel } from "./task-label";
import { isTaskLabelMode } from "@/lib/types/task-label";

const task = { title: "Replace lighting at plant", project: { name: "Daily operations" }, users: [{ name: "Sam" }] };

test("employee rows show legacy project by default", () => {
  expect(getTaskLabel(task, "users", "Untitled")).toBe("Daily operations");
});

test("employee rows support title, project and both", () => {
  expect(getTaskLabel(task, "users", "Untitled", "title")).toBe("Replace lighting at plant");
  expect(getTaskLabel(task, "users", "Untitled", "project")).toBe("Daily operations");
  expect(getTaskLabel(task, "users", "Untitled", "both")).toBe("Replace lighting at plant · Daily operations");
});

test("an empty task title gracefully falls back to project", () => {
  expect(getTaskLabel({ title: "  ", project: { name: "Daily operations" } }, "users", "Untitled", "title")).toBe("Daily operations");
  expect(getTaskLabel({ title: null, project: null }, "users", "Untitled", "both")).toBe("Untitled");
});

test("other planning views keep their existing text", () => {
  for (const mode of ["title", "project", "both"] as const) {
    expect(getTaskLabel(task, "projects", "Untitled", mode)).toBe("Sam");
    expect(getTaskLabel(task, "vehicles", "Untitled", mode)).toBe("Replace lighting at plant");
  }
});

test("account preference accepts only recognized values", () => {
  for (const mode of ["title", "project", "both"]) expect(isTaskLabelMode(mode)).toBe(true);
  for (const mode of [null, "unexpected", "", 1]) expect(isTaskLabelMode(mode)).toBe(false);
});
