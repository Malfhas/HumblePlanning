import { db } from "@/db";
import { laborTypes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";

export async function getLaborTypes() {
  return db.query.laborTypes.findMany({
    orderBy: (lt, { asc }) => [asc(lt.sortOrder), asc(lt.name)],
  });
}

export async function getLaborTypeById(id: string) {
  return db.query.laborTypes.findFirst({ where: eq(laborTypes.id, id) });
}

export async function createLaborType(data: { name: string; initials: string; sortOrder?: number }) {
  const [lt] = await db.insert(laborTypes).values(data).returning();
  logAudit({ action: "create", entityType: "labor_type", entityId: lt.id, newValues: { name: data.name, initials: data.initials }, metadata: { name: data.name } }).catch(() => {});
  return lt;
}

export async function updateLaborType(id: string, data: Partial<typeof laborTypes.$inferInsert>) {
  const [lt] = await db.update(laborTypes).set(data).where(eq(laborTypes.id, id)).returning();
  logAudit({ action: "update", entityType: "labor_type", entityId: id, newValues: data, metadata: { name: lt.name } }).catch(() => {});
  return lt;
}

export async function deleteLaborType(id: string) {
  const [lt] = await db.delete(laborTypes).where(eq(laborTypes.id, id)).returning();
  logAudit({ action: "delete", entityType: "labor_type", entityId: id, oldValues: { name: lt.name }, metadata: { name: lt.name } }).catch(() => {});
  return lt;
}
