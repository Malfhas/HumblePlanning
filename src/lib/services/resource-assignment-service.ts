import { db } from "@/db";
import { resourceAssignments } from "@/db/schema";
import { eq, and, or, lte, gte, ne, sql, inArray } from "drizzle-orm";

export async function isResourceAssignmentLocked(id: string): Promise<boolean> {
  const a = await db.query.resourceAssignments.findFirst({
    where: eq(resourceAssignments.id, id),
    columns: { isLocked: true },
  });
  return a?.isLocked === true;
}

const WITH_RELATIONS = {
  resource: {
    columns: { id: true, name: true, color: true },
    with: { resourceType: { columns: { id: true, name: true, icon: true, color: true } } },
  },
  assignedByUser: { columns: { id: true, name: true, firstName: true } },
  lastModifier: { columns: { id: true, name: true, firstName: true } },
  task: { columns: { id: true, title: true } },
  project: { columns: { id: true, name: true, color: true } },
} as const;

export async function getResourceAssignments(resourceId?: string, startDate?: string, endDate?: string) {
  const conditions = [];
  if (resourceId) conditions.push(eq(resourceAssignments.resourceId, resourceId));
  if (startDate && endDate) {
    conditions.push(lte(resourceAssignments.startDate, endDate));
    conditions.push(gte(resourceAssignments.endDate, startDate));
  }
  return db.query.resourceAssignments.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    with: WITH_RELATIONS,
    orderBy: (a, { asc }) => [asc(a.startDate)],
  });
}

export async function getResourceAssignmentById(id: string) {
  return db.query.resourceAssignments.findFirst({
    where: eq(resourceAssignments.id, id),
    with: WITH_RELATIONS,
  });
}

export async function getAssignmentsForTask(taskId: string) {
  return db.query.resourceAssignments.findMany({
    where: eq(resourceAssignments.taskId, taskId),
    with: WITH_RELATIONS,
  });
}

export async function checkConflicts(resourceId: string, startDate: string, endDate: string, excludeId?: string) {
  const conditions = [
    eq(resourceAssignments.resourceId, resourceId),
    lte(resourceAssignments.startDate, endDate),
    gte(resourceAssignments.endDate, startDate),
  ];
  if (excludeId) conditions.push(ne(resourceAssignments.id, excludeId));
  return db.query.resourceAssignments.findMany({
    where: and(...conditions),
    with: WITH_RELATIONS,
  });
}

export async function createResourceAssignment(data: {
  resourceId: string;
  taskId?: string | null;
  projectId?: string | null;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  assignedBy?: string;
  notes?: string | null;
  type?: string;
}) {
  const [result] = await db.insert(resourceAssignments).values(data).returning();
  return result;
}

export async function updateResourceAssignment(
  id: string,
  data: Partial<typeof resourceAssignments.$inferInsert>,
  modifierId?: string,
) {
  const [result] = await db
    .update(resourceAssignments)
    .set({ ...data, lastModifierId: modifierId ?? null })
    .where(eq(resourceAssignments.id, id))
    .returning();
  return result;
}

export async function deleteResourceAssignment(id: string) {
  const [result] = await db.delete(resourceAssignments).where(eq(resourceAssignments.id, id)).returning();
  return result;
}

export async function deleteAssignmentsForTask(taskId: string) {
  return db.delete(resourceAssignments).where(eq(resourceAssignments.taskId, taskId));
}

export async function syncTaskResourceAssignments(
  taskId: string,
  resourceIds: string[],
  startDate: string,
  endDate: string,
  assignedBy?: string
) {
  // Delete existing task assignments
  await db.delete(resourceAssignments).where(eq(resourceAssignments.taskId, taskId));
  if (resourceIds.length === 0) return [];
  // Insert new
  const values = resourceIds.map((resourceId) => ({
    resourceId,
    taskId,
    startDate,
    endDate,
    assignedBy,
    type: "task" as const,
  }));
  return db.insert(resourceAssignments).values(values).returning();
}
