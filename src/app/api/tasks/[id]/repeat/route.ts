import { requireAuth, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { loadUserPermissions, hasPermission, assertTaskModifiable, canCreateTask } from "@/lib/services/permission-service";
import { repeatTaskSchema } from "@/lib/validators/task";
import { getTaskById } from "@/lib/services/task-service";
import { generateRecurringOccurrences, clearSeriesOccurrences } from "@/lib/services/recurring-task-service";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { eq } from "drizzle-orm";
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

    // The occurrences are copies of the source task: same create right as
    // POST /api/tasks for its assignees and project.
    const userIds = task.users.map((u: { id: string }) => u.id);
    if (!(await canCreateTask(perms, userIds, task.project?.ownerId ?? null))) {
      return apiError("tasks.errors.createForUsersForbidden", 403);
    }

    // If already a root, replace the existing children (keep root). Only those
    // this user could delete one by one go; the new rule skips the dates of
    // the others (locked, out of scope…) so as not to duplicate them.
    const keptDates = task.parentId === task.id ? await clearSeriesOccurrences(id, perms) : undefined;

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

    const occurrences = await generateRecurringOccurrences({
      rootTask,
      rule,
      userIds,
      skipDates: keptDates,
    });

    emitTaskEvent({ action: "created", taskId: id, userId: session.user.id });

    return apiSuccess({ rootId: id, occurrences: occurrences.length });
  } catch (error) {
    return handleApiError(error);
  }
}
