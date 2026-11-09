import { describe, expect, it } from "bun:test";
import { cooldownSecondsLeft, REGENERATE_COOLDOWN_MS } from "./pairing-cooldown";

describe("cooldownSecondsLeft", () => {
  it("allows a code at once when none was made", () => {
    expect(cooldownSecondsLeft(null, 1_000_000)).toBe(0);
  });

  it("counts the 30 seconds after a code, rounded up", () => {
    const at = 1_000_000;
    expect(cooldownSecondsLeft(at, at)).toBe(30);
    expect(cooldownSecondsLeft(at, at + 400)).toBe(30);
    expect(cooldownSecondsLeft(at, at + 29_001)).toBe(1);
    expect(cooldownSecondsLeft(at, at + REGENERATE_COOLDOWN_MS)).toBe(0);
    expect(cooldownSecondsLeft(at, at + 60_000)).toBe(0);
  });
});
