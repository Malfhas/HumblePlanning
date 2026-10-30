import { db } from "@/db";
import { statuses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";

export async function getStatuses() {
  return db.query.statuses.findMany({
    orderBy: (statuses, { asc }) => [asc(statuses.sortOrder)],
  });
}

export async function getStatusById(id: string) {
  return db.query.statuses.findFirst({ where: eq(statuses.id, id) });
}

export async function createStatus(data: { name: string; color?: string; displayMode?: string; strikethrough?: boolean; bold?: boolean; italic?: boolean; underline?: boolean; isDefault?: boolean; showInList?: boolean; percentage?: number; priority?: number; includeInCalculation?: boolean; sortOrder?: number }) {
  const [status] = await db.insert(statuses).values(data).returning();
  logAudit({ action: "create", entityType: "status", entityId: status.id, newValues: { name: data.name }, metadata: { name: data.name } }).catch(() => {});
  return status;
}

export async function updateStatus(id: string, data: Partial<typeof statuses.$inferInsert>) {
  const [status] = await db.update(statuses).set(data).where(eq(statuses.id, id)).returning();
  logAudit({ action: "update", entityType: "status", entityId: id, newValues: data, metadata: { name: status.name } }).catch(() => {});
  return status;
}

export async function deleteStatus(id: string) {
  const [status] = await db.delete(statuses).where(eq(statuses.id, id)).returning();
  logAudit({ action: "delete", entityType: "status", entityId: id, oldValues: { name: status.name }, metadata: { name: status.name } }).catch(() => {});
  return status;
}
