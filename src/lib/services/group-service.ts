import { db } from "@/db";
import { projectGroups, projects } from "@/db/schema";
import { eq, and as drizzleAnd } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";

export async function getGroups() {
  return db.query.projectGroups.findMany({
    with: { projects: true },
    orderBy: (groups, { asc }) => [asc(groups.sortOrder)],
  });
}

export async function getGroupById(id: string) {
  return db.query.projectGroups.findFirst({
    where: eq(projectGroups.id, id),
    with: { projects: true },
  });
}

export async function createGroup(data: { name: string; color?: string; sortOrder?: number; businessUnitId: string }) {
  const [group] = await db.insert(projectGroups).values(data).returning();
  logAudit({ action: "create", entityType: "project_group", entityId: group.id, newValues: { name: data.name }, metadata: { name: data.name } }).catch(() => {});
  return group;
}

export async function updateGroup(id: string, data: { name?: string; color?: string; sortOrder?: number; businessUnitId?: string }) {
  const [group] = await db.update(projectGroups).set(data).where(eq(projectGroups.id, id)).returning();
  logAudit({ action: "update", entityType: "project_group", entityId: id, newValues: data, metadata: { name: group.name } }).catch(() => {});
  return group;
}

export async function deleteGroup(id: string) {
  // Dissociate projects from this group before deleting
  await db.update(projects).set({ groupId: null }).where(eq(projects.groupId, id));
  const [group] = await db.delete(projectGroups).where(eq(projectGroups.id, id)).returning();
  logAudit({ action: "delete", entityType: "project_group", entityId: id, oldValues: { name: group.name }, metadata: { name: group.name } }).catch(() => {});
  return group;
}

export async function reorderGroupProjects(groupId: string, projectIds: string[]) {
  const updates = projectIds.map((projectId, index) =>
    db.update(projects)
      .set({ sortOrder: index })
      .where(drizzleAnd(eq(projects.id, projectId), eq(projects.groupId, groupId)))
  );
  await Promise.all(updates);
}

export async function reorderGroups(groupIds: string[]) {
  const updates = groupIds.map((groupId, index) =>
    db.update(projectGroups).set({ sortOrder: index }).where(eq(projectGroups.id, groupId))
  );
  await Promise.all(updates);
}
