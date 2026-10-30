import { db } from "@/db";
import { holidays } from "@/db/schema";
import { eq, gte, lte, and } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";

export async function getHolidays(startDate?: string, endDate?: string) {
  const conditions = [];
  if (startDate) conditions.push(gte(holidays.date, startDate));
  if (endDate) conditions.push(lte(holidays.date, endDate));

  return db.query.holidays.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: (holidays, { asc }) => [asc(holidays.date)],
  });
}

export async function getHolidayById(id: string) {
  return db.query.holidays.findFirst({ where: eq(holidays.id, id) });
}

export async function createHoliday(data: { date: string; label?: string; color?: string }) {
  const [holiday] = await db.insert(holidays).values(data).returning();
  logAudit({ action: "create", entityType: "holiday", entityId: holiday.id, newValues: { date: data.date, label: data.label }, metadata: { name: data.label || data.date } }).catch(() => {});
  return holiday;
}

export async function updateHoliday(id: string, data: { date?: string; label?: string; color?: string }) {
  const [holiday] = await db.update(holidays).set(data).where(eq(holidays.id, id)).returning();
  logAudit({ action: "update", entityType: "holiday", entityId: id, newValues: data, metadata: { name: holiday.label || holiday.date } }).catch(() => {});
  return holiday;
}

export async function deleteHoliday(id: string) {
  const [holiday] = await db.delete(holidays).where(eq(holidays.id, id)).returning();
  logAudit({ action: "delete", entityType: "holiday", entityId: id, oldValues: { date: holiday.date, label: holiday.label }, metadata: { name: holiday.label || holiday.date } }).catch(() => {});
  return holiday;
}

export async function bulkCreateHolidays(
  items: { date: string; label: string }[],
  meta?: { country?: string; year?: number }
): Promise<{ imported: number; skipped: number }> {
  if (items.length === 0) return { imported: 0, skipped: 0 };

  const result = await db
    .insert(holidays)
    .values(items.map((h) => ({ date: h.date, label: h.label, color: "#ff0000" })))
    .onConflictDoNothing({ target: holidays.date })
    .returning({ id: holidays.id });

  const imported = result.length;
  const skipped = items.length - imported;

  logAudit({
    action: "create",
    entityType: "holiday",
    entityId: "bulk-import",
    newValues: { count: imported, skipped },
    metadata: { name: `Import ${meta?.country ?? ""} ${meta?.year ?? ""}`.trim(), imported, skipped },
  }).catch(() => {});

  return { imported, skipped };
}

export async function getHolidaySet(startDate: string, endDate: string): Promise<Set<string>> {
  const list = await getHolidays(startDate, endDate);
  return new Set(list.map((h) => h.date));
}
