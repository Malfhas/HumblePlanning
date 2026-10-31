import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { withoutDemoBlockedPermissions } from "@/lib/demo";
import {
  getBuScope,
  getModifyScope,
  getProjectScope,
  getUserScope,
  type UserPermissions,
} from "./permission-service";

/**
 * User administration guards (create / edit / archive / delete / 2FA reset).
 * `users:create`, `users:edit` and `users:delete` say what can be done; these
 * guards say to whom, so that the holder of a limited role cannot raise
 * their own rights or take over a more privileged account:
 *   - a role can only be granted by someone who already holds everything it
 *     grants (the isAdmin bypass only by an isAdmin user);
 *   - an account can only be managed by someone who could grant its current
 *     role (password, e-mail, 2FA of a more privileged account included);
 *   - without `scope:users_all`, only accounts of one's own business unit.
 */

/** What a role grants: its admin bypass and its permission keys. */
export interface GrantedRights {
  isAdmin: boolean;
  permissions: string[];
}

// Scope levels from the narrowest to the broadest, in the precedence order of
// the permission-service resolvers (which keep the broadest level held).
const PROJECT_SCOPES = ["assigned_only", "own", "team", "bu", "all"];
const USER_SCOPES = ["self", "team", "bu", "all"];
const MODIFY_SCOPES = ["readonly", "own", "own_project", "team", "all"];
const BU_SCOPES = ["own", "all"];

function scopeWithin(levels: string[], granted: string, held: string): boolean {
  return levels.indexOf(granted) <= levels.indexOf(held);
}

/**
 * True when `actor` holds every right granted by `role`. Plain permissions
 * must be held as such; `scope:*` permissions are mutually exclusive levels,
 * so a narrower level than the actor's own counts as held.
 */
export function canGrantRole(actor: UserPermissions, role: GrantedRights): boolean {
  if (actor.isAdmin) return true;
  if (role.isAdmin) return false;

  const held = new Set(actor.permissions);
  if (role.permissions.some((p) => !p.startsWith("scope:") && !held.has(p))) return false;

  const granted: UserPermissions = { ...actor, isAdmin: false, permissions: role.permissions };
  return (
    scopeWithin(PROJECT_SCOPES, getProjectScope(granted), getProjectScope(actor)) &&
    scopeWithin(USER_SCOPES, getUserScope(granted), getUserScope(actor)) &&
    scopeWithin(MODIFY_SCOPES, getModifyScope(granted), getModifyScope(actor)) &&
    scopeWithin(BU_SCOPES, getBuScope(granted), getBuScope(actor))
  );
}

/**
 * Read filter of the user lists and details. Readable: the users of the
 * planning visibility (`getVisibleUserIds`, `null` = everyone) and, for the
 * management pages (`?unscoped=true`), the users of the business units in
 * scope (`getVisibleBusinessUnitIds`, `null` = every BU; pass `[]` otherwise).
 * Returns `null` when nothing is filtered.
 */
export function userReadFilter(
  visibleUserIds: string[] | null,
  managedBusinessUnitIds: string[] | null,
): ((user: { id: string; businessUnitId?: string | null }) => boolean) | null {
  if (visibleUserIds === null || managedBusinessUnitIds === null) return null;
  const visible = new Set(visibleUserIds);
  const managed = new Set(managedBusinessUnitIds);
  return (user) => visible.has(user.id) || (!!user.businessUnitId && managed.has(user.businessUnitId));
}

/** True when `actor` may manage the accounts of this business unit. */
export function canManageBusinessUnit(actor: UserPermissions, businessUnitId: string | null | undefined): boolean {
  if (getUserScope(actor) === "all") return true;
  return !!actor.businessUnitId && businessUnitId === actor.businessUnitId;
}

async function loadGrantedRights(roleId: string): Promise<GrantedRights | null> {
  const role = await db.query.roles.findFirst({
    where: eq(roles.id, roleId),
    columns: { isAdmin: true },
    with: { rolePermissions: { columns: { permission: true } } },
  });
  if (!role) return null;
  // Demo instance: compare with what the role really grants once loaded
  // (blocked permissions removed), but keep its stored admin flag.
  const { permissions } = withoutDemoBlockedPermissions({
    isAdmin: role.isAdmin,
    permissions: role.rolePermissions.map((rp) => rp.permission),
  });
  return { isAdmin: role.isAdmin, permissions };
}

export interface UserManagementRequest {
  /** Existing account being edited, archived, deleted or whose 2FA is reset. */
  targetId?: string;
  /** Role requested by a create/update payload (`undefined` = unchanged). */
  roleId?: string | null;
  /** Business unit requested by a create/update payload (`undefined` = unchanged). */
  businessUnitId?: string | null;
}

/**
 * Throws a 403 when `actor` may not perform the request (see the rules
 * above). A missing target is left to the caller (404 as before).
 */
export async function assertCanManageUser(actor: UserPermissions, request: UserManagementRequest): Promise<void> {
  if (actor.isAdmin) return;

  let currentRoleId: string | null = null;
  if (request.targetId) {
    const target = await db.query.users.findFirst({
      where: eq(users.id, request.targetId),
      columns: { roleId: true, businessUnitId: true },
    });
    if (!target) return;
    if (!canManageBusinessUnit(actor, target.businessUnitId)) {
      throw new AppError("users.errors.userOutOfScope", { status: 403 });
    }
    currentRoleId = target.roleId;
    if (currentRoleId) {
      const current = await loadGrantedRights(currentRoleId);
      if (current && !canGrantRole(actor, current)) {
        throw new AppError("users.errors.userTooPrivileged", { status: 403 });
      }
    }
  }

  if (request.businessUnitId !== undefined && !canManageBusinessUnit(actor, request.businessUnitId)) {
    throw fieldError("users.errors.businessUnitOutOfScope", "businessUnitId", 403);
  }

  if (request.roleId && request.roleId !== currentRoleId) {
    const requested = await loadGrantedRights(request.roleId);
    if (!requested) throw fieldError("roles.errors.notFound", "roleId", 404);
    if (!canGrantRole(actor, requested)) throw fieldError("users.errors.roleNotGrantable", "roleId", 403);
  }
}

/** Error shown on a field of the user form. */
function fieldError(code: string, field: string, status: number): AppError {
  return new AppError(code, { status, fields: { [field]: { code } } });
}
