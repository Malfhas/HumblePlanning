import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { eq, like, and, ne, count } from "drizzle-orm";
import type { CreateProject, UpdateProject } from "@/lib/validators/project";
import { logAudit, computeChanges, pickAuditFields } from "./audit-service";
import { invalidatePermissionsCache } from "./permission-service";
import { invalidateCachePrefix } from "@/lib/cache";
import { USER_SECRET_COLUMNS_EXCLUDED } from "@/lib/utils/user-columns";

export async function getProjects(search?: string, includeArchived = false) {
  const conditions = [];
  if (search) conditions.push(like(projects.name, `%${search}%`));
  if (!includeArchived) conditions.push(ne(projects.status, "archived"));

  return db.query.projects.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    // Projection targeted at RELATIONS: we keep all the project's scalar
    // fields (used by the task form, FilterPanel
    // "Adresses", ProjectTooltip canvas, MCP), but only embed
    // the USEFUL columns of owner/group/businessUnit.
    //
    // Without projection (before): `owner: true` loads the user's 38
    // columns (email, settings, image, hashes, etc.) DUPLICATED on
    // every project that references it. Payload ~2.2 MB for 100 projects.
    //
    // With projection: owner = 4 columns (id, name, firstName, color).
    // Payload divided by ~5-7, i.e. ~300-450 KB. Security bonus: the
    // user's sensitive data (email, hash) is no longer exposed
    // through the public `/api/projects` API.
    with: {
      owner: { columns: { id: true, name: true, firstName: true, color: true } },
      // `sortOrder` is MANDATORY here: the `custom-group` sortMode (default of
      // the Projects view) and `custom-bu-group` sort the bands by
      // `groupSortOrder` (cf. sort-rows.ts line 141/333). Without this column
      // all groups come out with `sortOrder = 0` → alphabetical fallback
      // → the order set by drag-and-drop on /groups has no visible effect.
      group: { columns: { id: true, name: true, color: true, sortOrder: true } },
      businessUnit: { columns: { id: true, name: true, number: true, color: true } },
    },
    orderBy: (projects, { asc }) => [asc(projects.name)],
  });
}

export async function getProjectById(id: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, id),
    with: { owner: { columns: USER_SECRET_COLUMNS_EXCLUDED }, group: true, businessUnit: true },
  });
  if (!project) return null;

  const [{ value: taskCount }] = await db
    .select({ value: count() })
    .from(tasks)
    .where(eq(tasks.projectId, id));

  return { ...project, taskCount };
}

export async function createProject(data: CreateProject, creatorId?: string) {
  const [project] = await db.insert(projects).values(data).returning();

  await logAudit({
    userId: creatorId,
    action: "create",
    entityType: "project",
    entityId: project.id,
    newValues: pickAuditFields(project as unknown as Record<string, unknown>, "project"),
  });

  return project;
}

export async function updateProject(id: string, data: UpdateProject, modifierId?: string) {
  const oldProject = await db.query.projects.findFirst({ where: eq(projects.id, id) });

  const [project] = await db.update(projects).set(data).where(eq(projects.id, id)).returning();

  if (project && oldProject) {
    // Cache consistency: if ownerId changes, the old and new owner
    // see their `own/assigned_only` scope change → invalidate their
    // permissions cache (which also purges scope:projects/users:${userId} since
    // invalidatePermissionsCache was extended).
    const ownerChanged = data.ownerId !== undefined && data.ownerId !== oldProject.ownerId;
    const buChanged = data.businessUnitId !== undefined && data.businessUnitId !== oldProject.businessUnitId;
    if (ownerChanged) {
      if (oldProject.ownerId) invalidatePermissionsCache(oldProject.ownerId);
      if (data.ownerId) invalidatePermissionsCache(data.ownerId);
    }
    // If the BU changes, all users with scope="bu" gain/lose this
    // project. Broad invalidation since we do not know which users are affected
    // without an extra query (defensive mode, rare admin operation).
    if (buChanged) {
      invalidateCachePrefix("scope:projects:");
    }

    const changes = computeChanges(
      oldProject as unknown as Record<string, unknown>,
      data as Record<string, unknown>,
      "project"
    );
    if (changes) {
      await logAudit({
        userId: modifierId,
        action: "update",
        entityType: "project",
        entityId: id,
        oldValues: changes.old,
        newValues: changes.new,
        changeCount: changes.count,
      });
    }
  }

  return project;
}

export async function deleteProject(id: string, deleterId?: string) {
  const oldProject = await db.query.projects.findFirst({ where: eq(projects.id, id) });

  const [project] = await db.delete(projects).where(eq(projects.id, id)).returning();

  if (project && oldProject) {
    // The owner loses direct visibility (`own` scope). Any user with this
    // project in their scope (via BU/team) loses it too → invalidate broadly.
    if (oldProject.ownerId) invalidatePermissionsCache(oldProject.ownerId);
    invalidateCachePrefix("scope:projects:");

    await logAudit({
      userId: deleterId,
      action: "delete",
      entityType: "project",
      entityId: id,
      oldValues: pickAuditFields(oldProject as unknown as Record<string, unknown>, "project", true),
    });
  }

  return project;
}
