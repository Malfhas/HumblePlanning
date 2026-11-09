import { describe, expect, it } from "bun:test";
import { groupTasksByTitle, parseProjectGanttScale, parseProjectGanttSort, toWeekScale, weekOf, type ProjectGantt } from "./project-gantt";
import type { ExportTask } from "./export-service";

const task = (id: string, title: string | null, startDate: string, endDate: string | null = null): ExportTask => ({
  id, title, startDate, endDate, startTime: null, endTime: null, notes: null, link: null, isMilestone: false,
  files: null, project: { id: "p", name: "Project", color: null }, status: null, place: null, resource: null, users: [],
});

const labels = (rows: { label: string }[]) => rows.map(row => row.label);

describe("groupTasksByTitle", () => {
  it("groups the titles without regard to case or spaces, labelled after the earliest task", () => {
    const rows = groupTasksByTitle([
      task("a", "pose  des Câbles", "2026-11-10"),
      task("b", "Pose des câbles", "2026-11-03"),
      task("c", "Réception", "2026-11-12"),
    ], "[B1] Project", "date", "fr");
    expect(labels(rows)).toEqual(["Pose des câbles", "Réception"]);
    expect(rows[0].tasks.map(t => t.id)).toEqual(["b", "a"]);
  });

  it("puts the tasks without title on a row named after the project", () => {
    const rows = groupTasksByTitle([task("a", "Étude", "2026-11-05"), task("b", null, "2026-11-02"), task("c", "  ", "2026-11-20")], "[B1] Project", "date", "fr");
    expect(labels(rows)).toEqual(["[B1] Project", "Étude"]);
    expect(rows[0].tasks.map(t => t.id)).toEqual(["b", "c"]);
  });

  it("has a single row named after the project when no task has a title, or none at all", () => {
    expect(labels(groupTasksByTitle([task("a", null, "2026-11-02")], "Project", "date", "fr"))).toEqual(["Project"]);
    expect(groupTasksByTitle([], "Project", "alpha", "fr")).toEqual([{ id: "project", label: "Project", tasks: [] }]);
  });

  it("orders by first start (a staircase), or by title reading numbers as numbers", () => {
    const tasks = [task("a", "Lot 10", "2026-11-02"), task("b", "lot 2", "2026-11-09"), task("c", "Audit", "2026-11-05")];
    expect(labels(groupTasksByTitle(tasks, "P", "date", "fr"))).toEqual(["Lot 10", "Audit", "lot 2"]);
    expect(labels(groupTasksByTitle(tasks, "P", "alpha", "fr"))).toEqual(["Audit", "lot 2", "Lot 10"]);
  });

  it("reads an unknown sort as by date", () => {
    expect(parseProjectGanttSort("alpha")).toBe("alpha");
    expect(parseProjectGanttSort(null)).toBe("date");
    expect(parseProjectGanttSort("x")).toBe("date");
  });
});

describe("week scale", () => {
  it("gives the Monday of the ISO week", () => {
    expect(weekOf("2026-11-09")).toBe("2026-11-09");
    expect(weekOf("2026-11-15")).toBe("2026-11-09");
    expect(weekOf("2027-01-01")).toBe("2026-12-28");
  });

  it("puts each task over the weeks it touches, one column per week of the period", () => {
    const tasks = [task("a", "Lot", "2026-11-04", "2026-11-10"), task("b", "Lot", "2026-11-20")];
    const gantt: ProjectGantt = {
      projectLabel: "P",
      rows: [{ id: "title:lot", label: "Lot", tasks }],
      data: { rows: [], tasks, holidays: new Map([["2026-11-11", { label: "Armistice", color: "#f00" }]]), dateRange: { start: new Date("2026-11-02"), end: new Date("2026-11-22"), days: ["2026-11-02", "2026-11-03", "2026-11-09", "2026-11-16", "2026-11-22"] } },
    };
    const weekly = toWeekScale(gantt);
    expect(weekly.data.dateRange.days).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(weekly.rows[0].tasks.map(t => [t.startDate, t.endDate])).toEqual([["2026-11-02", "2026-11-09"], ["2026-11-16", "2026-11-16"]]);
    expect(weekly.data.holidays.size).toBe(0);
  });

  it("reads an unknown scale as days", () => {
    expect(parseProjectGanttScale("weeks")).toBe("weeks");
    expect(parseProjectGanttScale(undefined)).toBe("days");
  });
});
