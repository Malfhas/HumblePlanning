import { db } from "@/db";
import { resourceTypes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";

export async function getResourceTypes() {
  return db.query.resourceTypes.findMany({
    orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.name)],
  });
}

export async function getResourceTypeById(id: string) {
  return db.query.resourceTypes.findFirst({ where: eq(resourceTypes.id, id) });
}

export async function createResourceType(data: { name: string; icon?: string; color?: string; sortOrder?: number }) {
  const [result] = await db.insert(resourceTypes).values(data).returning();
  logAudit({ action: "create", entityType: "resource_type", entityId: result.id, newValues: { name: data.name }, metadata: { name: data.name } }).catch(() => {});
  return result;
}

export async function updateResourceType(id: string, data: Partial<typeof resourceTypes.$inferInsert>) {
  const [result] = await db.update(resourceTypes).set(data).where(eq(resourceTypes.id, id)).returning();
  logAudit({ action: "update", entityType: "resource_type", entityId: id, newValues: data, metadata: { name: result.name } }).catch(() => {});
  return result;
}

export async function deleteResourceType(id: string) {
  const [result] = await db.delete(resourceTypes).where(eq(resourceTypes.id, id)).returning();
  logAudit({ action: "delete", entityType: "resource_type", entityId: id, oldValues: { name: result.name }, metadata: { name: result.name } }).catch(() => {});
  return result;
}
