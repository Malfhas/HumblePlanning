import { describe, expect, it } from "bun:test";
import { UPDATE_COMMAND, updateCommandFor } from "./update-check-service";

describe("update command", () => {
  it("names the instance set by install.sh", () => {
    expect(updateCommandFor("dupont")).toBe(`${UPDATE_COMMAND} dupont`);
    expect(updateCommandFor("planning-2")).toBe(`${UPDATE_COMMAND} planning-2`);
  });

  it("falls back to the plain command without a valid instance name", () => {
    for (const bad of [undefined, "", " ", "a", "-x", "x-", "Dupont", "a b", "a;rm", "x".repeat(33)]) {
      expect(updateCommandFor(bad)).toBe(UPDATE_COMMAND);
    }
  });
});
