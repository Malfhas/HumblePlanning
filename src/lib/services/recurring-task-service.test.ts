import { describe, expect, it } from "bun:test";
import { selectSeriesOccurrences } from "./recurring-task-service";
import type { BulkTaskTarget } from "./task-bulk-service";
import type { TaskAccessScope, UserPermissions } from "./permission-service";

const perms = (permissions: string[], isAdmin = false): UserPermissions => ({
  userId: "me", roleId: "r", teamId: "team-a", businessUnitId: "bu-a", permissions, isAdmin,
});

const occurrence = (id: string, over: Partial<BulkTaskTarget> = {}): BulkTaskTarget => ({
  id, projectId: "project-a", isLocked: false, creatorId: "someone", projectOwnerId: "owner",
  users: [{ id: "colleague-a", teamId: "team-a" }], ...over,
});

const ids = (targets: BulkTaskTarget[]) => targets.map((t) => t.id);

// Seed "Manager": own BU, modifies every task it can see.
const MANAGER = ["scope:bu_own", "scope:modify_all", "scope:projects_bu", "scope:users_bu", "tasks:delete"];
// Read scope of that manager: the projects and users of BU A.
const buA: TaskAccessScope = { accessibleProjectIds: ["project-a", "project-a2"], accessibleUserIds: ["me", "colleague-a"] };

// A series created in BU A, then edited occurrence by occurrence.
const series = [
  occurrence("in-scope"),
  occurrence("moved-to-bu-b", { projectId: "project-b" }),
  occurrence("reassigned-to-bu-b", { users: [{ id: "worker-b", teamId: "team-b" }] }),
  occurrence("locked", { isLocked: true }),
];

describe("selectSeriesOccurrences", () => {
  it("keeps only the occurrences a BU manager could update or delete one by one", async () => {
    const manager = perms(MANAGER);
    expect(ids(await selectSeriesOccurrences(manager, series, "update", buA))).toEqual(["in-scope"]);
    expect(ids(await selectSeriesOccurrences(manager, series, "delete", buA))).toEqual(["in-scope"]);
  });

  it("deletes nothing without tasks:delete", async () => {
    const noDelete = perms(MANAGER.filter((p) => p !== "tasks:delete"));
    expect(await selectSeriesOccurrences(noDelete, series, "delete", buA)).toEqual([]);
    expect(ids(await selectSeriesOccurrences(noDelete, series, "update", buA))).toEqual(["in-scope"]);
  });

  it("applies the narrower modify scopes per occurrence", async () => {
    const own = perms(["scope:modify_own", "scope:projects_bu", "scope:users_bu", "tasks:delete"]);
    const mine = [
      occurrence("assigned", { users: [{ id: "me", teamId: "team-a" }] }),
      occurrence("created", { creatorId: "me" }),
      occurrence("someone-else"),
    ];
    expect(ids(await selectSeriesOccurrences(own, mine, "delete", buA))).toEqual(["assigned", "created"]);

    const readonly = perms(["scope:modify_readonly", "scope:projects_bu", "scope:users_bu"]);
    expect(await selectSeriesOccurrences(readonly, mine, "update", buA)).toEqual([]);
  });

  it("lets an admin reach every unlocked occurrence", async () => {
    const all: TaskAccessScope = { accessibleProjectIds: null, accessibleUserIds: null };
    const admin = perms([], true);
    expect(ids(await selectSeriesOccurrences(admin, series, "delete", all))).toEqual(["in-scope", "moved-to-bu-b", "reassigned-to-bu-b"]);
    // No target-state check on a project change either
    const move = { projectId: "project-a2", project: null };
    expect(ids(await selectSeriesOccurrences(admin, series, "update", all, move))).toEqual(["in-scope", "moved-to-bu-b", "reassigned-to-bu-b"]);
  });

  describe("project change", () => {
    const own = perms(["scope:modify_own", "scope:projects_bu", "scope:users_bu"]);
    const occurrences = [
      occurrence("mine", { users: [{ id: "me", teamId: "team-a" }] }),
      occurrence("shared", { users: [{ id: "me", teamId: "team-a" }, { id: "colleague-a", teamId: "team-a" }] }),
      occurrence("already-there", { projectId: "project-a2", creatorId: "me" }),
    ];

    it("checks the target state of the occurrences that move", async () => {
      // scope:modify_own: every assignee of a moved occurrence must be the user
      const move = { projectId: "project-a2", project: { ownerId: "owner" } };
      expect(ids(await selectSeriesOccurrences(own, occurrences, "update", buA, move))).toEqual(["mine", "already-there"]);
    });

    it("leaves out every moving occurrence when the target project is not readable", async () => {
      const move = { projectId: "project-a2", project: null };
      expect(ids(await selectSeriesOccurrences(own, occurrences, "update", buA, move))).toEqual(["already-there"]);
    });

    it("uses the target project owner for scope:modify_own_project", async () => {
      const ownProject = perms(["scope:modify_own_project", "scope:projects_bu", "scope:users_bu"]);
      const myProject = [occurrence("o1", { projectOwnerId: "me" }), occurrence("o2", { projectOwnerId: "me" })];
      const toMine = { projectId: "project-a2", project: { ownerId: "me" } };
      const toOther = { projectId: "project-a2", project: { ownerId: "owner" } };
      expect(ids(await selectSeriesOccurrences(ownProject, myProject, "update", buA, toMine))).toEqual(["o1", "o2"]);
      expect(await selectSeriesOccurrences(ownProject, myProject, "update", buA, toOther)).toEqual([]);
    });
  });
});
