import { db } from "@/db";
import { resources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";
import { isEquipmentVisible } from "./equipment-scope";

/** Resources of `businessUnitIds` (`getEquipmentScope`, `null` = every resource). */
export async function getResources(businessUnitIds: string[] | null, includeOutOfService = true) {
  const result = (await db.query.resources.findMany({
    with: {
      resourceType: { columns: { id: true, name: true, icon: true, color: true } },
      businessUnit: { columns: { id: true, name: true } },
    },
    orderBy: (r, { asc }) => [asc(r.name)],
  })).filter((r) => isEquipmentVisible(r, businessUnitIds));
  if (!includeOutOfService) {
    return result.filter((r) => r.status !== "out_of_service");
  }
  return result;
}

export async function getResourceById(id: string) {
  return db.query.resources.findFirst({
    where: eq(resources.id, id),
    with: {
      resourceType: { columns: { id: true, name: true, icon: true, color: true } },
      businessUnit: { columns: { id: true, name: true } },
    },
  });
}

export async function createResource(data: {
  name: string;
  resourceTypeId?: string | null;
  serialNumber?: string | null;
  color?: string;
  status?: string;
  comment?: string | null;
}) {
  const [result] = await db.insert(resources).values(data).returning();
  logAudit({ action: "create", entityType: "resource", entityId: result.id, newValues: { name: data.name }, metadata: { name: data.name } }).catch(() => {});
  return result;
}

export async function updateResource(id: string, data: Partial<typeof resources.$inferInsert>) {
  const [result] = await db.update(resources).set(data).where(eq(resources.id, id)).returning();
  logAudit({ action: "update", entityType: "resource", entityId: id, newValues: data, metadata: { name: result.name } }).catch(() => {});
  return result;
}

export async function deleteResource(id: string) {
  const [result] = await db.delete(resources).where(eq(resources.id, id)).returning();
  logAudit({ action: "delete", entityType: "resource", entityId: id, oldValues: { name: result.name }, metadata: { name: result.name } }).catch(() => {});
  return result;
}
