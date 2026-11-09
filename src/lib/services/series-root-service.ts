import { db } from "@/db";
import { tasks } from "@/db/schema";
import { and, eq, inArray, ne, not, type SQL } from "drizzle-orm";

/** What becomes of the occurrences a deleted root leaves behind. */
export type RootHandover =
  | { kind: "none" }
  | { kind: "single"; taskId: string }
  | { kind: "root"; rootId: string; occurrenceIds: string[] };

/**
 * The earliest occurrence left (then the smallest id, for a stable choice)
 * takes over the series; a lone occurrence is no series any more and becomes
 * a simple task.
 */
export function planRootHandover(remaining: { id: string; startDate: string }[]): RootHandover {
  if (remaining.length === 0) return { kind: "none" };
  const [first, ...others] = [...remaining].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id),
  );
  if (others.length === 0) return { kind: "single", taskId: first.id };
  return { kind: "root", rootId: first.id, occurrenceIds: others.map((t) => t.id) };
}

/**
 * To call before deleting the tasks matching `deleted`. A series is held by
 * its root (`parentId` = its own id, with the recurrence columns) and its
 * occurrences point to it: `parent_id ON DELETE SET NULL` would turn every
 * occurrence left by a deleted root into a simple task and lose the rule.
 * The earliest occurrence left becomes the root instead, with the rule, and
 * the others point to it; the update also bumps their `updatedAt`, so the
 * incremental sync of the mobile apps picks the change up.
 */
export async function handOverSeriesRoots(deleted: SQL): Promise<void> {
  const roots = await db
    .select({
      id: tasks.id,
      recurType: tasks.recurType,
      recurFrequency: tasks.recurFrequency,
      recurEndDate: tasks.recurEndDate,
      recurDayOfWeek: tasks.recurDayOfWeek,
      recurException: tasks.recurException,
    })
    .from(tasks)
    .where(and(deleted, eq(tasks.parentId, tasks.id)));

  for (const { id: oldRootId, ...rule } of roots) {
    const remaining = await db
      .select({ id: tasks.id, startDate: tasks.startDate })
      .from(tasks)
      .where(and(eq(tasks.parentId, oldRootId), ne(tasks.id, oldRootId), not(deleted)));
    const plan = planRootHandover(remaining);
    if (plan.kind === "single") {
      await db.update(tasks).set({ parentId: null }).where(eq(tasks.id, plan.taskId));
    } else if (plan.kind === "root") {
      await db.transaction(async (tx) => {
        await tx.update(tasks).set({ parentId: plan.rootId, ...rule }).where(eq(tasks.id, plan.rootId));
        await tx.update(tasks).set({ parentId: plan.rootId }).where(inArray(tasks.id, plan.occurrenceIds));
      });
    }
  }
}
