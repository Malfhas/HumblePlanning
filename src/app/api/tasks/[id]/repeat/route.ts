import { requireAuth, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { loadUserPermissions, hasPermission, assertTaskModifiable } from "@/lib/services/permission-service";
import { repeatTaskSchema } from "@/lib/validators/task";
import { getTaskById } from "@/lib/services/task-service";
import { generateRecurringOccurrences } from "@/lib/services/recurring-task-service";
import { db } from "@/db";
import { tasks, taskUsers } from "@/db/schema";
import { eq, and, ne, inArray } from "drizzle-orm";
import { emitTaskEvent } from "@/lib/socket-events";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    // Repeat creates copies — need tasks:create and scope over the source task
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "tasks:create")) {
      return apiError("tasks.errors.insufficientPermission", 403);
    }
    const { id } = await params;
    assertUuid(id);
    const rule = await validateBody(request, repeatTaskSchema);

    const task = await getTaskById(id);
    // Scope check over source task: 404 outside the read scope, 403 outside the modify scope
    await assertTaskModifiable(perms, task);

    // Cannot repeat a child task
    if (task.parentId && task.parentId !== task.id) {
      return apiError("tasks.errors.repeatChildOccurrence");
    }

    // Validate end date is after start date
    if (rule.recurEndDate <= task.startDate) {
      return apiError("tasks.errors.recurrenceEndBeforeStart");
    }

    // If already a root, delete existing children only (keep root)
    if (task.parentId === task.id) {
      const children = await db.select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.parentId, id), ne(tasks.id, id)));
      const childIds = children.map(c => c.id);
      if (childIds.length > 0) {
        await db.delete(taskUsers).where(inArray(taskUsers.taskId, childIds));
        await db.update(tasks).set({ parentId: null }).where(inArray(tasks.id, childIds));
        await db.delete(tasks).where(inArray(tasks.id, childIds));
      }
    }

    // Mark task as root: parentId = id + recurrence columns
    const [rootTask] = await db.update(tasks)
      .set({
        parentId: id,
        recurType: rule.recurType,
        recurFrequency: rule.recurFrequency,
        recurEndDate: rule.recurEndDate,
        recurDayOfWeek: rule.recurDayOfWeek ?? null,
        recurException: rule.recurException,
      })
      .where(eq(tasks.id, id))
      .returning();

    // Get user IDs from junction table
    const tuRows = await db.select({ userId: taskUsers.userId })
      .from(taskUsers)
      .where(eq(taskUsers.taskId, id));
    const userIds = tuRows.map(r => r.userId);

    const occurrences = await generateRecurringOccurrences({
      rootTask,
      rule,
      userIds,
    });

    emitTaskEvent({ action: "created", taskId: id, userId: session.user.id });

    return apiSuccess({ rootId: id, occurrences: occurrences.length });
  } catch (error) {
    return handleApiError(error);
  }
}
