import { db } from "@/db";
import { businessUnits, users, teams } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { logAudit, pickAuditFields, computeChanges } from "./audit-service";
import type { CreateBusinessUnit, UpdateBusinessUnit } from "@/lib/validators/business-unit";
import { logger } from "@/lib/logger";
import { invalidatePermissionsCache } from "./permission-service";

export async function getBusinessUnits() {
  return db.query.businessUnits.findMany({
    orderBy: (bu, { asc }) => [asc(bu.name)],
  });
}

export async function getBusinessUnitById(id: string) {
  return db.query.businessUnits.findFirst({
    where: eq(businessUnits.id, id),
  });
}

export async function createBusinessUnit(data: CreateBusinessUnit, userId?: string) {
  const [bu] = await db.insert(businessUnits).values(data).returning();

  logAudit({
    userId,
    action: "create",
    entityType: "business_unit",
    entityId: bu.id,
    newValues: pickAuditFields(bu as unknown as Record<string, unknown>, "business_unit"),
  }).catch((err) => logger.error("api", "Business unit audit error", { error: err instanceof Error ? err.message : String(err) }));

  return bu;
}

export async function updateBusinessUnit(id: string, data: UpdateBusinessUnit, userId?: string) {
  const old = await db.query.businessUnits.findFirst({ where: eq(businessUnits.id, id) });
  const [bu] = await db.update(businessUnits).set(data).where(eq(businessUnits.id, id)).returning();

  if (bu && old) {
    const changes = computeChanges(
      old as unknown as Record<string, unknown>,
      data as Record<string, unknown>,
      "business_unit"
    );
    if (changes) {
      logAudit({
        userId,
        action: "update",
        entityType: "business_unit",
        entityId: id,
        oldValues: changes.old,
        newValues: changes.new,
        changeCount: changes.count,
      }).catch((err) => logger.error("api", "Business unit audit error", { error: err instanceof Error ? err.message : String(err) }));
    }
  }

  return bu;
}

export async function deleteBusinessUnit(id: string, userId?: string) {
  const old = await db.query.businessUnits.findFirst({ where: eq(businessUnits.id, id) });
  if (!old) return null;

  // Before deleting, identify all users affected by the cascade
  // to invalidate their permissions/scope cache:
  //  1. users.businessUnitId === id (FK ON DELETE SET NULL → their BU disappears)
  //  2. users.teamId in a team whose businessUnitId === id (cascade-deleted
  //     → their teamId will be set to null by the FK ON DELETE SET NULL cascade).
  const directUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.businessUnitId, id));
  const teamsToCascade = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.businessUnitId, id));
  const teamIds = teamsToCascade.map((t) => t.id);
  const teamUsers =
    teamIds.length > 0
      ? await db.select({ id: users.id }).from(users).where(inArray(users.teamId, teamIds))
      : [];
  const allAffected = new Set<string>([
    ...directUsers.map((u) => u.id),
    ...teamUsers.map((u) => u.id),
  ]);

  logAudit({
    userId,
    action: "delete",
    entityType: "business_unit",
    entityId: id,
    oldValues: pickAuditFields(old as unknown as Record<string, unknown>, "business_unit", true),
  }).catch((err) => logger.error("api", "Business unit audit error", { error: err instanceof Error ? err.message : String(err) }));

  const [bu] = await db.delete(businessUnits).where(eq(businessUnits.id, id)).returning();

  // The FK cascade has now taken effect: invalidate the cache of all
  // affected users (their businessUnitId/teamId was just set to null).
  for (const uid of allAffected) invalidatePermissionsCache(uid);

  return bu;
}
