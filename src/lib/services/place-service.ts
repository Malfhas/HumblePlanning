import { db } from "@/db";
import { places } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";

export async function getPlaces() {
  return db.query.places.findMany({
    orderBy: (places, { asc }) => [asc(places.name)],
  });
}

export async function getPlaceById(id: string) {
  return db.query.places.findFirst({ where: eq(places.id, id) });
}

export async function createPlace(data: { name: string; comment?: string; exclusive?: boolean; color?: string }) {
  const [place] = await db.insert(places).values(data).returning();
  logAudit({ action: "create", entityType: "place", entityId: place.id, newValues: { name: data.name }, metadata: { name: data.name } }).catch(() => {});
  return place;
}

export async function updatePlace(id: string, data: Partial<typeof places.$inferInsert>) {
  const [place] = await db.update(places).set(data).where(eq(places.id, id)).returning();
  logAudit({ action: "update", entityType: "place", entityId: id, newValues: data, metadata: { name: place.name } }).catch(() => {});
  return place;
}

export async function deletePlace(id: string) {
  const [place] = await db.delete(places).where(eq(places.id, id)).returning();
  logAudit({ action: "delete", entityType: "place", entityId: id, oldValues: { name: place.name }, metadata: { name: place.name } }).catch(() => {});
  return place;
}
