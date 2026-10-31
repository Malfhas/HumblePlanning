import { db } from "@/db";
import { users, projects, tasks, taskUsers } from "@/db/schema";
import { eq, inArray, or } from "drizzle-orm";
import { cached, invalidateCache, invalidateCachePrefix } from "@/lib/cache";
import { withoutDemoBlockedPermissions } from "@/lib/demo";
import { AppError } from "@/lib/errors";

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

export interface UserPermissions {
  userId: string;
  roleId: string | null;
  teamId: string | null;
  businessUnitId: string | null;
  permissions: string[];
  isAdmin: boolean;
}

/**
 * Resolution of the 3 mutex groups of Block 3 (planning scope). Each group
 * has a default value if the user has checked none of the variants:
 *   - `projects` → "assigned_only" (the most restrictive)
 *   - `users` → "self"
 *   - `modify` → "readonly"
 */
export type ProjectScope = "all" | "bu" | "team" | "own" | "assigned_only";
export type UserScope = "all" | "bu" | "team" | "self";
export type ModifyScope = "readonly" | "all" | "team" | "own_project" | "own";
export type BuScope = "all" | "own";

// ════════════════════════════════════════════════════════════════════════
// Cache & loading
// ════════════════════════════════════════════════════════════════════════

/**
 * Load permissions for a user from their role.
 * Admin role bypasses all permission checks.
 */
export async function loadUserPermissions(userId: string): Promise<UserPermissions> {
  return cached(`permissions:${userId}`, () => fetchUserPermissions(userId), 2 * 60 * 1000); // 2 min TTL for permissions — i18n-ignore cache key (false positive)
}

/**
 * Uncached variant of `loadUserPermissions`: reads the role from the database
 * on every call. Used by the MCP server, which must apply a permission
 * removal (`mcp:use`, `mcp:write`…) immediately without waiting for the cache
 * to expire (the cache is per process and per route bundle).
 */
export async function fetchUserPermissions(userId: string): Promise<UserPermissions> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: {
      role: {
        with: { rolePermissions: true },
      },
    },
  });

  if (!user) {
    return { userId, roleId: null, teamId: null, businessUnitId: null, permissions: [], isAdmin: false };
  }

  const role = (user as any).role;
  const isAdmin = role?.isAdmin ?? false;
  const permissions = role?.rolePermissions?.map((rp: any) => rp.permission) ?? [];

  // Demo instance: administration is removed from every role, Super Admin included.
  return withoutDemoBlockedPermissions({
    userId,
    roleId: user.roleId,
    teamId: user.teamId,
    businessUnitId: user.businessUnitId,
    permissions,
    isAdmin,
  });
}

/** Invalidate permissions cache for a specific user or all users.
 *
 * Extended: also purges the scope caches (`scope:projects:${userId}:*` and
 * `scope:users:${userId}:*`) since they depend directly on the user's perms
 * (roleId, teamId, businessUnitId). Consistency: any caller of updateUser/
 * archiveUser/deleteTeam/etc. only has to invalidate permissions and
 * everything is refreshed in cascade.
 */
export function invalidatePermissionsCache(userId?: string) {
  if (userId) {
    invalidateCache(`permissions:${userId}`); // i18n-ignore cache key (false positive)
    invalidateCachePrefix(`scope:projects:${userId}:`);
    invalidateCachePrefix(`scope:users:${userId}:`);
  } else {
    invalidateCachePrefix("permissions:");
    invalidateCachePrefix("scope:projects:");
    invalidateCachePrefix("scope:users:");
  }
}

/**
 * Check if user has a specific permission. Admin bypasses all checks.
 */
export function hasPermission(perms: UserPermissions, permission: string): boolean {
  if (perms.isAdmin) return true;
  return perms.permissions.includes(permission);
}

// ════════════════════════════════════════════════════════════════════════
// Block 3 — Scope resolution
// ════════════════════════════════════════════════════════════════════════

/**
 * Returns the project visibility level for this user.
 * Admin: always `all`.
 * Otherwise: reads the mutex choice of the `scope:projects_*` group.
 * No choice: `assigned_only` (the most restrictive by default).
 */
export function getProjectScope(perms: UserPermissions): ProjectScope {
  if (perms.isAdmin) return "all";
  if (perms.permissions.includes("scope:projects_all")) return "all";
  if (perms.permissions.includes("scope:projects_bu")) return "bu";
  if (perms.permissions.includes("scope:projects_team")) return "team";
  if (perms.permissions.includes("scope:projects_own")) return "own";
  if (perms.permissions.includes("scope:projects_assigned_only")) return "assigned_only";
  return "assigned_only";
}

/** Same for the users visible on the planning grid. */
export function getUserScope(perms: UserPermissions): UserScope {
  if (perms.isAdmin) return "all";
  if (perms.permissions.includes("scope:users_all")) return "all";
  if (perms.permissions.includes("scope:users_bu")) return "bu";
  if (perms.permissions.includes("scope:users_team")) return "team";
  return "self";
}

/** Same for the planning modification level. */
export function getModifyScope(perms: UserPermissions): ModifyScope {
  if (perms.isAdmin) return "all";
  if (perms.permissions.includes("scope:modify_all")) return "all";
  if (perms.permissions.includes("scope:modify_team")) return "team";
  if (perms.permissions.includes("scope:modify_own_project")) return "own_project";
  if (perms.permissions.includes("scope:modify_own")) return "own";
  return "readonly";
}

/** Same for the accessible business units. */
export function getBuScope(perms: UserPermissions): BuScope {
  if (perms.isAdmin) return "all";
  if (perms.permissions.includes("scope:bu_all")) return "all";
  return "own";
}

// ════════════════════════════════════════════════════════════════════════
// Scope → visible IDs resolvers
// ════════════════════════════════════════════════════════════════════════

/**
 * Returns the list of user IDs visible to the given permissions.
 * `null` means "all users" — no filter should be applied.
 *
 * Cache: `scope:users:${userId}:${roleId}` TTL 5 min — invalidated by
 * invalidatePermissionsCache(userId) (extended to purge this prefix) and
 * by the services that mutate users/teams/BU (cf. updateUser, deleteTeam,
 * deleteBusinessUnit, etc.).
 */
export async function getVisibleUserIds(perms: UserPermissions): Promise<string[] | null> {
  const scope = getUserScope(perms);
  if (scope === "all") return null;

  return cached(`scope:users:${perms.userId}:${perms.roleId ?? "null"}`, async () => {
    if (scope === "bu") {
      if (!perms.businessUnitId) return [perms.userId];
      const buUsers = await db.query.users.findMany({
        where: eq(users.businessUnitId, perms.businessUnitId),
        columns: { id: true },
      });
      return buUsers.map((u) => u.id);
    }

    if (scope === "team") {
      if (!perms.teamId) return [perms.userId];
      const teamUsers = await db.query.users.findMany({
        where: eq(users.teamId, perms.teamId),
        columns: { id: true },
      });
      return teamUsers.map((u) => u.id);
    }

    // self
    return [perms.userId];
  }, 5 * 60 * 1000);
}

/**
 * Returns the list of project IDs visible to the given permissions.
 * `null` means "all projects" — no filter should be applied.
 *
 * Business logic:
 *   - `all` → null
 *   - `bu`  → projects where `business_unit_id = perms.businessUnitId`
 *   - `team` → projects where at least one task is assigned to a team member
 *   - `own` → projects where user is owner OR assigned to a task
 *   - `assigned_only` → projects where user has at least one assigned task
 *
 * Note: "assigned_only" and "own" use the same project resolution here —
 * the finer-grained filter (tasks only, not full project) is applied at the
 * task-fetching layer via `getTaskScopeFilter`.
 */
export async function getVisibleProjectIds(perms: UserPermissions): Promise<string[] | null> {
  const scope = getProjectScope(perms);
  if (scope === "all") return null;

  return cached(`scope:projects:${perms.userId}:${perms.roleId ?? "null"}`, async () => {
    if (scope === "bu") {
      if (!perms.businessUnitId) return [];
      const buProjects = await db.query.projects.findMany({
        where: eq(projects.businessUnitId, perms.businessUnitId),
        columns: { id: true },
      });
      return buProjects.map((p) => p.id);
    }

    if (scope === "team") {
      // "Projets de son équipe": strictly the projects whose owner is a
      // member of the user's team (includes the user themselves, since
      // they belong to their own team). Strict interpretation by
      // ownership — a project of another team does not appear, even if a
      // team member has a task assigned on it.
      if (!perms.teamId) return [];
      const teamUsers = await db.query.users.findMany({
        where: eq(users.teamId, perms.teamId),
        columns: { id: true },
      });
      const teamUserIds = teamUsers.map((u) => u.id);
      if (teamUserIds.length === 0) return [];

      const ownedProjects = await db.query.projects.findMany({
        where: inArray(projects.ownerId, teamUserIds),
        columns: { id: true },
      });
      return ownedProjects.map((p) => p.id);
    }

    // scope === "own" OR "assigned_only":
    // user-owned projects + projects where user has at least one assigned task
    const ownedProjects = await db.query.projects.findMany({
      where: eq(projects.ownerId, perms.userId),
      columns: { id: true },
    });
    const { tasks: tasksTable2 } = await import("@/db/schema");
    const assignedTaskProjects = await db
      .select({ projectId: tasksTable2.projectId })
      .from(taskUsers)
      .innerJoin(tasksTable2, eq(taskUsers.taskId, tasksTable2.id))
      .where(eq(taskUsers.userId, perms.userId));
    const ids = new Set<string>([
      ...ownedProjects.map((p) => p.id),
      ...assignedTaskProjects.map((r) => r.projectId),
    ]);
    return Array.from(ids);
  }, 5 * 60 * 1000);
}

/**
 * Task read scope (planning scope), shared by the `GET /api/tasks` list
 * and the `GET /api/tasks/:id` detail.
 * `null` = no restriction; `[]` = nothing visible; `[...]` = allowlist.
 */
export interface TaskAccessScope {
  accessibleProjectIds: string[] | null;
  accessibleUserIds: string[] | null;
}

export async function getTaskAccessScope(perms: UserPermissions): Promise<TaskAccessScope> {
  if (getProjectScope(perms) === "assigned_only") {
    // « Tâches qui lui sont assignées »: filtering strictly at the task
    // level (the user must be in task_users), with no additional
    // restriction on projects.
    return { accessibleProjectIds: null, accessibleUserIds: [perms.userId] };
  }
  const [accessibleProjectIds, accessibleUserIds] = await Promise.all([
    getVisibleProjectIds(perms),
    getVisibleUserIds(perms),
  ]);
  return { accessibleProjectIds, accessibleUserIds };
}

/**
 * Same rule as the SQL filtering of `getTasks`: project in the allowlist
 * and at least one visible assignee (a task without assignees is only
 * visible without user restriction).
 */
export function isTaskInAccessScope(
  task: { projectId: string | null; users: { id: string }[] },
  scope: TaskAccessScope,
): boolean {
  if (scope.accessibleProjectIds !== null) {
    if (!task.projectId || !scope.accessibleProjectIds.includes(task.projectId)) return false;
  }
  if (scope.accessibleUserIds !== null) {
    const visible = new Set(scope.accessibleUserIds);
    if (!task.users.some((u) => visible.has(u.id))) return false;
  }
  return true;
}

/**
 * What the read and modify checks need to know about a task. A `getTaskById`
 * result fits as it is (`project.ownerId`).
 */
export interface TaskAccessTarget {
  projectId: string | null;
  users: { id: string; teamId?: string | null }[];
  creatorId?: string | null;
  projectOwnerId?: string | null;
  project?: { ownerId?: string | null } | null;
}

/** Loads the `TaskAccessTarget` fields of one task, or null when it does not exist. */
async function loadTaskAccessTarget(taskId: string): Promise<TaskAccessTarget | null> {
  const row = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: { projectId: true, creatorId: true },
    with: {
      project: { columns: { ownerId: true } },
      taskUsers: { columns: { userId: true }, with: { user: { columns: { id: true, teamId: true } } } },
    },
  });
  if (!row) return null;
  return {
    projectId: row.projectId,
    creatorId: row.creatorId,
    projectOwnerId: row.project?.ownerId ?? null,
    users: row.taskUsers.map((tu) => tu.user),
  };
}

async function resolveTaskTarget(task: string | TaskAccessTarget | null | undefined): Promise<TaskAccessTarget | null> {
  return typeof task === "string" ? loadTaskAccessTarget(task) : (task ?? null);
}

/**
 * Throws `tasks.errors.notFound` (404) unless the task exists and is in the
 * user's read scope: an out-of-scope task is indistinguishable from a missing
 * one. Takes a task id or an already-loaded task, and returns the task.
 */
export async function assertTaskReadable(perms: UserPermissions, task: string): Promise<TaskAccessTarget>;
export async function assertTaskReadable<T extends TaskAccessTarget>(perms: UserPermissions, task: T | null | undefined): Promise<T>;
export async function assertTaskReadable(
  perms: UserPermissions,
  task: string | TaskAccessTarget | null | undefined,
): Promise<TaskAccessTarget> {
  const target = await resolveTaskTarget(task);
  if (!target || !isTaskInAccessScope(target, await getTaskAccessScope(perms))) {
    throw new AppError("tasks.errors.notFound");
  }
  return target;
}

/**
 * `assertTaskReadable`, then `tasks.errors.notAllowed` (403) when the task is
 * readable but outside the user's modify scope.
 */
export async function assertTaskModifiable(perms: UserPermissions, task: string): Promise<TaskAccessTarget>;
export async function assertTaskModifiable<T extends TaskAccessTarget>(perms: UserPermissions, task: T | null | undefined): Promise<T>;
export async function assertTaskModifiable(
  perms: UserPermissions,
  task: string | TaskAccessTarget | null | undefined,
): Promise<TaskAccessTarget> {
  const target = await resolveTaskTarget(task);
  const readScope = await getTaskAccessScope(perms);
  if (!target || !isTaskInAccessScope(target, readScope)) {
    throw new AppError("tasks.errors.notFound");
  }
  if (!canModifyTask(perms, target, readScope)) {
    throw new AppError("tasks.errors.notAllowed");
  }
  return target;
}

/**
 * Returns the list of Business Unit IDs visible.
 * `null` = all.
 */
export function getVisibleBusinessUnitIds(perms: UserPermissions): string[] | null {
  const buScope = getBuScope(perms);
  if (buScope === "all") return null;
  return perms.businessUnitId ? [perms.businessUnitId] : [];
}

/** True if `businessUnitId` is within the user's BU scope (no BU is always allowed). */
export function isBusinessUnitInScope(perms: UserPermissions, businessUnitId: string | null | undefined): boolean {
  if (!businessUnitId) return true;
  const visible = getVisibleBusinessUnitIds(perms);
  return visible === null || visible.includes(businessUnitId);
}

/**
 * Combines an optional client filter with a scope allowlist (`null` = no
 * restriction). Returns `null` when nothing restricts, otherwise the IDs
 * allowed by both; an empty array then matches nothing.
 */
export function restrictToScope(requested: string[] | null | undefined, allowed: string[] | null): string[] | null {
  const filter = requested && requested.length > 0 ? requested : null;
  if (allowed === null) return filter;
  if (filter === null) return allowed;
  const allowedSet = new Set(allowed);
  return filter.filter((id) => allowedSet.has(id));
}

// ════════════════════════════════════════════════════════════════════════
// Project read scope
// ════════════════════════════════════════════════════════════════════════

/**
 * Projects a user can read (detail, update, delete, labor budgets, target of
 * a new task). Two sources:
 *   - the planning visibility (`getVisibleProjectIds`);
 *   - the management pages (`pages:projects`, and the stats filters for the
 *     list), which work regardless of the planning scope but stay within the
 *     business-unit scope (`getVisibleBusinessUnitIds`).
 */
export interface ProjectReadScope {
  /** `null` = every project. */
  visibleProjectIds: string[] | null;
  /** Business units whose projects are readable through a management page: `null` = every BU, `[]` = none. */
  managedBusinessUnitIds: string[] | null;
}

export async function getProjectReadScope(
  perms: UserPermissions,
  managementAccess: boolean = hasPermission(perms, "pages:projects"),
): Promise<ProjectReadScope> {
  const managedBusinessUnitIds = managementAccess ? getVisibleBusinessUnitIds(perms) : [];
  // Every BU readable: the planning visibility cannot add anything.
  if (managedBusinessUnitIds === null) return { visibleProjectIds: null, managedBusinessUnitIds };
  return { visibleProjectIds: await getVisibleProjectIds(perms), managedBusinessUnitIds };
}

export function isProjectInReadScope(
  project: { id: string; businessUnitId: string | null },
  scope: ProjectReadScope,
): boolean {
  if (scope.visibleProjectIds === null || scope.visibleProjectIds.includes(project.id)) return true;
  if (scope.managedBusinessUnitIds === null) return true;
  return project.businessUnitId !== null && scope.managedBusinessUnitIds.includes(project.businessUnitId);
}

/**
 * The project when it exists and is readable by the user, otherwise null
 * (callers answer 404 either way, without revealing which).
 */
export async function getReadableProject(perms: UserPermissions, projectId: string, managementAccess?: boolean) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { id: true, ownerId: true, businessUnitId: true },
  });
  if (!project) return null;
  return isProjectInReadScope(project, await getProjectReadScope(perms, managementAccess)) ? project : null;
}

/** Throws `projects.errors.notFound` (404) unless the project exists and is readable. */
export async function assertProjectReadable(perms: UserPermissions, projectId: string) {
  const project = await getReadableProject(perms, projectId);
  if (!project) throw new AppError("projects.errors.notFound");
  return project;
}

/**
 * `assertProjectReadable`, then `projects.errors.notAllowed` (403) when the
 * project is readable but the user cannot modify it.
 */
export async function assertProjectModifiable(perms: UserPermissions, projectId: string) {
  const project = await assertProjectReadable(perms, projectId);
  if (!canModifyProject(perms, project)) throw new AppError("projects.errors.notAllowed");
  return project;
}

// ════════════════════════════════════════════════════════════════════════
// Action-level capability checks
// ════════════════════════════════════════════════════════════════════════

/**
 * Checks that a target state (assignees + project) respects the user's
 * `scope:modify_*`. Used both for creation and for any change that
 * modifies the assignees or the project of an existing task.
 *
 *   - `readonly`      → never
 *   - `all`           → all assignees must be within the visibility
 *                        scope (`getVisibleUserIds`)
 *   - `team`          → all assignees must be in the user's team
 *   - `own_project`   → the project must belong to the user
 *   - `own`           → all assignees must be the user themselves
 *
 * The caller must already have checked the admin bypass and the action
 * permissions (tasks:create / tasks:assign / tasks:move depending on context).
 */
export async function canAssignWithModifyScope(
  perms: UserPermissions,
  assignedUserIds: string[],
  projectOwnerId: string | null
): Promise<boolean> {
  const modifyScope = getModifyScope(perms);
  if (modifyScope === "readonly") return false;

  if (modifyScope === "team") {
    if (!perms.teamId) return false;
    if (assignedUserIds.length === 0) return false;
    const teamMembers = await db.query.users.findMany({
      where: eq(users.teamId, perms.teamId),
      columns: { id: true },
    });
    const teamSet = new Set(teamMembers.map((u) => u.id));
    return assignedUserIds.every((id) => teamSet.has(id));
  }

  if (modifyScope === "own_project") {
    return projectOwnerId === perms.userId;
  }

  if (modifyScope === "own") {
    if (assignedUserIds.length === 0) return false;
    return assignedUserIds.every((id) => id === perms.userId);
  }

  // modifyScope === "all" → fall back to the user visibility scope
  const visibleUserIds = await getVisibleUserIds(perms);
  if (visibleUserIds === null) return true;
  const visibleSet = new Set(visibleUserIds);
  return assignedUserIds.every((id) => visibleSet.has(id));
}

/**
 * True if the user can create a task assigned to the given users on the
 * given project. Requires `tasks:create` + `canAssignWithModifyScope`.
 */
export async function canCreateTask(
  perms: UserPermissions,
  assignedUserIds: string[],
  projectOwnerId: string | null
): Promise<boolean> {
  if (perms.isAdmin) return true;
  if (!hasPermission(perms, "tasks:create")) return false;
  return canAssignWithModifyScope(perms, assignedUserIds, projectOwnerId);
}

/**
 * True if the user can modify a task (any field).
 *
 * Rules:
 *   - Admin bypass
 *   - `readScope` given and the task outside it → false (what the user
 *     cannot see cannot be modified)
 *   - `scope:modify_readonly` → false
 *   - `scope:modify_all` → true
 *   - `scope:modify_team` → at least one assignee is in the user's team
 *   - `scope:modify_own_project` → project owner is the user
 *   - `scope:modify_own` → user is assigned OR is the task creator
 *
 * `readScope` (`getTaskAccessScope`) is what bounds `scope:modify_all`: a
 * manager limited to their business unit must not reach the tasks of other
 * BUs. Server-side callers pass it, with the task's `projectId` (or use
 * `assertTaskModifiable`); without it, only the modify scope is checked and
 * "all" means every task.
 */
export function canModifyTask(
  perms: UserPermissions,
  task: {
    users?: { id: string; teamId?: string | null }[] | null;
    creatorId?: string | null;
    projectOwnerId?: string | null;
    project?: { ownerId?: string | null } | null;
    projectId?: string | null;
  },
  readScope?: TaskAccessScope,
): boolean {
  if (perms.isAdmin) return true;

  if (readScope && !isTaskInAccessScope({ projectId: task.projectId ?? null, users: task.users ?? [] }, readScope)) {
    return false;
  }

  const scope = getModifyScope(perms);
  if (scope === "readonly") return false;
  if (scope === "all") return true;

  if (scope === "team") {
    if (!perms.teamId) return false;
    return task.users?.some((u) => u.teamId === perms.teamId) ?? false;
  }

  if (scope === "own_project") {
    return (task.projectOwnerId ?? task.project?.ownerId) === perms.userId;
  }

  // scope === "own"
  const isAssigned = task.users?.some((u) => u.id === perms.userId) ?? false;
  return isAssigned || task.creatorId === perms.userId;
}

/**
 * True if the user can modify a project. Uses the same rules as
 * canModifyTask, except the project only has an owner (no assignees).
 */
/**
 * Whether the user can modify the given project.
 *
 * Decoupled from the planning's `scope:modify_*` permission (which only governs
 * task-level modifications on /planning). Visibility of the project is
 * enforced upstream by the project read scope (`assertProjectReadable` /
 * `assertProjectModifiable`), so if the caller reached this check, they have
 * the right to see the project — and `projects:edit` alone grants the right
 * to modify it.
 *
 * The `project` argument is kept for API compatibility (and potential future
 * owner-scoped refinement) but is no longer consulted.
 */
export function canModifyProject(
  perms: UserPermissions,
  _project: { ownerId?: string | null }
): boolean {
  void _project;
  if (perms.isAdmin) return true;
  return hasPermission(perms, "projects:edit");
}

// ════════════════════════════════════════════════════════════════════════
// Legacy permission-key aliases (used by old callers during the refactor)
// ════════════════════════════════════════════════════════════════════════
//
// These helpers exist so that routes which have not yet been migrated to the
// new scheme continue to work. They are explicitly marked deprecated and
// should be removed once every caller has been updated.

/** @deprecated use `hasPermission(perms, "pages:xxx")` directly. */
export function canAccessPage(perms: UserPermissions, pageKey: string): boolean {
  return hasPermission(perms, `pages:${pageKey}`);
}
