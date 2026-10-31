import { describe, expect, it } from "bun:test";
import { canGrantRole, canManageBusinessUnit, userReadFilter } from "./user-access";
import type { UserPermissions } from "./permission-service";

const actor = (permissions: string[], extra: Partial<UserPermissions> = {}): UserPermissions => ({
  userId: "u", roleId: "r", teamId: null, businessUnitId: "bu-1", permissions, isAdmin: false, ...extra,
});

// Excerpts of the default roles (src/db/seed.ts)
const MANAGER = [
  "pages:users", "users:create", "users:edit", "users:delete", "tasks:create", "tasks:assign",
  "scope:bu_own", "scope:modify_all", "scope:projects_bu", "scope:users_bu",
];
const MEMBER_PLUS = ["tasks:create", "tasks:assign", "scope:bu_own", "scope:modify_own", "scope:projects_bu", "scope:users_bu"];
const MEMBER = ["scope:bu_own", "scope:modify_readonly", "scope:projects_bu", "scope:users_bu"];
const ADMINISTRATOR = [...MANAGER, "settings:edit", "roles:create", "scope:bu_all", "scope:projects_all", "scope:users_all"];

describe("canGrantRole", () => {
  it("lets an isAdmin user grant any role, the admin bypass included", () => {
    const admin = actor([], { isAdmin: true });
    expect(canGrantRole(admin, { isAdmin: true, permissions: [] })).toBe(true);
    expect(canGrantRole(admin, { isAdmin: false, permissions: ADMINISTRATOR })).toBe(true);
  });

  it("never lets a non-admin grant the admin bypass", () => {
    expect(canGrantRole(actor(ADMINISTRATOR), { isAdmin: true, permissions: [] })).toBe(false);
  });

  it("lets a manager grant their own role and the narrower default roles", () => {
    const manager = actor(MANAGER);
    expect(canGrantRole(manager, { isAdmin: false, permissions: MANAGER })).toBe(true);
    expect(canGrantRole(manager, { isAdmin: false, permissions: MEMBER_PLUS })).toBe(true);
    expect(canGrantRole(manager, { isAdmin: false, permissions: MEMBER })).toBe(true);
    expect(canGrantRole(manager, { isAdmin: false, permissions: [] })).toBe(true);
  });

  it("refuses a role carrying a permission the actor does not hold", () => {
    expect(canGrantRole(actor(MANAGER), { isAdmin: false, permissions: ADMINISTRATOR })).toBe(false);
    expect(canGrantRole(actor(MANAGER), { isAdmin: false, permissions: ["settings:edit"] })).toBe(false);
  });

  it("refuses a broader scope level than the actor's", () => {
    const manager = actor(MANAGER);
    expect(canGrantRole(manager, { isAdmin: false, permissions: ["scope:users_all"] })).toBe(false);
    expect(canGrantRole(manager, { isAdmin: false, permissions: ["scope:projects_all"] })).toBe(false);
    expect(canGrantRole(manager, { isAdmin: false, permissions: ["scope:bu_all"] })).toBe(false);
    const memberPlus = actor(MEMBER_PLUS);
    expect(canGrantRole(memberPlus, { isAdmin: false, permissions: ["scope:modify_all"] })).toBe(false);
    expect(canGrantRole(memberPlus, { isAdmin: false, permissions: ["scope:modify_readonly"] })).toBe(true);
  });
});

describe("canManageBusinessUnit", () => {
  it("limits users without scope:users_all to their own business unit", () => {
    const manager = actor(MANAGER);
    expect(canManageBusinessUnit(manager, "bu-1")).toBe(true);
    expect(canManageBusinessUnit(manager, "bu-2")).toBe(false);
    expect(canManageBusinessUnit(manager, null)).toBe(false);
    expect(canManageBusinessUnit(actor(MANAGER, { businessUnitId: null }), null)).toBe(false);
  });

  it("lets scope:users_all and isAdmin users manage every business unit", () => {
    expect(canManageBusinessUnit(actor(ADMINISTRATOR), "bu-2")).toBe(true);
    expect(canManageBusinessUnit(actor([], { isAdmin: true, businessUnitId: null }), null)).toBe(true);
  });
});

describe("userReadFilter", () => {
  const users = [
    { id: "self", businessUnitId: "bu-1" },
    { id: "same-bu", businessUnitId: "bu-1" },
    { id: "other-bu", businessUnitId: "bu-2" },
    { id: "no-bu", businessUnitId: null },
  ];
  const ids = (filter: ReturnType<typeof userReadFilter>) => (filter ? users.filter(filter) : users).map((u) => u.id);

  it("does not filter when the planning visibility or the business-unit scope is unlimited", () => {
    expect(userReadFilter(null, [])).toBeNull();
    expect(userReadFilter(["self"], null)).toBeNull();
  });

  it("keeps the planning visibility only, outside the management pages", () => {
    expect(ids(userReadFilter(["self"], []))).toEqual(["self"]);
  });

  it("adds the users of the business units in scope on the management pages", () => {
    expect(ids(userReadFilter(["self"], ["bu-1"]))).toEqual(["self", "same-bu"]);
    // Without a business unit, only the planning visibility remains
    expect(ids(userReadFilter(["self", "no-bu"], ["bu-1"]))).toEqual(["self", "same-bu", "no-bu"]);
  });
});
