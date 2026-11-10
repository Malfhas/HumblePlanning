import { describe, expect, it } from "bun:test";
import { nextBackupRun, nextWeeklyRun, parseClockTime } from "./schedule-time";

const at = (iso: string) => new Date(iso);
const TWO = { hour: 2, minute: 0 };
const EIGHT = { hour: 8, minute: 0 };

describe("parseClockTime", () => {
  it("reads HH:MM, else the fallback", () => {
    expect(parseClockTime("02:00", EIGHT)).toEqual(TWO);
    expect(parseClockTime("7:05", EIGHT)).toEqual({ hour: 7, minute: 5 });
    expect(parseClockTime("25:00", EIGHT)).toEqual(EIGHT);
    expect(parseClockTime(null, EIGHT)).toEqual(EIGHT);
  });
});

describe("nextBackupRun: the time of the instance, not of UTC", () => {
  it("daily: 02:00 in Paris is 01:00 UTC in winter", () => {
    // 10/11/2026 17:21 in Paris (16:21 UTC)
    expect(nextBackupRun(at("2026-11-10T16:21:00Z"), "daily", TWO, "Europe/Paris").toISOString()).toBe("2026-11-11T01:00:00.000Z");
    // Still to come today
    expect(nextBackupRun(at("2026-11-10T00:30:00Z"), "daily", TWO, "Europe/Paris").toISOString()).toBe("2026-11-10T01:00:00.000Z");
  });

  it("daily, across the changes of time: the wall-clock time stays", () => {
    // Spring: the night of 28 to 29 March 2026, 08:00 is then 06:00 UTC
    expect(nextBackupRun(at("2026-03-28T12:00:00Z"), "daily", EIGHT, "Europe/Paris").toISOString()).toBe("2026-03-29T06:00:00.000Z");
    // Autumn: the night of 24 to 25 October 2026, 08:00 is then 07:00 UTC
    expect(nextBackupRun(at("2026-10-24T12:00:00Z"), "daily", EIGHT, "Europe/Paris").toISOString()).toBe("2026-10-25T07:00:00.000Z");
  });

  it("weekly, every 6 and 12 hours", () => {
    expect(nextBackupRun(at("2026-11-10T16:21:00Z"), "weekly", TWO, "Europe/Paris").toISOString()).toBe("2026-11-17T01:00:00.000Z");
    // 02:00, 08:00, 14:00, 20:00 in Paris: after 17:21, 20:00
    expect(nextBackupRun(at("2026-11-10T16:21:00Z"), "6h", TWO, "Europe/Paris").toISOString()).toBe("2026-11-10T19:00:00.000Z");
    // Before 02:00: 20:00 of the evening before is past, 02:00 comes first
    expect(nextBackupRun(at("2026-11-10T00:30:00Z"), "12h", TWO, "Europe/Paris").toISOString()).toBe("2026-11-10T01:00:00.000Z");
  });

  it("follows the time zone of the instance", () => {
    expect(nextBackupRun(at("2026-11-10T16:21:00Z"), "daily", TWO, "America/Montreal").toISOString()).toBe("2026-11-11T07:00:00.000Z");
  });
});

describe("nextWeeklyRun", () => {
  it("next Monday at 08:00 in Paris", () => {
    // Tuesday 10 November 2026 → Monday 16
    expect(nextWeeklyRun(at("2026-11-10T16:21:00Z"), 1, EIGHT, "Europe/Paris").toISOString()).toBe("2026-11-16T07:00:00.000Z");
    // Monday 16 at 07:59 Paris: today
    expect(nextWeeklyRun(at("2026-11-16T06:59:00Z"), 1, EIGHT, "Europe/Paris").toISOString()).toBe("2026-11-16T07:00:00.000Z");
    // Monday 16 at 08:01 Paris: the next one
    expect(nextWeeklyRun(at("2026-11-16T07:01:00Z"), 1, EIGHT, "Europe/Paris").toISOString()).toBe("2026-11-23T07:00:00.000Z");
  });

  it("Sunday is 7, and the local day counts, not the UTC one", () => {
    // Saturday 14 November 23:30 UTC is already Sunday 15 at 00:30 in Paris
    expect(nextWeeklyRun(at("2026-11-14T23:30:00Z"), 7, EIGHT, "Europe/Paris").toISOString()).toBe("2026-11-15T07:00:00.000Z");
  });
});
