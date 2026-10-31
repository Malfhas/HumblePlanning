import { describe, expect, it } from "bun:test";
import {
  assertEquipmentWritable,
  assertTaskResourceWritable,
  changedBookingReferences,
  isEquipmentVisible,
  scopeBookings,
  type EquipmentScope,
  type ScopedBookingFields,
} from "./equipment-scope";
import type { UserPermissions } from "./permission-service";

describe("isEquipmentVisible", () => {
  it("is strict on the business unit when the scope restricts", () => {
    expect(isEquipmentVisible({ businessUnitId: "bu-a" }, ["bu-a"])).toBe(true);
    expect(isEquipmentVisible({ businessUnitId: "bu-b" }, ["bu-a"])).toBe(false);
    expect(isEquipmentVisible({ businessUnitId: null }, ["bu-a"])).toBe(false);
    expect(isEquipmentVisible({ businessUnitId: "bu-a" }, [])).toBe(false);
  });

  it("lets everything through without restriction", () => {
    expect(isEquipmentVisible({ businessUnitId: "bu-b" }, null)).toBe(true);
    expect(isEquipmentVisible({ businessUnitId: null }, null)).toBe(true);
  });
});

describe("scopeBookings", () => {
  // Seed "Manager" of BU A: its projects, its users' tasks.
  const buA: EquipmentScope = {
    businessUnitIds: ["bu-a"],
    projectScope: { visibleProjectIds: ["project-a"], managedBusinessUnitIds: ["bu-a"] },
    taskScope: { accessibleProjectIds: ["project-a"], accessibleUserIds: ["me", "colleague-a"] },
  };
  const unrestricted: EquipmentScope = {
    businessUnitIds: null,
    projectScope: { visibleProjectIds: null, managedBusinessUnitIds: null },
    taskScope: { accessibleProjectIds: null, accessibleUserIds: null },
  };

  const projectA = { id: "project-a", name: "Site A", color: "#111111", businessUnitId: "bu-a" };
  const projectB = { id: "project-b", name: "Secret site", color: "#222222", businessUnitId: "bu-b" };
  const taskOf = (projectId: string, userId: string, title = "Pour concrete") =>
    ({ id: `task-${projectId}-${userId}`, title, projectId, taskUsers: [{ userId }] });

  type Booking = ScopedBookingFields & { id: string; projectId: string | null; vehicle: { name: string; businessUnitId: string | null } | null };
  const booking = (id: string, vehicleBu: string | null, project: typeof projectA | null, task: Booking["task"] = null): Booking =>
    ({ id, projectId: project?.id ?? null, vehicle: { name: `Van ${id}`, businessUnitId: vehicleBu }, project, task });

  const bookings = [
    booking("own-vehicle-own-project", "bu-a", projectA, taskOf("project-a", "colleague-a")),
    booking("own-vehicle-lent-to-bu-b", "bu-a", projectB, taskOf("project-b", "worker-b")),
    booking("bu-b-vehicle-on-own-project", "bu-b", projectA),
    booking("bu-b-vehicle-bu-b-project", "bu-b", projectB),
    booking("no-bu-vehicle-maintenance", null, null),
    booking("own-vehicle-hidden-task", "bu-a", projectA, taskOf("project-a", "worker-b", "Not mine")),
  ];
  const byId = (rows: { id: string }[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

  it("keeps the bookings of visible equipment and those of readable projects", () => {
    const visible = scopeBookings(bookings, buA, (b) => b.vehicle);
    expect(visible.map((b) => b.id)).toEqual([
      "own-vehicle-own-project",
      "own-vehicle-lent-to-bu-b",
      "bu-b-vehicle-on-own-project",
      "own-vehicle-hidden-task",
    ]);
  });

  it("shows a project and a task only when readable, keeping their ids", () => {
    const visible = byId(scopeBookings(bookings, buA, (b) => b.vehicle));
    expect(visible["own-vehicle-own-project"]).toMatchObject({
      project: { id: "project-a", name: "Site A", color: "#111111" },
      task: { id: "task-project-a-colleague-a", title: "Pour concrete" },
    });
    // Lent to another BU: the booking shows, not what it is for
    const lent = visible["own-vehicle-lent-to-bu-b"];
    expect(lent.project).toBeNull();
    expect(lent.task).toBeNull();
    expect(lent.projectId).toBe("project-b");
    expect(JSON.stringify(lent)).not.toContain("Secret site");
    // Another BU's vehicle on a readable project: shown on the user's tasks
    expect(visible["bu-b-vehicle-on-own-project"]).toMatchObject({ vehicle: { name: "Van bu-b-vehicle-on-own-project" }, project: { name: "Site A" } });
    // Readable project, task outside the user's read scope
    expect(visible["own-vehicle-hidden-task"].task).toBeNull();
    expect(visible["own-vehicle-hidden-task"].project).toMatchObject({ name: "Site A" });
  });

  it("reduces the project and the task to what the client reads", () => {
    const [row] = scopeBookings([bookings[0]], buA, (b) => b.vehicle);
    expect(row.project).toEqual({ id: "project-a", name: "Site A", color: "#111111" });
    expect(row.task).toEqual({ id: "task-project-a-colleague-a", title: "Pour concrete" });
  });

  it("keeps everything for an unrestricted scope", () => {
    const visible = scopeBookings(bookings, unrestricted, (b) => b.vehicle);
    expect(visible).toHaveLength(bookings.length);
    expect(byId(visible)["own-vehicle-lent-to-bu-b"].project).toMatchObject({ name: "Secret site" });
  });

  it("drops a booking without equipment unless its project is readable", () => {
    const orphan = { ...booking("orphan", null, projectA), vehicle: null };
    expect(scopeBookings([orphan], buA, (b) => b.vehicle)).toHaveLength(1);
    expect(scopeBookings([{ ...orphan, project: projectB, projectId: "project-b" }], buA, (b) => b.vehicle)).toHaveLength(0);
  });
});

describe("changedBookingReferences", () => {
  const current = { equipmentId: "v1", projectId: "project-b", taskId: null };

  it("checks every reference of a new booking", () => {
    expect(changedBookingReferences(null, { equipmentId: "v1", projectId: "project-a", taskId: "t1" }))
      .toEqual({ equipmentId: "v1", projectId: "project-a", taskId: "t1" });
    expect(changedBookingReferences(null, { equipmentId: "v1", projectId: null })).toEqual({ equipmentId: "v1" });
  });

  it("lets the booking form re-send references it cannot read", () => {
    // Booking of the user's vehicle lent to BU B: the form sends project-b back as is
    expect(changedBookingReferences(current, { equipmentId: "v1", projectId: "project-b" })).toEqual({});
    // Dragging the bar: dates only
    expect(changedBookingReferences(current, {})).toEqual({});
  });

  it("checks what changes, and lets a reference be cleared", () => {
    expect(changedBookingReferences(current, { equipmentId: "v2", projectId: "project-c" })).toEqual({ equipmentId: "v2", projectId: "project-c" });
    expect(changedBookingReferences(current, { projectId: null })).toEqual({});
  });
});

describe("write checks that need no lookup", () => {
  const perms = (permissions: string[], isAdmin = false): UserPermissions => ({
    userId: "me", roleId: "r", teamId: null, businessUnitId: "bu-a", permissions, isAdmin,
  });
  const manager = perms(["scope:bu_own", "vehicles:create"]);

  it("creates a vehicle / resource only in a business unit of the scope", async () => {
    await expect(assertEquipmentWritable(manager, "vehicle", null, "bu-a")).resolves.toBeUndefined();
    await expect(assertEquipmentWritable(manager, "resource", null, "bu-b")).rejects.toMatchObject({ code: "errors.forbidden", status: 403 });
    await expect(assertEquipmentWritable(manager, "vehicle", null, null)).rejects.toMatchObject({ code: "errors.forbidden" });
    await expect(assertEquipmentWritable(perms(["scope:bu_all"]), "vehicle", null, "bu-b")).resolves.toBeUndefined();
    await expect(assertEquipmentWritable(perms([], true), "resource", null, "bu-b")).resolves.toBeUndefined();
  });

  it("keeps or clears a task's resource without checking it", async () => {
    await expect(assertTaskResourceWritable(manager, undefined)).resolves.toBeUndefined();
    await expect(assertTaskResourceWritable(manager, null, "r-of-bu-b")).resolves.toBeUndefined();
    await expect(assertTaskResourceWritable(manager, "r-of-bu-b", "r-of-bu-b")).resolves.toBeUndefined();
  });
});
