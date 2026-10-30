import { db } from "@/db";
import { invalidateCachePrefix } from "@/lib/cache";
import { roles, rolePermissions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { CreateRole, UpdateRole } from "@/lib/validators/role";
import { logAudit } from "@/lib/services/audit-service";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";

/**
 * Well-known UUID for the "Super Administrateur" role.
 * This role is created at first deployment and restored automatically after any
 * DB import / SoPlanning migration. It is never deleted and always appears
 * at the top of the roles list in the UI.
 */
export const SUPER_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000005";
// Name and description in the database (data, never renamed): the UI displays
// `roles.system.superAdmin` in the user's language (roleDisplayName).
const SUPER_ADMIN_ROLE_NAME = "Super Administrateur"; // name in the database (collision resolution key)
const SUPER_ADMIN_ROLE_COLOR = "#7c3aed"; // purple-600 — distinct from the red "Administrateur"

/**
 * Thrown by `deleteRole` when the role still has users assigned to it.
 * Carries the list of affected users (`details.users`, 409) so the caller can
 * display them.
 */
export class RoleHasUsersError extends AppError {
  constructor(
    public affectedUsers: Array<{ id: string; name: string; firstName: string | null; email: string | null }>
  ) {
    super("roles.errors.hasUsers", {
      status: 409,
      params: { count: affectedUsers.length },
      details: { users: affectedUsers },
    });
    this.name = "RoleHasUsersError";
  }
}

function mapRoleWithPermissions(role: any) {
  if (!role) return role;
  const { rolePermissions: rp, ...rest } = role;
  return {
    ...rest,
    permissions: rp?.map((p: any) => p.permission) ?? [],
  };
}

/**
 * Ensure the "Super Administrateur" system role exists.
 *
 * Safe to call multiple times — idempotent. Called:
 * 1. At application startup (`instrumentation.ts`)
 * 2. After a DB import (`import-service.ts`)
 * 3. After a SoPlanning migration (`migration-service.ts`)
 *
 * The role is identified by a well-known UUID. If it already exists under any
 * name (e.g. restored from a dump with a custom name), we leave its name/color
 * alone but force `isSystem = true` and `isAdmin = true` as a safety net.
 * If it is missing entirely, we create it with the default values.
 */
export async function ensureSuperAdminRole(): Promise<void> {
  try {
    const existing = await db.query.roles.findFirst({
      where: eq(roles.id, SUPER_ADMIN_ROLE_ID),
    });

    if (existing) {
      // Re-affirm the protection flags in case a dump had them wrong.
      if (!existing.isSystem || !existing.isAdmin) {
        await db
          .update(roles)
          .set({ isSystem: true, isAdmin: true })
          .where(eq(roles.id, SUPER_ADMIN_ROLE_ID));
        logger.info("system", "Super Administrateur role flags restored", { id: SUPER_ADMIN_ROLE_ID });
      }
      return;
    }

    // Edge case: a role with the same *name* exists under a different id
    // (e.g. previously seeded manually). Promote it to the well-known id?
    // That would require updating users.role_id — risky. Instead, leave it
    // alone and create a fresh Super Administrateur under the well-known id.
    // If the insert fails on the name unique constraint, fall back to using
    // the existing row without renaming.
    try {
      await db.insert(roles).values({
        id: SUPER_ADMIN_ROLE_ID,
        name: SUPER_ADMIN_ROLE_NAME,
        description: "Accès complet à toutes les fonctionnalités. Rôle système insuppressible, recréé automatiquement après un import ou une migration.", // i18n-ignore database data (editable description)
        isSystem: true,
        isAdmin: true,
        color: SUPER_ADMIN_ROLE_COLOR,
      });
      logger.info("system", "Super Administrateur role created");
    } catch (err) {
      // Name conflict — another role is already called "Super Administrateur".
      // Mark that one as system+admin so it fulfills the contract, and point
      // the well-known id at nothing (we'll never create it again).
      const sameName = await db.query.roles.findFirst({
        where: eq(roles.name, SUPER_ADMIN_ROLE_NAME),
      });
      if (sameName) {
        await db
          .update(roles)
          .set({ isSystem: true, isAdmin: true })
          .where(eq(roles.id, sameName.id));
        logger.warn("system", "Super Administrateur already exists under a different id — promoted to system+admin", {
          existingId: sameName.id,
        });
        return;
      }
      throw err;
    }
  } catch (err) {
    // Never crash the boot sequence — log and continue
    logger.error("system", "Failed to ensure Super Administrateur role", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getRoles() {
  const result = await db.query.roles.findMany({
    with: { rolePermissions: true },
    orderBy: (roles, { asc }) => [asc(roles.name)],
  });

  const mapped = result.map(mapRoleWithPermissions);

  // Always pin Super Administrateur to the top, whatever the alphabetical order.
  return mapped.sort((a: any, b: any) => {
    if (a.id === SUPER_ADMIN_ROLE_ID) return -1;
    if (b.id === SUPER_ADMIN_ROLE_ID) return 1;
    return 0; // preserve the DB-level alphabetical order
  });
}

export async function getRoleById(id: string) {
  const role = await db.query.roles.findFirst({
    where: eq(roles.id, id),
    with: { rolePermissions: true },
  });
  return mapRoleWithPermissions(role);
}

export async function createRole(data: CreateRole) {
  const { permissions, ...roleData } = data;

  const [role] = await db.insert(roles).values(roleData).returning();

  if (permissions.length > 0) {
    await db.insert(rolePermissions).values(
      permissions.map((permission) => ({ roleId: role.id, permission }))
    );
  }

  logAudit({ action: "create", entityType: "role", entityId: role.id, newValues: { name: roleData.name }, metadata: { name: roleData.name } }).catch(() => {});
  return { ...role, permissions };
}

export async function updateRole(id: string, data: UpdateRole) {
  const { permissions, ...roleData } = data;

  // Only the Super Administrateur role is fully locked against edits. All
  // other system roles (including "Administrateur") can be renamed and have
  // their permissions freely adjusted — they are insuppressible but editable.
  const existing = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (existing?.id === SUPER_ADMIN_ROLE_ID) {
    if (roleData.name && roleData.name !== existing.name) {
      throw new AppError("roles.errors.cannotRenameSuperAdmin", {
        fields: { name: { code: "roles.errors.cannotRenameSuperAdmin" } },
      });
    }
    if (permissions !== undefined) {
      throw new AppError("roles.errors.cannotEditSuperAdminPermissions");
    }
  }

  const updates: Record<string, unknown> = {};
  if (roleData.name !== undefined) updates.name = roleData.name;
  if (roleData.description !== undefined) updates.description = roleData.description;
  if (roleData.color !== undefined) updates.color = roleData.color;

  let role = existing;
  if (Object.keys(updates).length > 0) {
    const [updated] = await db.update(roles).set(updates).where(eq(roles.id, id)).returning();
    role = updated;
  }

  // Replace permissions if provided
  if (permissions !== undefined) {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    if (permissions.length > 0) {
      await db.insert(rolePermissions).values(
        permissions.map((permission) => ({ roleId: id, permission }))
      );
    }
  }

  // Invalidate all permissions cache since role changed.
  // Also purge the scope caches since they depend on the role permissions
  // (getProjectScope/getUserScope read perms.permissions[]).
  invalidateCachePrefix("permissions:");
  invalidateCachePrefix("scope:projects:");
  invalidateCachePrefix("scope:users:");

  // Notify all users attached to this role so they refresh their UI
  // without F5. Emitted only if the permissions were actually
  // replaced (a mere role rename does not change the rights).
  if (permissions !== undefined) {
    const affected = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.roleId, id));
    if (affected.length > 0) {
      const { emitPermissionsChanged } = await import("@/lib/socket-events");
      emitPermissionsChanged(affected.map((u) => u.id));
    }
  }

  logAudit({ action: "update", entityType: "role", entityId: id, newValues: updates, metadata: { name: role?.name } }).catch(() => {});
  return { ...role, permissions: permissions ?? [] };
}

/**
 * Delete a role.
 *
 * - System roles (including Super Administrateur) cannot be deleted.
 * - If users are still assigned to the role, throws `RoleHasUsersError` with
 *   the list of affected users so the caller can display them to the admin.
 *   The caller must reassign these users to another role before retrying.
 */
export async function deleteRole(id: string) {
  const existing = await db.query.roles.findFirst({ where: eq(roles.id, id) });
  if (!existing) throw new AppError("roles.errors.notFound");
  if (existing.isSystem) throw new AppError("roles.errors.cannotDeleteSystem");

  // Refuse deletion if any users are still assigned to this role.
  // No more auto-reassign — we want the admin to consciously choose the
  // target role for each affected user (the previous auto-reassign to
  // "Membre" broke after SoPlanning migrations that wiped that role).
  const affected = await db
    .select({
      id: users.id,
      name: users.name,
      firstName: users.firstName,
      email: users.email,
    })
    .from(users)
    .where(eq(users.roleId, id));

  if (affected.length > 0) {
    throw new RoleHasUsersError(affected);
  }

  await db.delete(roles).where(eq(roles.id, id));
  logAudit({ action: "delete", entityType: "role", entityId: id, oldValues: { name: existing.name }, metadata: { name: existing.name } }).catch(() => {});
  return existing;
}
