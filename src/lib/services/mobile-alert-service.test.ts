import { expect, test } from "bun:test";
import { parseMobileTriggers } from "./mobile-alert-service";

test("reads the list of triggers", () => {
  expect(parseMobileTriggers("task_created, task_deleted,")).toEqual(["task_created", "task_deleted"]);
  expect(parseMobileTriggers("")).toEqual([]);
  expect(parseMobileTriggers(null)).toEqual([]);
});
