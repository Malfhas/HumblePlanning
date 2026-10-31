import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import type { UserPermissions } from "@/lib/services/permission-service";
import {
  hasPermission,
  canCreateTask,
  canModifyTask,
  canAssignWithModifyScope,
  getTaskAccessScope,
  isTaskInAccessScope,
  getReadableProject,
  getProjectReadScope,
  isProjectInReadScope,
  isBusinessUnitInScope,
  getVisibleBusinessUnitIds,
  getVisibleUserIds,
} from "@/lib/services/permission-service";
import { userReadFilter } from "@/lib/services/user-access";
import {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  copyTask,
  isTaskLocked,
  assertDailyTaskLimit,
} from "@/lib/services/task-service";
import { getProjects, getProjectById, createProject, updateProject } from "@/lib/services/project-service";
import { getUsers, getUserById } from "@/lib/services/user-service";
import { getQualifications } from "@/lib/services/qualification-service";
import { getTeams, getTeamById } from "@/lib/services/team-service";
import { getStatuses } from "@/lib/services/status-service";
import { getHolidays } from "@/lib/services/holiday-service";
import { getPlaces } from "@/lib/services/place-service";
import { getVehicles } from "@/lib/services/vehicle-service";
import { getVehicleAssignments, checkConflicts } from "@/lib/services/vehicle-assignment-service";
import { getConfigValues } from "@/lib/services/config-service";
import { getProjectLaborBudgetsWithHours } from "@/lib/services/project-labor-budget-service";
import { getStatsUsers, getStatsProjects, getStatsRoi } from "@/lib/services/stats-service";
import { loadUserPermissions } from "@/lib/services/permission-service";
import { emitTaskEvent } from "@/lib/socket-events";
import { logAudit } from "@/lib/services/audit-service";
import { calculateTaskHours } from "@/lib/utils/hours";
import { AppError, type ErrorParams } from "@/lib/errors";
import type { AppLocale } from "@/i18n/config";
import { getServerTranslator, translateKey, type ServerTranslator } from "@/i18n/server-translator";
import { localizeErrorParams } from "@/lib/utils/error-params";

async function getDailyHours(): Promise<number> {
  const config = await getConfigValues(["DURATION_DAY"]);
  const dur = config.DURATION_DAY || "07:30";
  const [h, m] = dur.split(":").map(Number);
  return h + (m || 0) / 60;
}

function enrichTasksWithHours(tasks: any[], dailyHours: number) {
  return tasks.map((t: any) => ({
    ...t,
    calculatedHours: calculateTaskHours({
      startDate: t.startDate,
      endDate: t.endDate,
      startTime: t.startTime,
      endTime: t.endTime,
      duration: t.duration,
      breakDuration: t.breakDuration,
      realDuration: t.realDuration,
    }, dailyHours),
  }));
}

/**
 * Refusal related to the user's rights or data (permission, task not found
 * or locked…). It carries a code (`mcpTools.errors.*`): the registrar
 * (`readTool` / `writeTool`) replaces its message with the translation in
 * the user's language, which the MCP SDK returns to the client and the AI
 * chat passes to the model, whereas a technical failure is hidden from it.
 */
export class ToolDeniedError extends AppError {
  constructor(code: string, params?: ErrorParams) {
    super(code, { params, status: 403 });
    this.name = "ToolDeniedError";
  }
}

/** Write permission required by the channel that registers the tools. */
export type ToolWritePermission = "mcp:write" | "ai_chat:write";

/**
 * What `registerAllTools` needs: the `tool()` method of `McpServer`, which
 * the MCP server satisfies as is, and which the AI chat mimics to collect
 * the same tools without duplicating them.
 */
export interface ToolRegistrar {
  tool<A extends ZodRawShapeCompat>(
    name: string,
    description: string,
    schema: A,
    annotations: ToolAnnotations,
    cb: ToolCallback<A>,
  ): unknown;
}

function requirePerm(perms: UserPermissions, perm: string) {
  if (!hasPermission(perms, perm)) {
    throw new ToolDeniedError("mcpTools.errors.permissionRequired", { permission: perm });
  }
}

function requireMcpWrite(perms: UserPermissions, writePermission: ToolWritePermission = "mcp:write") {
  if (hasPermission(perms, writePermission)) return;
  if (writePermission === "ai_chat:write") {
    throw new ToolDeniedError("mcpTools.errors.aiChatReadOnly");
  }
  throw new ToolDeniedError("mcpTools.errors.mcpReadOnly");
}

// Tools that modify or delete existing data (destructiveHint annotation).
export const DESTRUCTIVE_TOOLS = new Set(["update-task", "delete-task", "move-task", "update-project"]);

// Fragments (lowercase) of a "finished" status name, in French and English.
// i18n-ignore heuristic on user-entered data, not displayed text
const DONE_STATUS_HINTS = ["terminé", "fini", "complet", "done", "finished", "completed", "closed"];

// Tool names, descriptions and `.describe()`: in English for everyone
// (meant for the models, decision 5), never translated. The French detector
// of `i18n:scan` mistakes « date », « description »…: hence the `i18n-ignore`.
const START_DATE = "Start date (YYYY-MM-DD)"; // i18n-ignore English meant for the models
const END_DATE = "End date (YYYY-MM-DD)"; // i18n-ignore English meant for the models
const NEW_START_DATE = "New start date (YYYY-MM-DD)"; // i18n-ignore English meant for the models
const NEW_END_DATE = "New end date (YYYY-MM-DD)"; // i18n-ignore English meant for the models

export function registerAllTools(
  server: ToolRegistrar,
  ctx: {
    userId: string;
    permissions: UserPermissions;
    /**
     * Language of the messages returned to the user (refusals, errors, results):
     * the token owner's for MCP, the request's for the AI chat. Tool names and
     * descriptions stay in English (models).
     */
    locale: AppLocale;
    /** Write permission of the channel (default: MCP server). */
    writePermission?: ToolWritePermission;
    /** Source recorded in the audit log for writes (default: "mcp"). */
    auditSource?: "mcp" | "ai_chat";
  }
): { setPermissions: (perms: UserPermissions) => void } {
  const { userId } = ctx;
  const writePermission = ctx.writePermission ?? "mcp:write";
  const auditSource = ctx.auditSource ?? "mcp";
  // Current permissions: the MCP route re-reads them from the database and replaces
  // them on every HTTP request (setPermissions) → a revoked right applies on the
  // next tool call, without reconnecting.
  let perms = ctx.permissions;

  // Translator for the user's language, created when first needed.
  let translator: Promise<ServerTranslator> | null = null;
  const tr = () => (translator ??= getServerTranslator(ctx.locale));

  /**
   * Any `AppError` thrown by a tool (`ToolDeniedError` refusal, business error
   * from a service, e.g. `tasks.errors.notFound`) comes out with its message
   * translated into the user's language: same instance, same class.
   */
  const localized = <A extends ZodRawShapeCompat>(cb: ToolCallback<A>): ToolCallback<A> =>
    (async (...args: unknown[]) => {
      try {
        return await (cb as (...a: unknown[]) => unknown)(...args);
      } catch (error) {
        if (error instanceof AppError) {
          const params = await localizeErrorParams(error.params, ctx.locale).catch(() => error.params);
          error.message = translateKey(await tr(), error.code, params) ?? error.message;
        }
        throw error;
      }
    }) as unknown as ToolCallback<A>;

  // Read: `readOnlyHint` (ChatGPT does not ask for confirmation, Claude
  // can allow them all at once).
  const readTool = <A extends ZodRawShapeCompat>(name: string, description: string, schema: A, cb: ToolCallback<A>) => {
    server.tool(name, description, schema, { readOnlyHint: true, openWorldHint: false }, localized(cb));
  };

  // Write: hidden from `tools/list` if the account lacks the channel's write
  // permission (`mcp:write`, or `ai_chat:write` for the AI chat) when the
  // session opens, and re-checked on every call (requireMcpWrite).
  const canWriteAtInit = hasPermission(perms, writePermission);
  const writeTool = <A extends ZodRawShapeCompat>(name: string, description: string, schema: A, cb: ToolCallback<A>) => {
    if (!canWriteAtInit) return;
    server.tool(name, description, schema, {
      readOnlyHint: false,
      destructiveHint: DESTRUCTIVE_TOOLS.has(name),
      openWorldHint: false,
    }, localized(cb));
  };

  /** Task visibility scope: same rules as GET /api/tasks (planning). */
  const taskScope = () => getTaskAccessScope(perms);

  /**
   * The task when it exists and is in the read scope (same rule as
   * GET /api/tasks/:id), with that scope, which also bounds `canModifyTask`.
   * Otherwise `taskNotFound`: an out-of-scope task looks like a missing one.
   */
  async function readableTask(taskId: string) {
    const [task, scope] = await Promise.all([getTaskById(taskId), taskScope()]);
    if (!task || !isTaskInAccessScope(task, scope)) throw new ToolDeniedError("mcpTools.errors.taskNotFound");
    return { task, scope };
  }

  /** The project when it exists and is readable (same rule as /api/projects/:id), otherwise `projectNotFound`. */
  async function readableProject(projectId: string) {
    const project = await getReadableProject(perms, projectId);
    if (!project) throw new ToolDeniedError("mcpTools.errors.projectNotFound");
    return project;
  }

  /** Like GET /api/users: email and phone numbers hidden without `users:edit` (except for oneself). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /** Same visibility as the users page (`GET /api/users?unscoped=true`): null = everyone. */
  async function userVisibility() {
    return userReadFilter(await getVisibleUserIds(perms), getVisibleBusinessUnitIds(perms));
  }

  function redactUser(u: any) {
    if (!u || u.id === userId || hasPermission(perms, "users:edit")) return u;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { email, mobile, phone, ...safe } = u;
    return safe;
  }

  // ─── Planning / Tasks ───

  readTool(
    "list-tasks",
    "Search and list tasks with filters (project, user, status, dates, text). Use minimal=true for a compact format (saves a lot of tokens when only the list of titles/dates/users is needed).",
    {
      projectId: z.string().optional().describe("Project ID"),
      userId: z.string().optional().describe("User ID"),
      statusId: z.string().optional().describe("Status ID"),
      startDate: z.string().optional().describe(START_DATE),
      endDate: z.string().optional().describe(END_DATE),
      search: z.string().optional().describe("Text search (title/notes)"),
      page: z.number().default(1).describe("Page"),
      limit: z.number().default(50).describe("Number of results per page"),
      minimal: z.boolean().default(false).describe("Return only the essential fields: id, title, dates, project (name/colour), status (name), users (name), calculatedHours"),
    },
    async (params) => {
      requirePerm(perms, "pages:tasks");
      const dailyH = await getDailyHours();
      const result = await getTasks({
        projectId: params.projectId,
        userId: params.userId,
        statusId: params.statusId,
        startDate: params.startDate,
        endDate: params.endDate,
        search: params.search,
        page: params.page ?? 1,
        limit: params.limit ?? 50,
      }, await taskScope());
      const enrichedTasks = enrichTasksWithHours((result as any).data || [], dailyH);

      if (params.minimal) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const compact = enrichedTasks.map((t: any) => ({
          id: t.id,
          title: t.title,
          startDate: t.startDate,
          endDate: t.endDate,
          startTime: t.startTime,
          endTime: t.endTime,
          calculatedHours: t.calculatedHours,
          projectName: t.project?.name ?? null,
          projectColor: t.project?.color ?? null,
          statusName: t.status?.name ?? null,
          users: (t.users ?? []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })),
          isLocked: t.isLocked ?? false,
          hasFiles: Array.isArray(t.files) && t.files.length > 0,
        }));
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              data: compact,
              total: (result as { total?: number }).total ?? compact.length,
              page: params.page ?? 1,
              limit: params.limit ?? 50,
              _meta: { dailyHours: dailyH, mode: "minimal" },
            }, null, 2),
          }],
        };
      }

      const enriched = {
        ...result,
        data: enrichedTasks,
        _meta: { dailyHours: dailyH, hoursCalculation: "realDuration > startTime/endTime - break > duration > nbDays × dailyHours" },
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    }
  );

  readTool(
    "get-task",
    "Full details of a task (project, status, users, place, resource, calculated hours)",
    { taskId: z.string().describe("Task ID") },
    async ({ taskId }) => {
      requirePerm(perms, "pages:tasks");
      const { task } = await readableTask(taskId);
      const dailyH = await getDailyHours();
      const enriched = {
        ...task,
        users: (task.users ?? []).map(redactUser),
        calculatedHours: calculateTaskHours({
          startDate: (task as any).startDate,
          endDate: (task as any).endDate,
          startTime: (task as any).startTime,
          endTime: (task as any).endTime,
          duration: (task as any).duration,
          breakDuration: (task as any).breakDuration,
          realDuration: (task as any).realDuration,
        }, dailyH),
        _meta: { dailyHours: dailyH },
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    }
  );

  writeTool(
    "create-task",
    "Create a task (project, users, start date and status required). Send only the values the user gave: optional fields left out stay empty, exactly like a task created with the default values in the application. Never invent a title, times, a duration, a place or a resource.", // i18n-ignore English meant for the models
    {
      projectId: z.string().describe("Project ID"),
      userIds: z.array(z.string()).describe("IDs of the assigned users"),
      startDate: z.string().describe(START_DATE),
      endDate: z.string().optional().describe(END_DATE),
      title: z.string().optional().describe("Task title. Only if the user gives one"),
      notes: z.string().optional().describe("Notes. Only if the user gives some"),
      statusId: z.string().describe("Status ID. If the user names none, use the status marked isDefault in list-statuses"),
      placeId: z.string().optional().describe("Place ID. Only if the user names a place"),
      resourceId: z.string().optional().describe("Resource ID. Only if the user names a resource"),
      duration: z.string().optional().describe("Duration (HH:MM, e.g. 02:00). Only if the user states a duration; otherwise omit it"),
      startTime: z.string().optional().describe("Start time (HH:MM). Only if the user states a time; otherwise omit it: a task without times covers the whole day"),
      endTime: z.string().optional().describe("End time (HH:MM). Only if the user states a time; otherwise omit it"),
    },
    async (params) => {
      requireMcpWrite(perms, writePermission);
      // Same rule as POST /api/tasks: the target project must be readable.
      const project = await readableProject(params.projectId);
      const allowed = await canCreateTask(perms, params.userIds, project.ownerId ?? null);
      if (!allowed) throw new ToolDeniedError("mcpTools.errors.createForUsersForbidden");
      await assertDailyTaskLimit({ userIds: params.userIds, startDate: params.startDate, endDate: params.endDate });
      const task = await createTask({ ...params, isMilestone: false }, userId);
      emitTaskEvent({ action: "created", taskId: task.id, userId });
      await logAudit({ userId, action: "create", entityType: "task", entityId: task.id, metadata: { source: auditSource } });
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    }
  );

  writeTool(
    "update-task",
    "Update an existing task (title, dates, status, notes, users)",
    {
      taskId: z.string().describe("Task ID"),
      title: z.string().optional().describe("New title"),
      notes: z.string().optional().describe("New notes"),
      startDate: z.string().optional().describe(NEW_START_DATE),
      endDate: z.string().optional().describe(NEW_END_DATE),
      statusId: z.string().optional().describe("New status"),
      placeId: z.string().optional().nullable().describe("New place (null to remove)"),
      resourceId: z.string().optional().nullable().describe("New resource"),
      userIds: z.array(z.string()).optional().describe("New assigned users"),
      duration: z.string().optional().describe("New duration"),
      startTime: z.string().optional().describe("New start time"),
      endTime: z.string().optional().describe("New end time"),
    },
    async ({ taskId, ...data }) => {
      requireMcpWrite(perms, writePermission);
      const { task: existing, scope } = await readableTask(taskId);
      if (!canModifyTask(perms, existing, scope)) throw new ToolDeniedError("mcpTools.errors.updateNotAllowed");
      if (await isTaskLocked(taskId)) throw new ToolDeniedError("mcpTools.errors.taskLocked");
      // User reassignment: must respect modifyScope (+ tasks:assign).
      if (!perms.isAdmin && Array.isArray(data.userIds)) {
        if (!hasPermission(perms, "tasks:assign")) {
          throw new ToolDeniedError("mcpTools.errors.assignPermissionRequired");
        }
        const ok = await canAssignWithModifyScope(
          perms,
          data.userIds,
          (existing as any).project?.ownerId ?? null,
        );
        if (!ok) throw new ToolDeniedError("mcpTools.errors.assigneesOutOfScope");
      }
      const task = await updateTask(taskId, data, userId);
      emitTaskEvent({ action: "updated", taskId, userId });
      await logAudit({ userId, action: "update", entityType: "task", entityId: taskId, metadata: { source: auditSource } });
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    }
  );

  writeTool(
    "delete-task",
    "Delete a task",
    { taskId: z.string().describe("Task ID") },
    async ({ taskId }) => {
      requireMcpWrite(perms, writePermission);
      requirePerm(perms, "tasks:delete");
      const { task: existing, scope } = await readableTask(taskId);
      if (!canModifyTask(perms, existing, scope)) throw new ToolDeniedError("mcpTools.errors.deleteNotAllowed");
      if (await isTaskLocked(taskId)) throw new ToolDeniedError("mcpTools.errors.taskLocked");
      await deleteTask(taskId, userId);
      emitTaskEvent({ action: "deleted", taskId, userId });
      await logAudit({ userId, action: "delete", entityType: "task", entityId: taskId, metadata: { source: auditSource } });
      return { content: [{ type: "text" as const, text: (await tr())("mcpTools.results.taskDeleted") }] };
    }
  );

  writeTool(
    "move-task",
    "Move a task (new date, user, project)", // i18n-ignore English meant for the models
    {
      taskId: z.string().describe("Task ID"),
      startDate: z.string().describe(NEW_START_DATE),
      endDate: z.string().optional().describe(NEW_END_DATE),
      userIds: z.array(z.string()).optional().describe("New users"),
      projectId: z.string().optional().describe("New project"),
    },
    async ({ taskId, ...data }) => {
      requireMcpWrite(perms, writePermission);
      requirePerm(perms, "tasks:move");
      const { task: existing, scope } = await readableTask(taskId);
      if (!canModifyTask(perms, existing, scope)) throw new ToolDeniedError("mcpTools.errors.moveNotAllowed");
      if (await isTaskLocked(taskId)) throw new ToolDeniedError("mcpTools.errors.taskLocked");
      // Same rule as PUT /api/tasks/:id/move: the target state (assignees, project)
      // must stay within the modify scope.
      const existingUserIds = (existing.users ?? []).map((u: { id: string }) => u.id);
      const usersChanged = Array.isArray(data.userIds)
        && JSON.stringify([...data.userIds].sort()) !== JSON.stringify([...existingUserIds].sort());
      const projectChanged = typeof data.projectId === "string" && data.projectId !== existing.projectId;
      if (!perms.isAdmin && (usersChanged || projectChanged)) {
        if (usersChanged && !hasPermission(perms, "tasks:assign")) {
          throw new ToolDeniedError("mcpTools.errors.assignPermissionRequired");
        }
        let targetOwnerId: string | null = existing.project?.ownerId ?? null;
        if (projectChanged) {
          const target = await readableProject(data.projectId!);
          targetOwnerId = target.ownerId ?? null;
        }
        const ok = await canAssignWithModifyScope(perms, usersChanged ? data.userIds! : existingUserIds, targetOwnerId);
        if (!ok) throw new ToolDeniedError("mcpTools.errors.moveOutOfScope");
      }
      await assertDailyTaskLimit({
        userIds: Array.isArray(data.userIds) ? data.userIds : existingUserIds,
        startDate: data.startDate,
        endDate: data.endDate ?? null,
        excludeTaskId: taskId,
      });
      const task = await moveTask(taskId, data, userId);
      emitTaskEvent({ action: "moved", taskId, userId });
      await logAudit({ userId, action: "move", entityType: "task", entityId: taskId, metadata: { source: auditSource } });
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    }
  );

  writeTool(
    "copy-task",
    "Duplicate a task to a new date", // i18n-ignore English meant for the models
    {
      taskId: z.string().describe("ID of the task to copy"),
      startDate: z.string().describe("Start date of the copy (YYYY-MM-DD)"), // i18n-ignore English meant for the models
      endDate: z.string().optional().describe("End date of the copy (YYYY-MM-DD)"), // i18n-ignore English meant for the models
    },
    async ({ taskId, startDate, endDate }) => {
      requireMcpWrite(perms, writePermission);
      if (!hasPermission(perms, "tasks:create")) {
        throw new ToolDeniedError("mcpTools.errors.copyForbidden");
      }
      // Same rule as POST /api/tasks/:id/copy: the source must be readable and
      // the copy must respect the create scope (assignees + project owner).
      const { task: source } = await readableTask(taskId);
      const sourceUserIds = (source.users ?? []).map((u: { id: string }) => u.id);
      if (!(await canCreateTask(perms, sourceUserIds, source.project?.ownerId ?? null))) {
        throw new ToolDeniedError("mcpTools.errors.copyTaskForbidden");
      }
      await assertDailyTaskLimit({ userIds: sourceUserIds, startDate, endDate: null });
      const task = await copyTask(taskId, { startDate }, userId);
      if (!task) throw new ToolDeniedError("mcpTools.errors.copyFailed");
      emitTaskEvent({ action: "copied", taskId: task.id, userId });
      await logAudit({ userId, action: "copy", entityType: "task", entityId: task.id, metadata: { source: auditSource, sourceTaskId: taskId } });
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    }
  );

  readTool(
    "search-tasks",
    "Full-text search in tasks (title and notes)",
    {
      query: z.string().describe("Text to search for"),
      page: z.number().default(1),
      limit: z.number().default(50),
    },
    async ({ query, page, limit }) => {
      requirePerm(perms, "pages:tasks");
      const dailyH = await getDailyHours();
      const result = await getTasks({ search: query, page: page ?? 1, limit: limit ?? 50 }, await taskScope());
      const enriched = {
        ...result,
        data: enrichTasksWithHours((result as any).data || [], dailyH),
        _meta: { dailyHours: dailyH },
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    }
  );

  readTool(
    "get-user-schedule",
    "A user's schedule over a period: total hours, breakdown by project, and optionally the full task details. Use summaryOnly=true for a compact summary (saves tokens when the details are not needed).",
    {
      userId: z.string().describe("User ID"),
      startDate: z.string().describe(START_DATE),
      endDate: z.string().describe(END_DATE),
      summaryOnly: z.boolean().default(false).describe("If true, omits the 'tasks' array and returns only the totals and hoursByProject"),
    },
    async (params) => {
      requirePerm(perms, "pages:tasks");
      const dailyH = await getDailyHours();
      const result = await getTasks({
        userId: params.userId,
        startDate: params.startDate,
        endDate: params.endDate,
        page: 1,
        limit: 500,
      }, await taskScope());
      const tasks = enrichTasksWithHours((result as any).data || [], dailyH);
      const totalHours = tasks.reduce((sum: number, t: any) => sum + (t.calculatedHours || 0), 0);

      // Group hours by project
      const hoursByProject: Record<string, { projectId: string; projectName: string; hours: number; taskCount: number }> = {};
      const noProject = (await tr())("mcpTools.labels.noProject");
      for (const t of tasks) {
        const projId = t.projectId || "unknown";
        const projName = t.project?.name || noProject;
        if (!hoursByProject[projId]) hoursByProject[projId] = { projectId: projId, projectName: projName, hours: 0, taskCount: 0 };
        hoursByProject[projId].hours += t.calculatedHours || 0;
        hoursByProject[projId].taskCount++;
      }
      // Round hoursByProject
      Object.values(hoursByProject).forEach((p) => { p.hours = Math.round(p.hours * 100) / 100; });

      const payload: Record<string, unknown> = {
        userId: params.userId,
        period: { startDate: params.startDate, endDate: params.endDate },
        totalTasks: tasks.length,
        totalHours: Math.round(totalHours * 100) / 100,
        dailyHours: dailyH,
        hoursByProject: Object.values(hoursByProject),
      };
      if (!params.summaryOnly) {
        payload.tasks = tasks;
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(payload, null, 2),
        }],
      };
    }
  );

  // ─── Projects ───

  readTool(
    "list-projects",
    "Search and list active projects with filters (name, group, business unit, owner, delivery dates, colour, hours budget). Use minimal=true for a compact format (id, name, colour, status only) — saves a lot of tokens on large catalogues.",
    {
      search: z.string().optional().describe("Search by name"),
      includeArchived: z.boolean().default(false).describe("Include archived projects"),
      minimal: z.boolean().default(false).describe("Return only {id, name, color, status, groupName, businessNumber} to save tokens"),
    },
    async ({ search, includeArchived, minimal }) => {
      requirePerm(perms, "pages:projects");
      // Same list as the /projects page: the project read scope (business units)
      const readScope = await getProjectReadScope(perms);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await getProjects(search, includeArchived ?? false) as any[])
        .filter((p) => isProjectInReadScope(p, readScope));
      if (minimal) {
        const compact = result.map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          status: p.status,
          groupName: p.group?.name ?? null,
          businessNumber: p.businessNumber ?? null,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(compact, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  readTool(
    "get-project",
    "Details of a project (owner, group, number of tasks)",
    { projectId: z.string().describe("Project ID") },
    async ({ projectId }) => {
      requirePerm(perms, "pages:projects");
      const project = await getProjectById(projectId);
      if (!project || !isProjectInReadScope(project, await getProjectReadScope(perms))) {
        throw new ToolDeniedError("mcpTools.errors.projectNotFound");
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }] };
    }
  );

  writeTool(
    "create-project",
    "Create a project (name, colour, owner)",
    {
      name: z.string().describe("Project name"),
      color: z.string().default("#3b82f6").describe("Hex colour"),
      ownerId: z.string().optional().describe("Owner ID"),
      groupId: z.string().optional().describe("Group ID"),
      description: z.string().optional().describe("Description"), // i18n-ignore English meant for the models
      businessUnitId: z.string().optional().describe("Business unit ID"),
    },
    async (params) => {
      requireMcpWrite(perms, writePermission);
      requirePerm(perms, "projects:create");
      // Same rule as POST /api/projects: the business unit must be in the user's scope.
      if (!isBusinessUnitInScope(perms, params.businessUnitId)) throw new ToolDeniedError("errors.forbidden");
      const project = await createProject({
        name: params.name,
        color: params.color ?? "#3b82f6",
        status: "todo",
        ownerId: params.ownerId ?? userId,
        groupId: params.groupId,
        description: params.description,
        businessUnitId: params.businessUnitId,
      }, userId);
      await logAudit({ userId, action: "create", entityType: "project", entityId: project.id, metadata: { source: auditSource } });
      return { content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }] };
    }
  );

  writeTool(
    "update-project",
    "Update a project",
    {
      projectId: z.string().describe("Project ID"),
      name: z.string().optional().describe("New name"),
      color: z.string().optional().describe("New hex colour"),
      ownerId: z.string().optional().nullable().describe("New owner"),
      groupId: z.string().optional().nullable().describe("New group"),
      description: z.string().optional().describe("New description"), // i18n-ignore English meant for the models
      businessUnitId: z.string().optional().nullable().describe("Business unit ID"),
    },
    async ({ projectId, ...data }) => {
      requireMcpWrite(perms, writePermission);
      requirePerm(perms, "projects:edit");
      // Same rules as PUT /api/projects/:id: readable project, target business unit in scope.
      const existing = await readableProject(projectId);
      if (data.businessUnitId !== undefined && data.businessUnitId !== existing.businessUnitId
        && !isBusinessUnitInScope(perms, data.businessUnitId)) {
        throw new ToolDeniedError("errors.forbidden");
      }
      // Filter out null values for ownerId since updateProject doesn't accept null
      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.color !== undefined) updateData.color = data.color;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.ownerId !== undefined && data.ownerId !== null) updateData.ownerId = data.ownerId;
      if (data.groupId !== undefined) updateData.groupId = data.groupId;
      if (data.businessUnitId !== undefined) updateData.businessUnitId = data.businessUnitId;
      const project = await updateProject(projectId, updateData as any, userId);
      await logAudit({ userId, action: "update", entityType: "project", entityId: projectId, metadata: { source: auditSource } });
      return { content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }] };
    }
  );

  readTool(
    "get-project-hours",
    "Hours of a project with several possible groupings: by labour type (default, planned budget vs consumed/remaining), by user (hours per member) or by task status (to do/in progress/done). Key option for tracking hours against budget and how the work is split.",
    {
      projectId: z.string().describe("Project ID"),
      groupBy: z.enum(["labor-type", "user", "status"]).default("labor-type").describe("Grouping: 'labor-type' (budget per labour type), 'user' (hours per member), 'status' (hours per task status)"),
    },
    async ({ projectId, groupBy }) => {
      requirePerm(perms, "pages:projects");
      // Same rule as GET /api/projects/:id/labor-budgets
      await readableProject(projectId);

      if (groupBy === "labor-type") {
        const result = await getProjectLaborBudgetsWithHours(projectId);
        return { content: [{ type: "text" as const, text: JSON.stringify({ groupBy, projectId, budgets: result }, null, 2) }] };
      }

      // For user/status groupings, load all tasks of the project
      const dailyH = await getDailyHours();
      const tasksResult = await getTasks({ projectId, page: 1, limit: 500 }, await taskScope());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allTasks = ((tasksResult as any).data || []) as any[];

      if (groupBy === "user") {
        // Aggregate hours per user on this project
        const userMap = new Map<string, { userId: string; userName: string; laborTypeName: string | null; hours: number; taskCount: number }>();
        for (const t of allTasks) {
          const hours = calculateTaskHours({
            startDate: t.startDate,
            endDate: t.endDate,
            startTime: t.startTime,
            endTime: t.endTime,
            duration: t.duration,
            breakDuration: t.breakDuration,
            realDuration: t.realDuration,
          }, dailyH);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tUsers = (t.users ?? []) as any[];
          for (const u of tUsers) {
            const entry = userMap.get(u.id) ?? {
              userId: u.id,
              userName: u.name,
              laborTypeName: u.laborType?.name ?? null,
              hours: 0,
              taskCount: 0,
            };
            entry.hours += hours;
            entry.taskCount++;
            userMap.set(u.id, entry);
          }
        }
        const users = Array.from(userMap.values())
          .map((u) => ({ ...u, hours: Math.round(u.hours * 100) / 100 }))
          .sort((a, b) => b.hours - a.hours);
        const totalHours = users.reduce((s, u) => s + u.hours, 0);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              groupBy,
              projectId,
              totalHours: Math.round(totalHours * 100) / 100,
              totalUsers: users.length,
              users,
            }, null, 2),
          }],
        };
      }

      // groupBy === "status"
      const statusMap = new Map<string, { statusId: string; statusName: string; statusColor: string | null; hours: number; taskCount: number }>();
      const noStatus = (await tr())("mcpTools.labels.noStatus");
      for (const t of allTasks) {
        const hours = calculateTaskHours({
          startDate: t.startDate,
          endDate: t.endDate,
          startTime: t.startTime,
          endTime: t.endTime,
          duration: t.duration,
          breakDuration: t.breakDuration,
          realDuration: t.realDuration,
        }, dailyH);
        const sid = t.statusId || "__none__";
        const entry = statusMap.get(sid) ?? {
          statusId: sid,
          statusName: t.status?.name ?? noStatus,
          statusColor: t.status?.color ?? null,
          hours: 0,
          taskCount: 0,
        };
        entry.hours += hours;
        entry.taskCount++;
        statusMap.set(sid, entry);
      }
      const statuses = Array.from(statusMap.values())
        .map((s) => ({ ...s, hours: Math.round(s.hours * 100) / 100 }))
        .sort((a, b) => b.hours - a.hours);
      const totalHours = statuses.reduce((s, st) => s + st.hours, 0);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            groupBy,
            projectId,
            totalHours: Math.round(totalHours * 100) / 100,
            statuses,
          }, null, 2),
        }],
      };
    }
  );

  readTool(
    "get-project-status",
    "Health summary of one or more projects in a single call: number of tasks (total/in progress/overdue), planned/consumed/remaining hours, budget, number of users, first and last dates, over-budget/overdue flags. Replaces the list-projects + N × get-project + N × get-project-hours pattern.",
    {
      projectIds: z.array(z.string()).optional().describe("List of project IDs. If omitted: returns the status of all active projects."),
      includeArchived: z.boolean().default(false).describe("Include archived projects"),
    },
    async ({ projectIds, includeArchived }) => {
      requirePerm(perms, "pages:projects");
      const dailyH = await getDailyHours();
      const today = new Date().toISOString().slice(0, 10);

      // Load projects (readable ones only, like list-projects)
      const readScope = await getProjectReadScope(perms);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allProjects = (await getProjects(undefined, includeArchived ?? false) as any[])
        .filter((p) => isProjectInReadScope(p, readScope));
      const targetProjects = projectIds?.length
        ? allProjects.filter((p) => projectIds.includes(p.id))
        : allProjects;

      if (targetProjects.length === 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ projects: [], total: 0 }, null, 2) }] };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = [];
      const scope = await taskScope();
      for (const p of targetProjects) {
        const [tasksResult, budgets] = await Promise.all([
          getTasks({ projectId: p.id, page: 1, limit: 500 }, scope),
          getProjectLaborBudgetsWithHours(p.id).catch(() => []),
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tasks = ((tasksResult as any).data || []) as any[];

        let totalPlanned = 0;
        let consumed = 0;
        let upcoming = 0;
        const userSet = new Set<string>();
        let overdueCount = 0;
        let completedCount = 0;
        let firstDate: string | null = null;
        let lastDate: string | null = null;

        for (const t of tasks) {
          const hours = calculateTaskHours({
            startDate: t.startDate,
            endDate: t.endDate,
            startTime: t.startTime,
            endTime: t.endTime,
            duration: t.duration,
            breakDuration: t.breakDuration,
            realDuration: t.realDuration,
          }, dailyH);
          const effectiveEnd = t.endDate || t.startDate;
          if (effectiveEnd < today) {
            consumed += hours;
            // Heuristic: task is "overdue" if ended in the past and status is not "done/terminé".
            // Statuses = user-entered data (FR or EN depending on the instance): variants of both languages.
            const statusName = (t.status?.name || "").toLowerCase();
            if (!DONE_STATUS_HINTS.some((hint) => statusName.includes(hint))) {
              overdueCount++;
            } else {
              completedCount++;
            }
          } else {
            upcoming += hours;
          }
          totalPlanned += hours;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const u of (t.users ?? []) as any[]) userSet.add(u.id);
          if (!firstDate || t.startDate < firstDate) firstDate = t.startDate;
          if (!lastDate || effectiveEnd > lastDate) lastDate = effectiveEnd;
        }

        // Budget aggregation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const budgetList = budgets as any[];
        const totalBudgetHours = budgetList.reduce((s, b) => s + parseFloat(b.plannedHours || "0"), 0);
        const budgetDefined = budgetList.length > 0 && totalBudgetHours > 0;
        const budgetUsed = consumed + upcoming;
        const budgetRemaining = budgetDefined ? totalBudgetHours - budgetUsed : null;
        const budgetProgressPercent = budgetDefined ? Math.round((budgetUsed / totalBudgetHours) * 100) : null;
        const overBudget = budgetDefined && budgetUsed > totalBudgetHours;

        results.push({
          projectId: p.id,
          projectName: p.name,
          projectColor: p.color,
          projectStatus: p.status,
          groupName: p.group?.name ?? null,
          ownerName: p.owner?.name ?? null,
          businessUnitName: p.businessUnit?.name ?? null,
          tasks: {
            total: tasks.length,
            completed: completedCount,
            overdue: overdueCount,
            upcoming: tasks.length - completedCount - overdueCount,
          },
          hours: {
            totalPlanned: Math.round(totalPlanned * 100) / 100,
            consumed: Math.round(consumed * 100) / 100,
            upcoming: Math.round(upcoming * 100) / 100,
          },
          budget: budgetDefined ? {
            totalBudgetHours: Math.round(totalBudgetHours * 100) / 100,
            used: Math.round(budgetUsed * 100) / 100,
            remaining: Math.round((budgetRemaining ?? 0) * 100) / 100,
            progressPercent: budgetProgressPercent,
            overBudget,
            byLaborType: budgetList.map((b) => ({
              laborTypeId: b.laborTypeId,
              laborTypeName: b.laborType?.name,
              plannedHours: parseFloat(b.plannedHours || "0"),
              consumed: b.consumed ?? 0,
              upcoming: b.upcoming ?? 0,
            })),
          } : null,
          users: {
            count: userSet.size,
          },
          firstTaskDate: firstDate,
          lastTaskDate: lastDate,
          flags: {
            hasOverdueTasks: overdueCount > 0,
            overBudget: overBudget,
            hasNoTasks: tasks.length === 0,
          },
        });
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            total: results.length,
            asOf: today,
            projects: results,
          }, null, 2),
        }],
      };
    }
  );

  // ─── Users ───

  readTool(
    "list-users",
    "Search and list users with filters (name, team, business unit, certification/qualification/skill). Returns last name, first name, email, team, role, BU, labour type, contract and certifications (with id, name, emoji, colour).", // i18n-ignore English meant for the models
    {
      search: z.string().optional().describe("Search by last name/first name"),
      teamId: z.string().optional().describe("Filter by team ID"),
      businessUnitId: z.string().optional().describe("Filter by business unit ID"),
      qualificationId: z.string().optional().describe("Filter on users holding the certification/qualification with this ID"),
      qualificationName: z.string().optional().describe("Filter on users holding a certification/qualification whose name contains this string (case-insensitive, e.g. 'Amiante SS3')"),
      includeInactive: z.boolean().default(false).describe("Include inactive users"),
    },
    async ({ search, teamId, businessUnitId, qualificationId, qualificationName, includeInactive }) => {
      requirePerm(perms, "pages:users");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: any[] = await getUsers(search, !includeInactive);
      const readable = await userVisibility();
      if (readable) result = result.filter(readable);

      if (teamId) {
        result = result.filter((u) => u.teamId === teamId);
      }
      if (businessUnitId) {
        result = result.filter((u) => u.businessUnit?.id === businessUnitId);
      }
      if (qualificationId) {
        result = result.filter((u) =>
          Array.isArray(u.qualifications) && u.qualifications.some((q: { id: string }) => q.id === qualificationId),
        );
      }
      if (qualificationName) {
        const needle = qualificationName.toLowerCase();
        result = result.filter((u) =>
          Array.isArray(u.qualifications) && u.qualifications.some((q: { name: string }) => q.name?.toLowerCase().includes(needle)),
        );
      }
      result = result.map(redactUser);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  readTool(
    "get-user",
    "Full profile of a user (team, role, business unit, labour type, certifications/qualifications)",
    { userId: z.string().describe("User ID") },
    async ({ userId: targetId }) => {
      requirePerm(perms, "pages:users");
      const user = await getUserById(targetId);
      const readable = await userVisibility();
      if (!user || (readable && !readable(user))) throw new ToolDeniedError("mcpTools.errors.userNotFound");
      return { content: [{ type: "text" as const, text: JSON.stringify(redactUser(user), null, 2) }] };
    }
  );

  readTool(
    "list-qualifications",
    "Search and list the available certifications/qualifications/skills (asbestos, CACES, first aid, etc.) with id, name, emoji, colour and description. Useful to find a certification's id before filtering users.", // i18n-ignore English meant for the models
    {
      search: z.string().optional().describe("Filter by certification name (case-insensitive)"),
    },
    async ({ search }) => {
      requirePerm(perms, "pages:users");
      const all = await getQualifications();
      const filtered = search
        ? all.filter((q) => q.name?.toLowerCase().includes(search.toLowerCase()))
        : all;
      return { content: [{ type: "text" as const, text: JSON.stringify(filtered, null, 2) }] };
    }
  );

  readTool(
    "get-user-availability",
    "A user's availability over a period (planned hours vs capacity)",
    {
      userId: z.string().describe("User ID"),
      startDate: z.string().describe(START_DATE),
      endDate: z.string().describe(END_DATE),
    },
    async (params) => {
      requirePerm(perms, "pages:users");
      requirePerm(perms, "pages:tasks");
      const dailyH = await getDailyHours();
      const result = await getTasks({
        userId: params.userId,
        startDate: params.startDate,
        endDate: params.endDate,
        page: 1,
        limit: 500,
      }, await taskScope());
      const tasks = enrichTasksWithHours((result as any).data || [], dailyH);
      const totalPlannedHours = tasks.reduce((sum: number, t: any) => sum + (t.calculatedHours || 0), 0);

      // Count working days
      let workingDays = 0;
      const start = new Date(params.startDate);
      const end = new Date(params.endDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const day = d.getDay();
        if (day !== 0 && day !== 6) workingDays++;
      }
      const totalCapacity = workingDays * dailyH;
      const occupancyRate = totalCapacity > 0 ? Math.round((totalPlannedHours / totalCapacity) * 100) : 0;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            userId: params.userId,
            period: { startDate: params.startDate, endDate: params.endDate },
            workingDays,
            dailyHours: dailyH,
            totalCapacityHours: Math.round(totalCapacity * 100) / 100,
            totalPlannedHours: Math.round(totalPlannedHours * 100) / 100,
            availableHours: Math.round((totalCapacity - totalPlannedHours) * 100) / 100,
            occupancyRate: `${occupancyRate}%`,
            tasksCount: tasks.length,
            tasks,
          }, null, 2),
        }],
      };
    }
  );

  readTool(
    "whoami",
    "Information about the connected user and their permissions", // i18n-ignore English meant for the models
    {},
    async () => {
      const user = await getUserById(userId);
      const freshPerms = await loadUserPermissions(userId);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            user,
            permissions: freshPerms.permissions,
            isAdmin: freshPerms.isAdmin,
          }, null, 2),
        }],
      };
    }
  );

  // ─── Teams ───

  readTool(
    "list-teams",
    "Search and list all teams with their members (id, name, colour)",
    {},
    async () => {
      requirePerm(perms, "pages:teams");
      const readable = await userVisibility();
      const result = (await getTeams())
        .filter((t) => isBusinessUnitInScope(perms, t.businessUnitId))
        .map((t) => ({ ...t, users: (readable ? t.users.filter(readable) : t.users).map(redactUser) }));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  readTool(
    "get-team",
    "Details of a team and its members",
    { teamId: z.string().describe("Team ID") },
    async ({ teamId }) => {
      requirePerm(perms, "pages:teams");
      const team = await getTeamById(teamId);
      if (!team || !isBusinessUnitInScope(perms, team.businessUnitId)) throw new ToolDeniedError("mcpTools.errors.teamNotFound");
      const readable = await userVisibility();
      const users = readable ? team.users.filter(readable) : team.users;
      return { content: [{ type: "text" as const, text: JSON.stringify({ ...team, users: users.map(redactUser) }, null, 2) }] };
    }
  );

  readTool(
    "get-team-availability",
    "Availability and occupancy rate of a whole team over a period: total capacity, planned and available hours, occupancy % for each member + team summary. Replaces list-users + N get-user-availability calls with a single round trip.",
    {
      teamId: z.string().describe("Team ID"),
      startDate: z.string().describe(START_DATE),
      endDate: z.string().describe(END_DATE),
    },
    async (params) => {
      requirePerm(perms, "pages:teams");
      requirePerm(perms, "pages:users");
      requirePerm(perms, "pages:tasks");

      const team = await getTeamById(params.teamId);
      if (!team) throw new ToolDeniedError("mcpTools.errors.teamNotFound");

      const dailyH = await getDailyHours();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const members = ((team as any).users ?? []).filter((u: { active?: boolean }) => u.active !== false);

      // Count working days (excluding weekends) once
      let workingDays = 0;
      const startDateObj = new Date(params.startDate);
      const endDateObj = new Date(params.endDate);
      for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
        const day = d.getDay();
        if (day !== 0 && day !== 6) workingDays++;
      }
      const capacityPerUser = Math.round(workingDays * dailyH * 100) / 100;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userRows: Array<Record<string, any>> = [];
      let totalPlanned = 0;
      const scope = await taskScope();

      for (const m of members) {
        const result = await getTasks({
          userId: m.id,
          startDate: params.startDate,
          endDate: params.endDate,
          page: 1,
          limit: 500,
        }, scope);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tasks = ((result as any).data || []) as any[];
        let plannedHours = 0;
        for (const t of tasks) {
          plannedHours += calculateTaskHours({
            startDate: t.startDate,
            endDate: t.endDate,
            startTime: t.startTime,
            endTime: t.endTime,
            duration: t.duration,
            breakDuration: t.breakDuration,
            realDuration: t.realDuration,
          }, dailyH);
        }
        plannedHours = Math.round(plannedHours * 100) / 100;
        totalPlanned += plannedHours;

        const occupancy = capacityPerUser > 0 ? Math.round((plannedHours / capacityPerUser) * 100) : 0;
        userRows.push({
          userId: m.id,
          userName: [m.firstName, m.name].filter(Boolean).join(" ") || m.name,
          capacityHours: capacityPerUser,
          plannedHours,
          availableHours: Math.round((capacityPerUser - plannedHours) * 100) / 100,
          occupancyRate: `${occupancy}%`,
          tasksCount: tasks.length,
        });
      }

      const totalCapacity = Math.round(members.length * capacityPerUser * 100) / 100;
      totalPlanned = Math.round(totalPlanned * 100) / 100;
      const avgOccupancy = totalCapacity > 0 ? Math.round((totalPlanned / totalCapacity) * 100) : 0;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            teamId: params.teamId,
            teamName: (team as { name?: string }).name,
            period: { startDate: params.startDate, endDate: params.endDate },
            workingDays,
            dailyHours: dailyH,
            memberCount: members.length,
            users: userRows,
            teamSummary: {
              totalCapacityHours: totalCapacity,
              totalPlannedHours: totalPlanned,
              totalAvailableHours: Math.round((totalCapacity - totalPlanned) * 100) / 100,
              averageOccupancyRate: `${avgOccupancy}%`,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── Statistics ───

  readTool(
    "stats-users",
    "User statistics over a period: hours worked, occupancy rate, breakdown by user, user × project matrix. In the team breakdown, teamId and teamName are null for users without a team; laborTypeName is null for a deleted labour type",
    {
      startDate: z.string().describe(START_DATE),
      endDate: z.string().describe(END_DATE),
      userIds: z.array(z.string()).optional().describe("Filter by users"),
      teamIds: z.array(z.string()).optional().describe("Filter by teams"),
      granularity: z.enum(["day", "week", "month"]).default("month").describe("Granularity"),
    },
    async (params) => {
      requirePerm(perms, "pages:stats_users");
      // Same scope as /api/stats/users: the caller's business units only
      const result = await getStatsUsers(params, getVisibleBusinessUnitIds(perms));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  readTool(
    "stats-projects",
    "Project statistics over a period: progress, hours vs budget, monthly breakdown, projects by status, timeline. projectsByStatus[].status is one of todo, in_progress, done, archived",
    {
      startDate: z.string().describe(START_DATE),
      endDate: z.string().describe(END_DATE),
      projectIds: z.array(z.string()).optional().describe("Filter by projects"),
      granularity: z.enum(["day", "week", "month"]).default("month").describe("Granularity"),
    },
    async (params) => {
      requirePerm(perms, "pages:stats_projects");
      const result = await getStatsProjects(params, getVisibleBusinessUnitIds(perms));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  readTool(
    "stats-roi",
    "Financial and ROI statistics: profit per project, labour cost, timeline, profitability. laborTypeName is null for a deleted labour type",
    {
      startDate: z.string().describe(START_DATE),
      endDate: z.string().describe(END_DATE),
      projectIds: z.array(z.string()).optional().describe("Filter by projects"),
    },
    async (params) => {
      requirePerm(perms, "pages:stats_roi");
      const result = await getStatsRoi(params, getVisibleBusinessUnitIds(perms));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ─── Vehicles ───

  readTool(
    "list-vehicles",
    "Search and list vehicles with type, registration and status (available/maintenance/out of service)",
    {},
    async () => {
      requirePerm(perms, "pages:vehicles");
      const result = await getVehicles();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  readTool(
    "get-vehicle-assignments",
    "Assignments of a vehicle over a period",
    {
      vehicleId: z.string().describe("Vehicle ID"),
      startDate: z.string().optional().describe(START_DATE),
      endDate: z.string().optional().describe(END_DATE),
    },
    async (params) => {
      requirePerm(perms, "pages:vehicles");
      const result = await getVehicleAssignments(params.vehicleId, params.startDate, params.endDate);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  readTool(
    "check-vehicle-conflicts",
    "Check a vehicle's booking conflicts",
    {
      vehicleId: z.string().describe("Vehicle ID"),
      startDate: z.string().describe(START_DATE),
      endDate: z.string().describe(END_DATE),
      excludeAssignmentId: z.string().optional().describe("Assignment ID to exclude"),
    },
    async (params) => {
      requirePerm(perms, "pages:vehicles");
      const conflicts = await checkConflicts(params.vehicleId, params.startDate, params.endDate, params.excludeAssignmentId);
      return { content: [{ type: "text" as const, text: JSON.stringify(conflicts, null, 2) }] };
    }
  );

  // ─── Resources ───

  readTool(
    "list-resources",
    "Search and list resources/equipment with type, serial number and status (available/maintenance/out of service)",
    {},
    async () => {
      requirePerm(perms, "pages:resources");
      const { getResources: getRes } = await import("@/lib/services/resource-service");
      const result = await getRes();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  readTool(
    "get-resource-assignments",
    "Assignments of a resource over a period",
    {
      resourceId: z.string().describe("Resource ID"),
      startDate: z.string().optional().describe(START_DATE),
      endDate: z.string().optional().describe(END_DATE),
    },
    async (params) => {
      requirePerm(perms, "pages:resources");
      const { getResourceAssignments: getResAssign } = await import("@/lib/services/resource-assignment-service");
      const result = await getResAssign(params.resourceId, params.startDate, params.endDate);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  readTool(
    "check-resource-conflicts",
    "Check a resource's booking conflicts",
    {
      resourceId: z.string().describe("Resource ID"),
      startDate: z.string().describe(START_DATE),
      endDate: z.string().describe(END_DATE),
      excludeAssignmentId: z.string().optional().describe("Assignment ID to exclude"),
    },
    async (params) => {
      requirePerm(perms, "pages:resources");
      const { checkConflicts: checkResConflicts } = await import("@/lib/services/resource-assignment-service");
      const conflicts = await checkResConflicts(params.resourceId, params.startDate, params.endDate, params.excludeAssignmentId);
      return { content: [{ type: "text" as const, text: JSON.stringify(conflicts, null, 2) }] };
    }
  );

  // ─── Vehicle types ───

  readTool(
    "list-vehicle-types",
    "Search and list vehicle types/categories (lorry, van, car, etc.)",
    {},
    async () => {
      requirePerm(perms, "pages:vehicle_types");
      const { getVehicleTypes } = await import("@/lib/services/vehicle-type-service");
      const result = await getVehicleTypes();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ─── Resource types ───

  readTool(
    "list-resource-types",
    "Search and list resource and equipment types/categories",
    {},
    async () => {
      requirePerm(perms, "pages:resource_types");
      const { getResourceTypes } = await import("@/lib/services/resource-type-service");
      const result = await getResourceTypes();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ─── Business Units ───

  readTool(
    "list-business-units",
    "Search and list the company's business units (BUs, entities, branches)",
    {},
    async () => {
      if (!hasPermission(perms, "pages:business_units")) {
        throw new ToolDeniedError("mcpTools.errors.businessUnitsPermissionRequired");
      }
      const { getBusinessUnits } = await import("@/lib/services/business-unit-service");
      const { getVisibleBusinessUnitIds } = await import("@/lib/services/permission-service");
      let result = await getBusinessUnits();
      const visibleIds = getVisibleBusinessUnitIds(perms);
      if (visibleIds) {
        const visibleSet = new Set(visibleIds);
        result = result.filter((bu: { id: string }) => visibleSet.has(bu.id));
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ─── Labor types ───

    readTool(
    "list-labor-types",
    "Search and list labour types (work categories: operative, technician, engineer, etc.)",
    {},
    async () => {
      requirePerm(perms, "pages:labor_types");
      const { getLaborTypes } = await import("@/lib/services/labor-type-service");
      const result = await getLaborTypes();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ─── Reference data ───

  readTool(
    "list-statuses",
    "Search and list the available task statuses (in progress, done, cancelled, etc.)",
    {},
    async () => {
      requirePerm(perms, "pages:projects");
      const result = await getStatuses();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  readTool(
    "list-holidays",
    "Search and list the public holidays configured over a period",
    {
      startDate: z.string().optional().describe(START_DATE),
      endDate: z.string().optional().describe(END_DATE),
    },
    async (params) => {
      requirePerm(perms, "pages:holidays");
      const result = await getHolidays(params.startDate, params.endDate);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ─── Config / Info ───

  readTool(
    "get-app-info",
    "Application information (name, time zone, working hours, enabled modules)",
    {},
    async () => {
      const config = await getConfigValues([
        "APP_TITLE", "TIMEZONE", "AM_START", "AM_END", "PM_START", "PM_END",
        "DURATION_DAY", "MODULE_PLACES", "MODULE_RESOURCES", "MODULE_TASKS",
      ]);
      const dur = config.DURATION_DAY || "07:30";
      const [h, m] = dur.split(":").map(Number);
      const enriched = {
        ...config,
        dailyHoursDecimal: h + (m || 0) / 60,
        hoursCalculationRule: "For each task: realDuration (if set) > startTime/endTime - break > duration > number of days × hours per day (DURATION_DAY). Tasks with neither times nor duration use DURATION_DAY per working day.",
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    }
  );

  readTool(
    "list-places",
    "Search and list the available places, work sites and work addresses",
    {},
    async () => {
      requirePerm(perms, "pages:places");
      const result = await getPlaces();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  return {
    setPermissions(next: UserPermissions) {
      perms = next;
    },
  };
}
