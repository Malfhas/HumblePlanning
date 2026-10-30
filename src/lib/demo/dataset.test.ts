import { describe, expect, it } from "bun:test";
import { buildDemoDataset } from "./dataset";
import { addDays, dayOfWeek, frenchHolidays, wallClock } from "./clock";
import { DEMO_ROLE_ID, DEMO_USER_ID } from "./index";

const TODAY = "2026-10-30";
const data = buildDemoDataset(TODAY, { login: "demo" });

describe("demo calendar", () => {
  it("computes the movable French holidays", () => {
    const of = (y: number) => Object.fromEntries(frenchHolidays(y).map((h) => [h.label, h.date]));
    expect(of(2026)["Lundi de Pâques"]).toBe("2026-04-06");
    expect(of(2026).Ascension).toBe("2026-05-14");
    expect(of(2027)["Lundi de Pentecôte"]).toBe("2027-05-17");
    expect(of(2025)["Lundi de Pâques"]).toBe("2025-04-21");
  });

  it("reads the wall clock of a time zone", () => {
    expect(wallClock(new Date("2026-10-30T23:30:00Z"), "Europe/Paris")).toEqual({ day: "2026-10-31", time: "00:30" });
    expect(wallClock(new Date("2026-07-01T01:59:00Z"), "Europe/Paris")).toEqual({ day: "2026-07-01", time: "03:59" });
  });
});

describe("demo dataset", () => {
  it("is deterministic for a given day", () => {
    expect(JSON.stringify(buildDemoDataset(TODAY, { login: "demo" }))).toBe(JSON.stringify(data));
  });

  it("keeps the same people and projects from one day to the next", () => {
    const tomorrow = buildDemoDataset(addDays(TODAY, 1), { login: "demo" });
    expect(tomorrow.users.map((u) => u.id)).toEqual(data.users.map((u) => u.id));
    expect(tomorrow.projects.map((p) => p.name)).toEqual(data.projects.map((p) => p.name));
  });

  it("has the expected size", () => {
    expect(data.businessUnits).toHaveLength(3);
    expect(data.teams).toHaveLength(8);
    expect(data.users.length).toBeGreaterThanOrEqual(55);
    expect(data.users.length).toBeLessThanOrEqual(65);
    expect(data.projects).toHaveLength(40);
    expect(data.tasks.length).toBeGreaterThan(1000);
    expect(data.tasks.length).toBeLessThan(2500);
  });

  it("schedules working days around today only", () => {
    const holidays = new Set(data.holidays.map((h) => h.date));
    for (const t of data.tasks) {
      expect(t.startDate >= addDays(TODAY, -35)).toBe(true);
      expect(t.endDate! <= addDays(TODAY, 63)).toBe(true);
      expect([0, 6]).not.toContain(dayOfWeek(t.startDate));
      expect(holidays.has(t.startDate)).toBe(false);
    }
    expect(data.tasks.some((t) => t.startDate < TODAY)).toBe(true);
    expect(data.tasks.some((t) => t.startDate > TODAY)).toBe(true);
  });

  it("never double-books a person on the same half-day", () => {
    const taskById = new Map(data.tasks.map((t) => [t.id, t]));
    const seen = new Set<string>();
    for (const tu of data.taskUsers) {
      const t = taskById.get(tu.taskId)!;
      const halves = t.startTime === "08:00" ? ["am"] : t.startTime === "13:30" ? ["pm"] : ["am", "pm"];
      for (let d = t.startDate; d <= t.endDate!; d = addDays(d, 1)) {
        for (const h of halves) {
          const key = `${tu.userId}|${d}|${h}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it("references only rows of the dataset", () => {
    const ids = (rows: { id?: string }[]) => new Set(rows.map((r) => r.id));
    const users = ids(data.users), projects = ids(data.projects), tasks = ids(data.tasks), statuses = ids(data.statuses);
    for (const t of data.tasks) {
      expect(projects.has(t.projectId)).toBe(true);
      expect(statuses.has(t.statusId)).toBe(true);
      expect(users.has(t.creatorId!)).toBe(true);
    }
    for (const tu of data.taskUsers) expect(users.has(tu.userId) && tasks.has(tu.taskId)).toBe(true);
    for (const p of data.projects) expect(users.has(p.ownerId)).toBe(true);
    expect(new Set(data.users.map((u) => u.username)).size).toBe(data.users.length);
  });

  it("includes the demo account with the Démo role and the given login", () => {
    const account = data.users.find((u) => u.id === DEMO_USER_ID)!;
    expect(account.roleId).toBe(DEMO_ROLE_ID);
    expect(account.username).toBe("demo");
    expect(data.taskUsers.some((tu) => tu.userId === DEMO_USER_ID)).toBe(true);
    // A generated login equal to DEMO_LOGIN is renamed
    const clash = data.users.find((u) => u.id !== DEMO_USER_ID)!.username!;
    const other = buildDemoDataset(TODAY, { login: clash });
    expect(new Set(other.users.map((u) => u.username)).size).toBe(other.users.length);
  });

  it("uses colours that fit the 7-character columns", () => {
    for (const row of [...data.users, ...data.projects, ...data.teams]) expect(row.color ?? "#000000").toMatch(/^#[0-9a-f]{6}$/i);
  });
});
