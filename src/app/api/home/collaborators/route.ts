import { NextRequest } from "next/server";
import { requireAuth, requirePermission, apiSuccess, handleApiError, ApiError } from "@/lib/utils/api";
import { db } from "@/db";
import { tasks, taskUsers, users, projects } from "@/db/schema";
import { and, eq, inArray, lte, sql } from "drizzle-orm";

/**
 * GET /api/home/collaborators?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Returns all tasks on the current user's projects within the date range,
 * so the frontend can show who else is working on the same project the same day.
 *
 * Permission: pages:home only — this endpoint intentionally BYPASSES the usual
 * user/project visibility permissions. If a user can see /home, they can see
 * all collaborators on the projects they themselves are assigned to, regardless
 * of whether they normally have permission to view those other users.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:home");

    const { searchParams } = request.nextUrl;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!startDate || !endDate) {
      throw new ApiError("home.errors.dateRangeRequired");
    }

    // 1. Find all task IDs assigned to the current user in the date range
    const myTaskRows = await db
      .select({ taskId: taskUsers.taskId })
      .from(taskUsers)
      .where(eq(taskUsers.userId, session.user.id));
    const myTaskIds = myTaskRows.map((r) => r.taskId);

    if (myTaskIds.length === 0) {
      return apiSuccess({ data: [] });
    }

    // 2. Resolve unique projectIds from the current user's tasks overlapping the range
    const myProjects = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(
        and(
          inArray(tasks.id, myTaskIds),
          sql`COALESCE(${tasks.endDate}, ${tasks.startDate}) >= ${startDate}`,
          lte(tasks.startDate, endDate),
        ),
      );
    const projectIds = Array.from(new Set(myProjects.map((p) => p.projectId))).filter(Boolean) as string[];

    if (projectIds.length === 0) {
      return apiSuccess({ data: [] });
    }

    // 3. Fetch all tasks in those projects overlapping the date range
    //    with users attached. Bypass tasks:view permission — home:view is enough.
    const collabTasks = await db
      .select({
        taskId: tasks.id,
        projectId: tasks.projectId,
        startDate: tasks.startDate,
        endDate: tasks.endDate,
        startTime: tasks.startTime,
        endTime: tasks.endTime,
        userId: users.id,
        userName: users.name,
        userFirstName: users.firstName,
        userColor: users.color,
        userImage: users.image,
        projectName: projects.name,
        projectColor: projects.color,
      })
      .from(tasks)
      .innerJoin(taskUsers, eq(taskUsers.taskId, tasks.id))
      .innerJoin(users, eq(users.id, taskUsers.userId))
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          inArray(tasks.projectId, projectIds),
          sql`COALESCE(${tasks.endDate}, ${tasks.startDate}) >= ${startDate}`,
          lte(tasks.startDate, endDate),
        ),
      );

    return apiSuccess({ data: collabTasks });
  } catch (error) {
    return handleApiError(error);
  }
}
