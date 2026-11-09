import { describe, expect, it } from "bun:test";
import { fillDailySeries, localDay } from "./history-series";

describe("fillDailySeries", () => {
  it("fills the days without reply with zero", () => {
    expect(fillDailySeries([{ day: "2026-11-02", costUsd: 0.5 }], "2026-11-01", "2026-11-03")).toEqual([
      { day: "2026-11-01", costUsd: 0 },
      { day: "2026-11-02", costUsd: 0.5 },
      { day: "2026-11-03", costUsd: 0 },
    ]);
  });

  it("crosses months and years", () => {
    const series = fillDailySeries([], "2026-12-30", "2027-01-02");
    expect(series.map((point) => point.day)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("is empty when the range is reversed", () => {
    expect(fillDailySeries([], "2026-11-03", "2026-11-01")).toEqual([]);
  });
});

describe("localDay", () => {
  it("reads the day in the instance time zone", () => {
    // 23:30 UTC on November 8 is already November 9 in Paris
    expect(localDay(new Date("2026-11-08T23:30:00Z"), "Europe/Paris")).toBe("2026-11-09");
    expect(localDay(new Date("2026-11-08T23:30:00Z"), "UTC")).toBe("2026-11-08");
  });
});
