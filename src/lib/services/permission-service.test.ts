import { describe, expect, test } from "bun:test";
import {
  canModifyTask,
  isBusinessUnitInScope,
  isProjectInReadScope,
  restrictToScope,
  type TaskAccessScope,
  type UserPermissions,
} from "./permission-service";

function perms(permissions: string[], overrides: Partial<UserPermissions> = {}): UserPermissions {
  return {
    userId: "me",
    roleId: "role",
    teamId: "team-a",
    businessUnitId: "bu-a",
    permissions,
    isAdmin: false,
    ...overrides,
  };
}

// Seed "Manager": own BU, modifies every task it can see.
const manager = perms(["scope:bu_own", "scope:modify_all", "scope:projects_bu", "scope:users_bu"]);
// Read scope of that manager: the projects and users of BU A.
const buAScope: TaskAccessScope = { accessibleProjectIds: ["project-a"], accessibleUserIds: ["me", "colleague-a"] };

const taskOfBuA = { projectId: "project-a", users: [{ id: "colleague-a", teamId: "team-a" }], creatorId: "someone" };
const taskOfBuB = { projectId: "project-b", users: [{ id: "worker-b", teamId: "team-b" }], creatorId: "someone" };

describe("canModifyTask", () => {
  test("scope:modify_all is bounded by the read scope", () => {
    expect(canModifyTask(manager, taskOfBuA, buAScope)).toBe(true);
    expect(canModifyTask(manager, taskOfBuB, buAScope)).toBe(false);
  });

  test("a project outside the scope is enough to refuse, even with a visible assignee", () => {
    const crossBu = { projectId: "project-b", users: [{ id: "colleague-a", teamId: "team-a" }] };
    expect(canModifyTask(manager, crossBu, buAScope)).toBe(false);
  });

  test("a task without projectId cannot pass a project-restricted scope", () => {
    expect(canModifyTask(manager, { users: taskOfBuA.users }, buAScope)).toBe(false);
  });

  test("unrestricted read scope keeps scope:modify_all on every task", () => {
    const unrestricted: TaskAccessScope = { accessibleProjectIds: null, accessibleUserIds: null };
    const globalManager = perms(["scope:bu_all", "scope:modify_all", "scope:projects_all", "scope:users_all"]);
    expect(canModifyTask(globalManager, taskOfBuB, unrestricted)).toBe(true);
  });

  test("admin bypasses the read scope", () => {
    expect(canModifyTask(perms([], { isAdmin: true }), taskOfBuB, buAScope)).toBe(true);
  });

  test("without a read scope only the modify scope is checked (legacy callers)", () => {
    expect(canModifyTask(manager, taskOfBuB)).toBe(true);
  });

  test("narrower modify scopes still apply inside the read scope", () => {
    const own = perms(["scope:modify_own", "scope:projects_bu", "scope:users_bu"]);
    expect(canModifyTask(own, taskOfBuA, buAScope)).toBe(false);
    expect(canModifyTask(own, { ...taskOfBuA, creatorId: "me" }, buAScope)).toBe(true);

    const team = perms(["scope:modify_team", "scope:projects_bu", "scope:users_bu"]);
    expect(canModifyTask(team, taskOfBuA, buAScope)).toBe(true);

    const ownProject = perms(["scope:modify_own_project", "scope:projects_bu", "scope:users_bu"]);
    expect(canModifyTask(ownProject, { ...taskOfBuA, project: { ownerId: "me" } }, buAScope)).toBe(true);
    expect(canModifyTask(ownProject, { ...taskOfBuA, projectOwnerId: "other" }, buAScope)).toBe(false);

    const readonly = perms(["scope:modify_readonly", "scope:projects_bu", "scope:users_bu"]);
    expect(canModifyTask(readonly, taskOfBuA, buAScope)).toBe(false);
  });

  test("a narrower modify scope cannot reach a task outside the read scope", () => {
    const own = perms(["scope:modify_own", "scope:projects_bu", "scope:users_bu"]);
    expect(canModifyTask(own, { ...taskOfBuB, creatorId: "me" }, buAScope)).toBe(false);
  });
});

describe("isProjectInReadScope", () => {
  const projectA = { id: "project-a", businessUnitId: "bu-a" };
  const projectB = { id: "project-b", businessUnitId: "bu-b" };
  const noBu = { id: "project-x", businessUnitId: null };

  test("planning visibility", () => {
    const scope = { visibleProjectIds: ["project-a"], managedBusinessUnitIds: [] };
    expect(isProjectInReadScope(projectA, scope)).toBe(true);
    expect(isProjectInReadScope(projectB, scope)).toBe(false);
    expect(isProjectInReadScope(noBu, scope)).toBe(false);
  });

  test("management pages add the projects of the BU scope", () => {
    const scope = { visibleProjectIds: [], managedBusinessUnitIds: ["bu-a"] };
    expect(isProjectInReadScope(projectA, scope)).toBe(true);
    expect(isProjectInReadScope(projectB, scope)).toBe(false);
    expect(isProjectInReadScope(noBu, scope)).toBe(false);
  });

  test("null means every project", () => {
    expect(isProjectInReadScope(projectB, { visibleProjectIds: null, managedBusinessUnitIds: [] })).toBe(true);
    expect(isProjectInReadScope(noBu, { visibleProjectIds: [], managedBusinessUnitIds: null })).toBe(true);
  });
});

describe("restrictToScope", () => {
  test("no scope: the client filter or nothing", () => {
    expect(restrictToScope(undefined, null)).toBeNull();
    expect(restrictToScope([], null)).toBeNull();
    expect(restrictToScope(["bu-b"], null)).toEqual(["bu-b"]);
  });

  test("scoped: defaults to the scope, never leaves it", () => {
    expect(restrictToScope(undefined, ["bu-a"])).toEqual(["bu-a"]);
    expect(restrictToScope([], ["bu-a"])).toEqual(["bu-a"]);
    expect(restrictToScope(["bu-a", "bu-b"], ["bu-a"])).toEqual(["bu-a"]);
    expect(restrictToScope(["bu-b"], ["bu-a"])).toEqual([]);
    expect(restrictToScope(undefined, [])).toEqual([]);
  });
});

describe("isBusinessUnitInScope", () => {
  test("own BU only", () => {
    expect(isBusinessUnitInScope(manager, "bu-a")).toBe(true);
    expect(isBusinessUnitInScope(manager, "bu-b")).toBe(false);
    expect(isBusinessUnitInScope(manager, null)).toBe(true);
  });

  test("every BU for scope:bu_all and admins", () => {
    expect(isBusinessUnitInScope(perms(["scope:bu_all"]), "bu-b")).toBe(true);
    expect(isBusinessUnitInScope(perms([], { isAdmin: true }), "bu-b")).toBe(true);
  });
});
