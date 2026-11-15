import { expect, test } from "bun:test";
import { updatePreferencesSchema } from "./profile";

test("profile preferences accept exactly three planning bar modes", () => {
  for (const mode of ["title", "project", "both"]) {
    expect(updatePreferencesSchema.safeParse({ taskLabelMode: mode }).success).toBe(true);
  }
  expect(updatePreferencesSchema.safeParse({ taskLabelMode: "wrong" }).success).toBe(false);
});

test("other preferences remain optional and compatible", () => {
  expect(updatePreferencesSchema.safeParse({}).success).toBe(true);
  expect(updatePreferencesSchema.safeParse({ defaultView: "users", columnView: "days" }).success).toBe(true);
});
