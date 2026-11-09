import { describe, expect, test } from "bun:test";
import { format } from "date-fns";
import {
  anchorFor,
  busyPeopleOn,
  CALENDAR_EVERYONE,
  calendarPersonRow,
  calendarTasks,
  calendarWindow,
  dayLoad,
  eachDay,
  layoutBars,
  parseCalendarSpan,
  parseDailyHours,
  plannedHoursOn,
  rangeLength,
  shiftCalendarAnchor,
  hiddenBarsPerDay,
  stackOf,
} from "./calendar-view";

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const day = (s: string) => new Date(`${s}T00:00:00`);

describe("calendarWindow", () => {
  test("days from the anchor", () => {
    const w = calendarWindow(day("2026-11-09"), 7);
    expect([iso(w.start), iso(w.end)]).toEqual(["2026-11-09", "2026-11-15"]);
    expect(iso(calendarWindow(day("2026-11-09"), 1).end)).toBe("2026-11-09");
  });

  test("month: whole weeks from Monday to Sunday", () => {
    // November 2026 starts on a Sunday and ends on a Monday: 6 weeks
    const nov = calendarWindow(day("2026-11-18"), "month");
    expect([iso(nov.start), iso(nov.end)]).toEqual(["2026-10-26", "2026-12-06"]);
    expect(eachDay(nov.start, nov.end)).toHaveLength(42);
    // February 2027 starts on a Monday and ends on a Sunday: exactly 4 weeks
    const feb = calendarWindow(day("2027-02-01"), "month");
    expect([iso(feb.start), iso(feb.end)]).toEqual(["2027-02-01", "2027-02-28"]);
    expect(eachDay(feb.start, feb.end)).toHaveLength(28);
  });
});

describe("navigation", () => {
  test("shift by the number of days, or by month", () => {
    expect(iso(shiftCalendarAnchor(day("2026-11-09"), 5, 1))).toBe("2026-11-14");
    expect(iso(shiftCalendarAnchor(day("2026-11-09"), 3, -1))).toBe("2026-11-06");
    expect(iso(shiftCalendarAnchor(day("2027-01-31"), "month", 1))).toBe("2027-02-01");
    expect(iso(shiftCalendarAnchor(day("2026-11-09"), "month", -1))).toBe("2026-10-01");
  });

  test("anchor of a picked day and range length", () => {
    expect(iso(anchorFor(day("2026-11-18"), "month"))).toBe("2026-11-01");
    expect(iso(anchorFor(day("2026-11-18"), 3))).toBe("2026-11-18");
    expect(rangeLength(day("2026-11-09"), day("2027-01-08"))).toBe(61);
    expect(rangeLength(day("2026-11-09"), day("2026-11-01"))).toBe(1);
  });

  test("stored span", () => {
    expect(parseCalendarSpan("month")).toBe("month");
    expect(parseCalendarSpan("7")).toBe(7);
    expect(parseCalendarSpan("30")).toBeNull();
    expect(parseCalendarSpan(null)).toBeNull();
  });
});

describe("layoutBars", () => {
  const week = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
  const t = (id: string, startDate: string, endDate?: string) => ({ id, startDate, endDate: endDate ?? null });

  test("clips to the visible days and stacks overlapping tasks", () => {
    const { bars, laneCount } = layoutBars(week, [
      t("before", "2026-11-05", "2026-11-10"),
      t("long", "2026-11-11", "2026-11-20"),
      t("short", "2026-11-12"),
      t("after", "2026-11-16"),
    ]);
    const byId = Object.fromEntries(bars.map((b) => [b.task.id, b]));
    expect(Object.keys(byId).sort()).toEqual(["before", "long", "short"]);
    expect(byId.before).toMatchObject({ start: 0, length: 2, lane: 0, clippedStart: true, clippedEnd: false });
    // "long" reuses the line freed by "before"
    expect(byId.long).toMatchObject({ start: 2, length: 5, lane: 0, clippedEnd: true });
    expect(byId.short).toMatchObject({ start: 3, length: 1, lane: 1 });
    expect(laneCount).toBe(2);
  });

  test("longer tasks first when they start the same day", () => {
    const { bars } = layoutBars(week, [t("one", "2026-11-09"), t("three", "2026-11-09", "2026-11-11")]);
    expect(bars.map((b) => [b.task.id, b.lane])).toEqual([["three", 0], ["one", 1]]);
  });
});

describe("daily load", () => {
  const task = (over: Partial<Record<string, string | null>>) => ({
    startDate: "2026-11-09", endDate: null, startTime: null, endTime: null,
    duration: null, breakDuration: null, realDuration: null, ...over,
  });

  test("hours of the day, like the exports", () => {
    const tasks = [
      task({ startTime: "08:00", endTime: "10:00" }),
      task({ startTime: "14:00", endTime: "17:00", breakDuration: "00:30" }),
      // Several days with times: the daily hours count once per day
      task({ startDate: "2026-11-08", endDate: "2026-11-10", startTime: "08:00", endTime: "12:00" }),
      // Another day: ignored
      task({ startDate: "2026-11-10", startTime: "08:00", endTime: "17:00" }),
    ];
    expect(plannedHoursOn(tasks, "2026-11-09", 7)).toBe(8.5);
    // Without times: a full working day
    expect(plannedHoursOn([task({})], "2026-11-09", 7.5)).toBe(7.5);
  });

  test("levels", () => {
    expect(dayLoad(0, 7)).toBe("empty");
    expect(dayLoad(3, 7)).toBe("partial");
    expect(dayLoad(7, 7)).toBe("full");
    expect(dayLoad(8.5, 7)).toBe("over");
    expect(parseDailyHours("07:30")).toBe(7.5);
    expect(parseDailyHours(undefined)).toBe(7.5);
    expect(parseDailyHours("08:00")).toBe(8);
  });
});

describe("calendarTasks", () => {
  const task = (id: string, startDate: string, endDate: string | null, users: string[]) => ({
    id, startDate, endDate, users: users.map((u) => ({ id: u })),
  });
  const tasks = [
    task("a", "2026-11-09", null, ["ann"]),
    task("b", "2026-11-08", "2026-11-12", ["ann", "bob"]),
    task("c", "2026-11-10", null, ["carl"]),
    task("d", "2026-11-20", null, ["ann"]),
    task("b", "2026-11-08", "2026-11-12", ["ann", "bob"]),
    task("e", "2026-11-10", null, []),
  ];

  test("one person: their tasks over the days", () => {
    expect(calendarTasks(tasks, new Set(["bob"]), "2026-11-09", "2026-11-15").map((t) => t.id)).toEqual(["b"]);
  });

  test("everyone: a shared task comes once, tasks of no one shown are left out", () => {
    const ids = calendarTasks(tasks, new Set(["ann", "bob"]), "2026-11-09", "2026-11-15").map((t) => t.id);
    expect(ids).toEqual(["a", "b"]);
  });

  test("tasks crossing the edges of the window are kept", () => {
    expect(calendarTasks(tasks, new Set(["ann"]), "2026-11-12", "2026-11-20").map((t) => t.id)).toEqual(["b", "d"]);
  });
});

describe("calendarPersonRow", () => {
  test("everyone has no row", () => {
    expect(calendarPersonRow(CALENDAR_EVERYONE)).toBeUndefined();
    expect(calendarPersonRow("")).toBeUndefined();
    expect(calendarPersonRow(null)).toBeUndefined();
    expect(calendarPersonRow("u1")).toBe("u1");
  });
});

describe("stackOf", () => {
  test("all items when they fit", () => {
    expect(stackOf([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
  });

  test("one place left for +N", () => {
    expect(stackOf([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2], more: 3 });
  });
});

describe("hiddenBarsPerDay", () => {
  test("counts the bars beyond the visible lanes on each of their days", () => {
    const bars = [
      { start: 0, length: 2, lane: 0 },
      { start: 1, length: 3, lane: 1 },
      { start: 2, length: 5, lane: 2 },
    ];
    expect(hiddenBarsPerDay(bars, 5, 1)).toEqual([0, 1, 2, 2, 1]);
    expect(hiddenBarsPerDay(bars, 5, 3)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("busyPeopleOn", () => {
  const task = (id: string, startDate: string, endDate: string | null, users: string[]) => ({
    id, startDate, endDate, users: users.map((u) => ({ id: u })),
  });
  const shown = new Set(["ann", "bob", "carl", "dora"]);

  test("each person once, a shared task counting for each of them", () => {
    const tasks = [
      task("a", "2026-11-10", null, ["ann", "bob"]),
      task("b", "2026-11-10", null, ["ann"]),
      task("c", "2026-11-10", null, ["eve"]),
    ];
    expect(busyPeopleOn(tasks, "2026-11-10", shown)).toBe(2);
  });

  test("a task over several days makes its people busy on each of them", () => {
    const tasks = [task("a", "2026-11-09", "2026-11-12", ["carl"])];
    expect(busyPeopleOn(tasks, "2026-11-09", shown)).toBe(1);
    expect(busyPeopleOn(tasks, "2026-11-11", shown)).toBe(1);
    expect(busyPeopleOn(tasks, "2026-11-13", shown)).toBe(0);
  });

  test("public holidays are not tasks", () => {
    const tasks = [
      { id: "holiday:ann:2026-11-11", startDate: "2026-11-11", endDate: "2026-11-11", users: [{ id: "ann" }] },
      task("a", "2026-11-11", null, ["dora"]),
    ];
    expect(busyPeopleOn(tasks, "2026-11-11", shown)).toBe(1);
  });

  test("nobody busy: 0", () => {
    expect(busyPeopleOn([], "2026-11-10", shown)).toBe(0);
    expect(busyPeopleOn([task("a", "2026-11-10", null, [])], "2026-11-10", shown)).toBe(0);
  });
});
