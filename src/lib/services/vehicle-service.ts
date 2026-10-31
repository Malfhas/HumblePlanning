import { db } from "@/db";
import { vehicles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";
import { isEquipmentVisible } from "./equipment-scope";

/** Vehicles of `businessUnitIds` (`getEquipmentScope`, `null` = every vehicle). */
export async function getVehicles(businessUnitIds: string[] | null, includeOutOfService = true) {
  const all = (await db.query.vehicles.findMany({
    with: {
      vehicleType: {
        columns: { id: true, name: true, icon: true, color: true },
      },
      businessUnit: {
        columns: { id: true, name: true },
      },
    },
    orderBy: (v, { asc }) => [asc(v.name)],
  })).filter((v) => isEquipmentVisible(v, businessUnitIds));
  if (includeOutOfService) return all;
  return all.filter((v) => v.status !== "out_of_service");
}

export async function getVehicleById(id: string) {
  return db.query.vehicles.findFirst({
    where: eq(vehicles.id, id),
    with: {
      vehicleType: {
        columns: { id: true, name: true, icon: true, color: true },
      },
      businessUnit: {
        columns: { id: true, name: true },
      },
    },
  });
}

export async function createVehicle(data: {
  name: string;
  vehicleTypeId?: string | null;
  registrationNumber?: string | null;
  color?: string;
  status?: string;
  comment?: string | null;
}) {
  const [vehicle] = await db.insert(vehicles).values(data).returning();
  logAudit({ action: "create", entityType: "vehicle", entityId: vehicle.id, newValues: { name: data.name }, metadata: { name: data.name } }).catch(() => {});
  return vehicle;
}

export async function updateVehicle(
  id: string,
  data: {
    name?: string;
    vehicleTypeId?: string | null;
    registrationNumber?: string | null;
    color?: string;
    status?: string;
    comment?: string | null;
  }
) {
  const [vehicle] = await db
    .update(vehicles)
    .set(data)
    .where(eq(vehicles.id, id))
    .returning();
  logAudit({ action: "update", entityType: "vehicle", entityId: id, newValues: data, metadata: { name: vehicle.name } }).catch(() => {});
  return vehicle;
}

export async function deleteVehicle(id: string) {
  const [vehicle] = await db
    .delete(vehicles)
    .where(eq(vehicles.id, id))
    .returning();
  logAudit({ action: "delete", entityType: "vehicle", entityId: id, oldValues: { name: vehicle.name }, metadata: { name: vehicle.name } }).catch(() => {});
  return vehicle;
}
