import { db } from "@/db";
import { savedFilters } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { CreateSavedFilter, UpdateSavedFilter } from "@/lib/validators/filter";

export async function getSavedFilters(userId: string) {
  return db.query.savedFilters.findMany({
    where: eq(savedFilters.userId, userId),
    orderBy: (f, { asc }) => [asc(f.name)],
  });
}

export async function getSavedFilterById(id: string, userId: string) {
  return db.query.savedFilters.findFirst({
    where: and(eq(savedFilters.id, id), eq(savedFilters.userId, userId)),
  });
}

export async function createSavedFilter(userId: string, data: CreateSavedFilter) {
  const [filter] = await db
    .insert(savedFilters)
    .values({ ...data, userId })
    .returning();
  return filter;
}

export async function updateSavedFilter(id: string, userId: string, data: UpdateSavedFilter) {
  const [filter] = await db
    .update(savedFilters)
    .set(data)
    .where(and(eq(savedFilters.id, id), eq(savedFilters.userId, userId)))
    .returning();
  return filter;
}

export async function deleteSavedFilter(id: string, userId: string) {
  const [filter] = await db
    .delete(savedFilters)
    .where(and(eq(savedFilters.id, id), eq(savedFilters.userId, userId)))
    .returning();
  return filter;
}
