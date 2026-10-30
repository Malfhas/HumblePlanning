import { db } from "@/db";
import { vehicleTypes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";

export async function getVehicleTypes() {
  return db.query.vehicleTypes.findMany({
    orderBy: (vt, { asc }) => [asc(vt.sortOrder), asc(vt.name)],
  });
}

export async function getVehicleTypeById(id: string) {
  return db.query.vehicleTypes.findFirst({
    where: eq(vehicleTypes.id, id),
  });
}

export async function createVehicleType(data: {
  name: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
}) {
  const [vt] = await db.insert(vehicleTypes).values(data).returning();
  logAudit({ action: "create", entityType: "vehicle_type", entityId: vt.id, newValues: { name: data.name }, metadata: { name: data.name } }).catch(() => {});
  return vt;
}

export async function updateVehicleType(
  id: string,
  data: {
    name?: string;
    icon?: string;
    color?: string;
    sortOrder?: number;
  }
) {
  const [vt] = await db
    .update(vehicleTypes)
    .set(data)
    .where(eq(vehicleTypes.id, id))
    .returning();
  logAudit({ action: "update", entityType: "vehicle_type", entityId: id, newValues: data, metadata: { name: vt.name } }).catch(() => {});
  return vt;
}

export async function deleteVehicleType(id: string) {
  const [vt] = await db
    .delete(vehicleTypes)
    .where(eq(vehicleTypes.id, id))
    .returning();
  logAudit({ action: "delete", entityType: "vehicle_type", entityId: id, oldValues: { name: vt.name }, metadata: { name: vt.name } }).catch(() => {});
  return vt;
}
