import { describe, expect, it } from "bun:test";
import { bulkTaskViolation, type BulkTaskTarget } from "./task-bulk-service";
import type { TaskAccessScope, UserPermissions } from "./permission-service";

const perms = (permissions: string[], isAdmin = false): UserPermissions => ({
  userId: "me", roleId: "r", teamId: "team-a", businessUnitId: null, permissions, isAdmin,
});

const task = (over: Partial<BulkTaskTarget> = {}): BulkTaskTarget => ({
  id: "t1", projectId: "p1", isLocked: false, creatorId: "someone", projectOwnerId: "owner",
  users: [{ id: "other", teamId: "team-b" }], ...over,
});

/** No read restriction (admin, scope:*_all). */
const ALL: TaskAccessScope = { accessibleProjectIds: null, accessibleUserIds: null };

describe("bulkTaskViolation", () => {
  it("refuses a task outside the user's modify scope", () => {
    expect(bulkTaskViolation(perms([]), task({ creatorId: "me" }), "update", ALL)).toBe("tasks.errors.notAllowed");
    const own = perms(["scope:modify_own"]);
    expect(bulkTaskViolation(own, task(), "update", ALL)).toBe("tasks.errors.notAllowed");
    expect(bulkTaskViolation(own, task(), "delete", ALL)).toBe("tasks.errors.deleteNotAllowed");
    expect(bulkTaskViolation(own, task({ users: [{ id: "me", teamId: "team-a" }] }), "update", ALL)).toBeNull();
    expect(bulkTaskViolation(own, task({ creatorId: "me" }), "delete", ALL)).toBeNull();
  });

  it("applies the team scope to the assignees", () => {
    const team = perms(["scope:modify_team"]);
    expect(bulkTaskViolation(team, task(), "update", ALL)).toBe("tasks.errors.notAllowed");
    expect(bulkTaskViolation(team, task({ users: [{ id: "x", teamId: "team-a" }] }), "update", ALL)).toBeNull();
  });

  it("answers like a missing task outside the read scope, even with modify_all", () => {
    const buManager = perms(["scope:modify_all", "scope:projects_bu"]);
    const ownBu: TaskAccessScope = { accessibleProjectIds: ["p-own"], accessibleUserIds: null };
    expect(bulkTaskViolation(buManager, task(), "update", ownBu)).toBe("tasks.errors.notFound");
    expect(bulkTaskViolation(buManager, task(), "delete", ownBu)).toBe("tasks.errors.notFound");
    expect(bulkTaskViolation(buManager, task({ projectId: "p-own" }), "update", ownBu)).toBeNull();
    // Visible assignees: a task without any is hidden from a user-limited scope
    const ownTeam: TaskAccessScope = { accessibleProjectIds: null, accessibleUserIds: ["me", "x"] };
    expect(bulkTaskViolation(buManager, task({ users: [] }), "update", ownTeam)).toBe("tasks.errors.notFound");
    expect(bulkTaskViolation(buManager, task({ users: [{ id: "x", teamId: null }] }), "update", ownTeam)).toBeNull();
  });

  it("refuses a locked task for everyone, admins included", () => {
    const locked = task({ isLocked: true });
    expect(bulkTaskViolation(perms(["scope:modify_all", "tasks:lock"]), locked, "update", ALL)).toBe("tasks.errors.locked");
    expect(bulkTaskViolation(perms([], true), locked, "delete", ALL)).toBe("tasks.errors.locked");
  });

  it("lets an admin or a modify_all user through on unlocked tasks", () => {
    expect(bulkTaskViolation(perms([], true), task(), "delete", ALL)).toBeNull();
    expect(bulkTaskViolation(perms(["scope:modify_all"]), task(), "update", ALL)).toBeNull();
  });
});
