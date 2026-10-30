import { db } from "@/db";
import { qualifications } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";

export async function getQualifications() {
  return db.query.qualifications.findMany({
    orderBy: (qualifications, { asc }) => [asc(qualifications.name)],
  });
}

export async function getQualificationById(id: string) {
  return db.query.qualifications.findFirst({
    where: eq(qualifications.id, id),
  });
}

export async function createQualification(data: {
  name: string;
  emoji?: string;
  color?: string;
  description?: string | null;
}) {
  const [qualification] = await db.insert(qualifications).values(data).returning();
  logAudit({ action: "create", entityType: "qualification", entityId: qualification.id, newValues: { name: data.name }, metadata: { name: data.name } }).catch(() => {});
  return qualification;
}

export async function updateQualification(
  id: string,
  data: {
    name?: string;
    emoji?: string;
    color?: string;
    description?: string | null;
  }
) {
  const [qualification] = await db
    .update(qualifications)
    .set(data)
    .where(eq(qualifications.id, id))
    .returning();
  logAudit({ action: "update", entityType: "qualification", entityId: id, newValues: data, metadata: { name: qualification.name } }).catch(() => {});
  return qualification;
}

export async function deleteQualification(id: string) {
  const [qualification] = await db
    .delete(qualifications)
    .where(eq(qualifications.id, id))
    .returning();
  logAudit({ action: "delete", entityType: "qualification", entityId: id, oldValues: { name: qualification.name }, metadata: { name: qualification.name } }).catch(() => {});
  return qualification;
}
