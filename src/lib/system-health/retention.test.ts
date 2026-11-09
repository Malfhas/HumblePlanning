import { describe, expect, it } from "bun:test";
import { ledgerPurgeThreshold } from "@/lib/ai-chat/quota";
import { nextDailyRun, parseRetentionDays, periodSince, purgeBeforeInstant, retentionCutoff } from "./retention";

const iso = (date: Date | null) => date?.toISOString() ?? null;

describe("parseRetentionDays", () => {
  it("reads a non-negative integer, 0 included", () => {
    expect(parseRetentionDays("90", 30)).toBe(90);
    expect(parseRetentionDays("0", 30)).toBe(0);
  });

  it("falls back to the default for a missing or invalid value", () => {
    expect(parseRetentionDays(null, 365)).toBe(365);
    expect(parseRetentionDays(undefined, 365)).toBe(365);
    expect(parseRetentionDays("", 30)).toBe(30);
    expect(parseRetentionDays("-5", 30)).toBe(30);
    expect(parseRetentionDays("12.5", 30)).toBe(30);
    expect(parseRetentionDays("abc", 30)).toBe(30);
  });
});

describe("retentionCutoff", () => {
  const now = new Date("2026-11-09T03:00:00Z");

  it("goes back the number of days", () => {
    expect(iso(retentionCutoff(now, 30))).toBe("2026-10-10T03:00:00.000Z");
    expect(iso(retentionCutoff(now, 365))).toBe("2025-11-09T03:00:00.000Z");
  });

  it("never purges with 0", () => {
    expect(retentionCutoff(now, 0)).toBeNull();
  });
});

describe("nextDailyRun", () => {
  it("runs today when the hour has not passed yet, in the instance time zone", () => {
    // 01:30 in Paris (winter, UTC+1) → 03:00 Paris the same day
    expect(iso(nextDailyRun(new Date("2026-11-09T00:30:00Z"), 3, "Europe/Paris"))).toBe("2026-11-09T02:00:00.000Z");
  });

  it("runs tomorrow once the hour has passed", () => {
    expect(iso(nextDailyRun(new Date("2026-11-09T02:00:00Z"), 3, "Europe/Paris"))).toBe("2026-11-10T02:00:00.000Z");
    expect(iso(nextDailyRun(new Date("2026-11-09T10:00:00Z"), 3, "Europe/Paris"))).toBe("2026-11-10T02:00:00.000Z");
  });

  it("follows summer time and other zones", () => {
    expect(iso(nextDailyRun(new Date("2026-07-01T12:00:00Z"), 3, "Europe/Paris"))).toBe("2026-07-02T01:00:00.000Z");
    expect(iso(nextDailyRun(new Date("2026-11-09T12:00:00Z"), 3, "America/New_York"))).toBe("2026-11-10T08:00:00.000Z");
  });
});

describe("purgeBeforeInstant", () => {
  it("is midnight of the chosen day in the instance time zone (the day itself is kept)", () => {
    expect(iso(purgeBeforeInstant("2026-11-09", "Europe/Paris"))).toBe("2026-11-08T23:00:00.000Z");
    expect(iso(purgeBeforeInstant("2026-07-01", "Europe/Paris"))).toBe("2026-06-30T22:00:00.000Z");
  });

  it("refuses anything that is not a calendar date", () => {
    expect(purgeBeforeInstant("2026-02-30", "Europe/Paris")).toBeNull();
    expect(purgeBeforeInstant("09/11/2026", "Europe/Paris")).toBeNull();
    expect(purgeBeforeInstant("", "Europe/Paris")).toBeNull();
  });
});

describe("periodSince", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  it("goes back N days, or nothing for « all »", () => {
    expect(iso(periodSince(now, 7))).toBe("2026-11-02T12:00:00.000Z");
    expect(periodSince(now, null)).toBeNull();
    expect(periodSince(now, 0)).toBeNull();
  });
});

describe("quota ledger and retention", () => {
  // Current quota period started on November 1st (Paris)
  const periodStart = new Date("2026-10-31T23:00:00Z");

  it("purges the ledger up to the retention limit when it is older than the period", () => {
    const cutoff = retentionCutoff(new Date("2026-11-09T02:00:00Z"), 30)!;
    expect(iso(ledgerPurgeThreshold(cutoff, periodStart))).toBe(iso(cutoff));
  });

  it("never cuts into the current period, even with a short retention or a recent manual date", () => {
    const cutoff = retentionCutoff(new Date("2026-11-09T02:00:00Z"), 7)!;
    expect(iso(ledgerPurgeThreshold(cutoff, periodStart))).toBe(iso(periodStart));
    expect(iso(ledgerPurgeThreshold(purgeBeforeInstant("2026-11-09", "Europe/Paris")!, periodStart))).toBe(iso(periodStart));
  });
});
