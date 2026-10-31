import { db } from "@/db";
import { tasks, taskUsers, users, projects, places, resources, teams, projectGroups, vehicleAssignments, vehicles, businessUnits, laborTypes, projectLaborBudgets } from "@/db/schema";
import { calculateTaskHours, calculateTaskHoursInPeriod } from "@/lib/utils/hours";
import { getTodayInTimezone, formatWithLocale, parseISO } from "@/lib/utils/dates";
import { getConfigValues } from "@/lib/services/config-service";
import { holidays as holidaysTable } from "@/db/schema/holidays";
import { eq, ne, and, gte, lte, inArray, sql, type SQL } from "drizzle-orm";
import {
  getProjectReadScope,
  getTaskAccessScope,
  getVisibleBusinessUnitIds,
  getVisibleProjectIds,
  getVisibleUserIds,
  hasPermission,
  isProjectInReadScope,
  restrictToScope,
  type ProjectReadScope,
  type TaskAccessScope,
  type UserPermissions,
} from "@/lib/services/permission-service";
import { AppError } from "@/lib/errors";
import { isEquipmentVisible } from "@/lib/services/equipment-scope";
import type { SortMode, ViewMode, CalendarMode } from "@/lib/types/planning";
import { sortAndGroupRows, type PlanningRow, type GridRow, type NoneGroupLabels } from "@/lib/utils/sort-rows";
import { INTL_TAG, type AppLocale } from "@/i18n/config";
import { translateKey, type ServerTranslator } from "@/i18n/server-translator";

// i18n-dynamic: exportFiles.common.assignmentTypes.*

/**
 * Texts and sorting that depend on the export language (request language),
 * built by the routes with `buildExportI18n(t, locale)`. The service thus
 * produces no label hardcoded in a language.
 */
export interface ExportI18n {
  locale: AppLocale;
  /** Sort tag (`INTL_TAG[locale]`). */
  collatorLocale: string;
  /** Headers of rows without team / group / type / BU. */
  noneLabels: NoneGroupLabels;
  /** Label of an unnamed public holiday. */
  holidayLabel: string;
  /** Vehicle assignment type (`task`, `maintenance`, `reservation`). */
  assignmentTypeLabel: (type: string) => string;
}

export function buildExportI18n(t: ServerTranslator, locale: AppLocale): ExportI18n {
  return {
    locale,
    collatorLocale: INTL_TAG[locale],
    noneLabels: {
      noTeam: t("exportFiles.rows.noTeam"),
      noGroup: t("exportFiles.rows.noGroup"),
      noType: t("exportFiles.rows.noType"),
      noBu: t("exportFiles.rows.noBu"),
    },
    holidayLabel: t("exportFiles.common.holiday"),
    assignmentTypeLabel: (type) => translateKey(t, `exportFiles.common.assignmentTypes.${type}`) ?? type,
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Abbreviated day of a `YYYY-MM-DD` date, without trailing period: « Lun », « Mar »… / « Mon », « Tue »… */
export function shortDayName(day: string, locale: AppLocale): string {
  return capitalize(formatWithLocale(parseISO(day), "EEE", locale).replace(/\.$/, ""));
}

/** Full day of a `YYYY-MM-DD` date: « Lundi 1 mars » / « Monday 1 March ». */
export function longDayLabel(day: string, locale: AppLocale): string {
  return capitalize(formatWithLocale(parseISO(day), "EEEE d MMMM", locale));
}

export interface ExportFilters {
  viewMode: ViewMode;
  startDate: string;
  endDate: string;
  sortMode?: SortMode;
  cellContent?: "project" | "title" | "user-name" | "user-login";
  excludeWeekends?: boolean;
  teamIds?: string[];
  userIds?: string[];
  projectIds?: string[];
  statusIds?: string[];
  placeIds?: string[];
  resourceIds?: string[];
  businessUnitIds?: string[];
  includeStats?: boolean;
  calendarMode?: CalendarMode;
  calendarUserId?: string;
  selectedDay?: string;
  calendarDays?: number;
}

// ── Stats for export (projects × users + budgets) ────────────────────────────

export interface ExportProjectStat {
  projectId: string;
  projectName: string;
  projectColor: string | null;
  groupName: string | null;
  // Hours within the export period
  totalHours: number;
  consumedHours: number;   // tasks in period already past
  upcomingHours: number;   // tasks in period still future
  taskCount: number;
  userCount: number;
  // Budget — computed over the ENTIRE project lifetime (not period-limited)
  budgets: ExportProjectBudget[];
}

export interface ExportProjectBudget {
  laborTypeId: string;
  laborTypeName: string;
  laborTypeInitials: string;
  plannedHours: number;
  totalConsumed: number; // lifetime past
  totalUpcoming: number; // lifetime future
  remaining: number;     // plannedHours - (totalConsumed + totalUpcoming)
}

export interface ExportUserProjectStat {
  projectId: string;
  projectName: string;
  projectColor: string | null;
  userId: string;
  userName: string;
  laborTypeName: string | null;
  hours: number;
}

export interface ExportStatsData {
  projects: ExportProjectStat[];
  usersByProject: ExportUserProjectStat[];
  period: { startDate: string; endDate: string };
  // Grand totals across all projects for the export period
  totals: {
    totalHours: number;
    consumedHours: number;
    upcomingHours: number;
    totalProjects: number;
    totalUsers: number;
    totalTasks: number;
  };
  // Lifetime budget totals (across all projects that have a budget)
  budgetTotals: {
    plannedHours: number;
    lifetimeConsumed: number;
    lifetimeUpcoming: number;
    remaining: number;
  };
  // Kept for backwards compatibility
  totalHours: number;
  totalProjects: number;
}

export interface ExportRow {
  id: string;
  label: string;
  color?: string;
  type: "row" | "header";
  // For sorting
  teamId?: string | null;
  teamName?: string | null;
  teamColor?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  groupColor?: string | null;
  sortOrder?: number;
  groupSortOrder?: number;
}

export interface ExportTask {
  id: string;
  title: string | null;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  link: string | null;
  isMilestone: boolean | null;
  files: { id: string; name: string; originalName: string; size: number; mimeType: string; uploadedAt: string; uploadedBy?: string }[] | null;
  project: { id: string; name: string; color: string | null } | null;
  status: { id: string; name: string; color: string | null; bold: boolean | null; italic: boolean | null; strikethrough: boolean | null; underline: boolean | null } | null;
  place: { id: string; name: string } | null;
  resource: { id: string; name: string } | null;
  users: { id: string; name: string; username: string | null }[];
  // Vehicle export fields (only present in vehicle mode)
  vehicleId?: string;
  vehicleName?: string;
  vehicleTypeName?: string;
  assignmentType?: string;
}

export interface ExportData {
  rows: ExportRow[];
  tasks: ExportTask[];
  holidays: Map<string, { label: string; color: string }>; // YYYY-MM-DD → { label, color }
  dateRange: { start: Date; end: Date; days: string[] };
  metadata: { exportedAt: Date; exportedBy: string; filters: ExportFilters };
}

function getDaysBetween(start: Date, end: Date, excludeWeekends = false): string[] {
  const days: string[] = [];
  // Use UTC-only operations to avoid timezone/DST issues
  let ts = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endTs = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  while (ts <= endTs) {
    const d = new Date(ts);
    if (!excludeWeekends || (d.getUTCDay() !== 0 && d.getUTCDay() !== 6)) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      days.push(`${y}-${m}-${day}`);
    }
    ts += 86400000;
  }
  return days;
}

interface RawTaskWithRelations {
  id: string;
  title: string | null;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  link: string | null;
  isMilestone: boolean | null;
  files: ExportTask["files"];
  project: { id: string; name: string; color: string | null } | null;
  status: { id: string; name: string; color: string | null; bold: boolean | null; italic: boolean | null; strikethrough: boolean | null; underline: boolean | null } | null;
  place: { id: string; name: string } | null;
  resource: { id: string; name: string } | null;
  taskUsers: { user: { id: string; name: string; firstName?: string | null; username: string | null } }[];
}

function mapTaskWithUsers(task: RawTaskWithRelations): ExportTask {
  const tu = task.taskUsers?.map(t => ({ id: t.user.id, name: [t.user.firstName, t.user.name].filter(Boolean).join(" "), username: t.user.username ?? null })).filter(Boolean) ?? [];
  return {
    id: task.id,
    title: task.title,
    startDate: task.startDate,
    endDate: task.endDate,
    startTime: task.startTime,
    endTime: task.endTime,
    notes: task.notes,
    link: task.link,
    isMilestone: task.isMilestone,
    files: task.files,
    project: task.project ? { id: task.project.id, name: task.project.name, color: task.project.color } : null,
    status: task.status ? {
      id: task.status.id, name: task.status.name, color: task.status.color,
      bold: task.status.bold, italic: task.status.italic,
      strikethrough: task.status.strikethrough, underline: task.status.underline,
    } : null,
    place: task.place ? { id: task.place.id, name: task.place.name } : null,
    resource: task.resource ? { id: task.resource.id, name: task.resource.name } : null,
    users: tu,
  };
}

/**
 * What an export may contain for the caller: the tasks of `GET /api/tasks`
 * and the rows of the planning (visible users / projects). `null` = no restriction.
 */
interface ExportScope {
  taskScope: TaskAccessScope;
  userIds: Set<string> | null;
  projectIds: Set<string> | null;
}

async function getExportScope(perms: UserPermissions): Promise<ExportScope> {
  const [taskScope, userIds, projectIds] = await Promise.all([
    getTaskAccessScope(perms),
    getVisibleUserIds(perms),
    getVisibleProjectIds(perms),
  ]);
  return {
    taskScope,
    userIds: userIds && new Set(userIds),
    projectIds: projectIds && new Set(projectIds),
  };
}

/** SQL conditions keeping the tasks of the read scope (same rule as `getTasks`). */
function taskScopeConditions(scope: TaskAccessScope): SQL[] {
  const conditions: SQL[] = [];
  if (scope.accessibleProjectIds !== null) {
    if (scope.accessibleProjectIds.length === 0) return [sql`false`];
    conditions.push(inArray(tasks.projectId, scope.accessibleProjectIds));
  }
  if (scope.accessibleUserIds !== null) {
    if (scope.accessibleUserIds.length === 0) return [sql`false`];
    // At least one visible assignee (a task without assignees stays hidden)
    conditions.push(inArray(
      tasks.id,
      db.select({ id: taskUsers.taskId }).from(taskUsers).where(inArray(taskUsers.userId, scope.accessibleUserIds)),
    ));
  }
  return conditions;
}

/** True if `id` is allowed by a visibility set (`null` = everything). */
function isVisible(visibleIds: Set<string> | null, id: string): boolean {
  return visibleIds === null || visibleIds.has(id);
}

/**
 * Planning export data. `perms` restricts it to what the caller sees on the
 * planning: readable tasks, visible user / project rows.
 */
export async function getExportData(filters: ExportFilters, exportedBy: string, i18n: ExportI18n, perms: UserPermissions): Promise<ExportData> {
  const scope = await getExportScope(perms);
  // Override date range for calendar modes
  let effectiveStartDate = filters.startDate;
  let effectiveEndDate = filters.endDate;

  if (filters.calendarMode === "team-day" && filters.selectedDay) {
    effectiveStartDate = filters.selectedDay;
    effectiveEndDate = filters.selectedDay;
  }

  // Overlap condition: task overlaps the date range
  // taskStart <= filterEnd AND COALESCE(taskEnd, taskStart) >= filterStart
  const conditions = [
    lte(tasks.startDate, effectiveEndDate),
    sql`COALESCE(${tasks.endDate}, ${tasks.startDate}) >= ${effectiveStartDate}`,
    ...taskScopeConditions(scope.taskScope),
  ];

  if (filters.projectIds?.length) {
    conditions.push(inArray(tasks.projectId, filters.projectIds));
  }
  if (filters.statusIds?.length) {
    conditions.push(inArray(tasks.statusId, filters.statusIds));
  }
  if (filters.placeIds?.length) {
    conditions.push(inArray(tasks.placeId, filters.placeIds));
  }
  if (filters.resourceIds?.length) {
    conditions.push(inArray(tasks.resourceId, filters.resourceIds));
  }

  // Filter by calendarUserId for personal calendar mode
  if (filters.calendarMode === "personal" && filters.calendarUserId) {
    if (!isVisible(scope.userIds, filters.calendarUserId)) {
      return emptyResult({ ...filters, startDate: effectiveStartDate, endDate: effectiveEndDate }, exportedBy);
    }
    const userTaskRows = await db.select({ taskId: taskUsers.taskId })
      .from(taskUsers)
      .where(eq(taskUsers.userId, filters.calendarUserId));
    const taskIdsForUser = userTaskRows.map(r => r.taskId);
    if (taskIdsForUser.length === 0) {
      return emptyResult({ ...filters, startDate: effectiveStartDate, endDate: effectiveEndDate }, exportedBy);
    }
    conditions.push(inArray(tasks.id, taskIdsForUser));
  }

  // Filter by userIds (via task_users junction)
  if (filters.userIds?.length) {
    const userTaskRows = await db.select({ taskId: taskUsers.taskId })
      .from(taskUsers)
      .where(inArray(taskUsers.userId, filters.userIds));
    const taskIdsForUsers = userTaskRows.map(r => r.taskId);
    if (taskIdsForUsers.length === 0) {
      return emptyResult(filters, exportedBy);
    }
    conditions.push(inArray(tasks.id, taskIdsForUsers));
  }

  // Filter by teamIds → find userIds in those teams, then filter
  if (filters.teamIds?.length) {
    const teamUserRows = await db.select({ id: users.id })
      .from(users)
      .where(and(inArray(users.teamId, filters.teamIds), eq(users.active, true)));
    const teamUserIds = teamUserRows.map(r => r.id);
    if (teamUserIds.length === 0) {
      return emptyResult(filters, exportedBy);
    }
    const userTaskRows = await db.select({ taskId: taskUsers.taskId })
      .from(taskUsers)
      .where(inArray(taskUsers.userId, teamUserIds));
    const taskIdsForTeams = userTaskRows.map(r => r.taskId);
    if (taskIdsForTeams.length === 0) {
      return emptyResult(filters, exportedBy);
    }
    conditions.push(inArray(tasks.id, taskIdsForTeams));
  }

  const rawTasks = await db.query.tasks.findMany({
    where: and(...conditions),
    with: {
      project: true,
      status: true,
      place: true,
      resource: true,
      taskUsers: { with: { user: true } },
    },
    orderBy: (tasks, { asc }) => [asc(tasks.startDate)],
  });

  const exportTasks = rawTasks.map(mapTaskWithUsers);

  // Build rows based on viewMode
  let planningRows: PlanningRow[] = [];

  switch (filters.viewMode) {
    case "users": {
      // Personal calendar mode: single user row
      if (filters.calendarMode === "personal" && filters.calendarUserId) {
        const calUser = await db.select({
          id: users.id,
          name: users.name,
          firstName: users.firstName,
          color: users.color,
          teamId: users.teamId,
          sortOrder: users.sortOrder,
          teamName: teams.name,
          teamColor: teams.color,
          teamSortOrder: teams.sortOrder,
          businessUnitId: users.businessUnitId,
          businessUnitName: businessUnits.name,
          businessUnitColor: businessUnits.color,
        })
          .from(users)
          .leftJoin(teams, eq(users.teamId, teams.id))
          .leftJoin(businessUnits, eq(users.businessUnitId, businessUnits.id))
          .where(eq(users.id, filters.calendarUserId));

        planningRows = calUser.map(u => ({
          id: u.id,
          name: [u.firstName, u.name].filter(Boolean).join(" ") || u.name,
          type: "row" as const,
          teamId: u.teamId,
          teamName: u.teamName,
          teamColor: u.teamColor,
          teamSortOrder: u.teamSortOrder ?? 0,
          sortOrder: u.sortOrder ?? 0,
          businessUnitId: u.businessUnitId,
          businessUnitName: u.businessUnitName,
          businessUnitColor: u.businessUnitColor,
          color: u.color,
        }));
        break;
      }

      const allUsers = await db.select({
        id: users.id,
        name: users.name,
        firstName: users.firstName,
        color: users.color,
        teamId: users.teamId,
        sortOrder: users.sortOrder,
        teamName: teams.name,
        teamColor: teams.color,
        teamSortOrder: teams.sortOrder,
        businessUnitId: users.businessUnitId,
        businessUnitName: businessUnits.name,
        businessUnitColor: businessUnits.color,
      })
        .from(users)
        .leftJoin(teams, eq(users.teamId, teams.id))
        .leftJoin(businessUnits, eq(users.businessUnitId, businessUnits.id))
        .where(eq(users.active, true));

      planningRows = allUsers
        .filter(u => {
          if (!isVisible(scope.userIds, u.id)) return false;
          if (filters.userIds?.length && !filters.userIds.includes(u.id)) return false;
          if (filters.teamIds?.length && (!u.teamId || !filters.teamIds.includes(u.teamId))) return false;
          // BU filter — strict: user must belong to selected BU (users without BU are hidden)
          if (filters.businessUnitIds?.length && (!u.businessUnitId || !filters.businessUnitIds.includes(u.businessUnitId))) return false;
          return true;
        })
        .map(u => ({
          id: u.id,
          name: [u.firstName, u.name].filter(Boolean).join(" ") || u.name,
          type: "row" as const,
          teamId: u.teamId,
          teamName: u.teamName,
          teamColor: u.teamColor,
          teamSortOrder: u.teamSortOrder ?? 0,
          sortOrder: u.sortOrder ?? 0,
          businessUnitId: u.businessUnitId,
          businessUnitName: u.businessUnitName,
          businessUnitColor: u.businessUnitColor,
          color: u.color,
        }));
      break;
    }
    case "projects": {
      const allProjects = await db.select({
        id: projects.id,
        name: projects.name,
        color: projects.color,
        groupId: projects.groupId,
        sortOrder: projects.sortOrder,
        groupName: projectGroups.name,
        groupColor: projectGroups.color,
        groupSortOrder: projectGroups.sortOrder,
        businessUnitId: projects.businessUnitId,
      })
        .from(projects)
        .leftJoin(projectGroups, eq(projects.groupId, projectGroups.id))
        .where(ne(projects.status, "archived"));

      planningRows = allProjects
        .filter(p => {
          if (!isVisible(scope.projectIds, p.id)) return false;
          if (filters.projectIds?.length && !filters.projectIds.includes(p.id)) return false;
          // BU filter — strict: project must belong to selected BU (projects without BU are hidden)
          if (filters.businessUnitIds?.length && (!p.businessUnitId || !filters.businessUnitIds.includes(p.businessUnitId))) return false;
          return true;
        })
        .map(p => ({
          id: p.id,
          name: p.name,
          type: "row" as const,
          groupId: p.groupId,
          groupName: p.groupName,
          groupColor: p.groupColor,
          groupSortOrder: p.groupSortOrder ?? 0,
          sortOrder: p.sortOrder ?? 0,
          businessUnitId: p.businessUnitId,
          color: p.color,
        }));
      break;
    }
    case "places": {
      const allPlaces = await db.select().from(places);
      planningRows = allPlaces
        .filter(p => !filters.placeIds?.length || filters.placeIds.includes(p.id))
        .map(p => ({ id: p.id, name: p.name, type: "row" as const, color: p.color }));
      break;
    }
    case "resources": {
      const allResources = await db.select().from(resources);
      planningRows = allResources
        .filter(r => !filters.resourceIds?.length || filters.resourceIds.includes(r.id))
        .map(r => ({ id: r.id, name: r.name, type: "row" as const, color: r.color }));
      break;
    }
    case "vehicles": {
      const businessUnitIds = getVehicleExportBusinessUnits(filters, perms);
      const allVehicles = await db.select().from(vehicles);
      planningRows = allVehicles
        .filter(v => isEquipmentVisible(v, businessUnitIds))
        .map(v => ({ id: v.id, name: v.name, type: "row" as const, color: v.color }));
      break;
    }
  }

  // Apply sorting with group/team headers
  const sortMode = filters.sortMode || "name-asc";
  const sortedGridRows = sortAndGroupRows(planningRows, sortMode, filters.viewMode, {
    labels: i18n.noneLabels,
    collatorLocale: i18n.collatorLocale,
  });

  // Convert to ExportRow (keeping header rows)
  const exportRows: ExportRow[] = sortedGridRows.map(row => {
    if (row.type === "header") {
      return { id: row.id, label: row.name, color: row.color, type: "header" };
    }
    return {
      id: row.id,
      label: row.name,
      color: (row as PlanningRow).color as string | undefined,
      type: "row",
      teamId: (row as PlanningRow).teamId as string | undefined,
      teamName: (row as PlanningRow).teamName as string | undefined,
      teamColor: (row as PlanningRow).teamColor as string | undefined,
      groupId: (row as PlanningRow).groupId as string | undefined,
      groupName: (row as PlanningRow).groupName as string | undefined,
      groupColor: (row as PlanningRow).groupColor as string | undefined,
      sortOrder: (row as PlanningRow).sortOrder as number | undefined,
    };
  });

  const start = new Date(effectiveStartDate);
  const end = new Date(effectiveEndDate);
  const holidayDates = await loadHolidays(effectiveStartDate, effectiveEndDate, i18n.holidayLabel);

  return {
    rows: exportRows,
    tasks: exportTasks,
    holidays: holidayDates,
    dateRange: { start, end, days: getDaysBetween(start, end, filters.excludeWeekends) },
    metadata: { exportedAt: new Date(), exportedBy, filters },
  };
}

async function loadHolidays(startDate: string, endDate: string, defaultLabel: string): Promise<Map<string, { label: string; color: string }>> {
  const rows = await db.select({ date: holidaysTable.date, label: holidaysTable.label, color: holidaysTable.color })
    .from(holidaysTable)
    .where(and(gte(holidaysTable.date, startDate), lte(holidaysTable.date, endDate)));
  const map = new Map<string, { label: string; color: string }>();
  for (const r of rows) {
    map.set(r.date, { label: r.label || defaultLabel, color: r.color || "#ff0000" });
  }
  return map;
}

function emptyResult(filters: ExportFilters, exportedBy: string): ExportData {
  return {
    rows: [],
    tasks: [],
    holidays: new Map(),
    dateRange: {
      start: new Date(filters.startDate),
      end: new Date(filters.endDate),
      days: getDaysBetween(new Date(filters.startDate), new Date(filters.endDate), filters.excludeWeekends),
    },
    metadata: { exportedAt: new Date(), exportedBy, filters },
  };
}

// ── Vehicles ─────────────────────────────────────────────────────────────────

/**
 * Business units whose vehicles the caller may export, as on the planning
 * vehicle view: the selected ones (`filters.businessUnitIds`) within the
 * caller's BU scope (`isEquipmentVisible`); `null` = every vehicle. That view
 * needs `planning:view_vehicles`, so does its export.
 */
export function getVehicleExportBusinessUnits(filters: ExportFilters, perms: UserPermissions): string[] | null {
  if (!hasPermission(perms, "planning:view_vehicles")) throw new AppError("errors.forbidden");
  return restrictToScope(filters.businessUnitIds, getVisibleBusinessUnitIds(perms));
}

/** A vehicle assignment as loaded by `getVehicleExportData`. */
export interface VehicleAssignmentRow {
  id: string;
  vehicleId: string;
  type: string;
  notes: string | null;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  vehicle: { name: string; vehicleType: { name: string } | null } | null;
  project: { id: string; name: string; color: string | null; businessUnitId: string | null } | null;
  assignedByUser: { id: string; name: string; username: string | null } | null;
}

/**
 * Export row of a vehicle assignment. A vehicle of the caller's scope can be
 * booked for a project of another business unit: that project (name, colour)
 * only shows when the caller may read it, otherwise the row reads like a
 * booking without project.
 */
export function mapVehicleAssignment(
  a: VehicleAssignmentRow,
  assignmentTypeLabel: ExportI18n["assignmentTypeLabel"],
  projectScope: ProjectReadScope,
): ExportTask {
  const project = a.project && isProjectInReadScope(a.project, projectScope) ? a.project : null;
  const typeLabel = assignmentTypeLabel(a.type);
  const title = project ? project.name : `${typeLabel}${a.notes ? ` — ${a.notes}` : ""}`;

  return {
    id: a.id,
    title,
    startDate: a.startDate,
    endDate: a.endDate,
    startTime: a.startTime,
    endTime: a.endTime,
    notes: a.notes,
    link: null,
    isMilestone: false,
    files: null,
    project: project ? { id: project.id, name: project.name, color: project.color } : null,
    status: null,
    place: null,
    resource: null,
    users: a.assignedByUser ? [{ id: a.assignedByUser.id, name: a.assignedByUser.name, username: a.assignedByUser.username ?? null }] : [],
    // Extra fields for vehicle export
    vehicleId: a.vehicleId,
    vehicleName: a.vehicle?.name ?? "",
    vehicleTypeName: a.vehicle?.vehicleType?.name ?? "",
    assignmentType: a.type,
  };
}

/**
 * Vehicle export data, restricted like the planning vehicle view: the vehicles
 * of `getVehicleExportBusinessUnits`, their assignments only, and the projects
 * the caller may read (`mapVehicleAssignment`).
 */
export async function getVehicleExportData(filters: ExportFilters, exportedBy: string, i18n: ExportI18n, perms: UserPermissions): Promise<ExportData> {
  const effectiveStartDate = filters.startDate;
  const effectiveEndDate = filters.endDate;
  const businessUnitIds = getVehicleExportBusinessUnits(filters, perms);
  const projectScope = await getProjectReadScope(perms);

  // Vehicle rows (a small table: filtered here with the rule above)
  const allVehicles = (await db.query.vehicles.findMany({
    with: { vehicleType: true },
    orderBy: (v, { asc }) => [asc(v.name)],
  })).filter(v => isEquipmentVisible(v, businessUnitIds));
  const vehicleIds = allVehicles.map(v => v.id);

  // Assignments of those vehicles overlapping the date range
  const rawAssignments = vehicleIds.length === 0 ? [] : await db.query.vehicleAssignments.findMany({
    where: and(
      lte(vehicleAssignments.startDate, effectiveEndDate),
      gte(vehicleAssignments.endDate, effectiveStartDate),
      inArray(vehicleAssignments.vehicleId, vehicleIds),
    ),
    with: {
      vehicle: { columns: { name: true }, with: { vehicleType: { columns: { name: true } } } },
      project: { columns: { id: true, name: true, color: true, businessUnitId: true } },
      assignedByUser: { columns: { id: true, name: true, username: true } },
    },
    orderBy: (va, { asc }) => [asc(va.startDate)],
  });

  const exportTasks: ExportTask[] = rawAssignments.map(a => mapVehicleAssignment(a, i18n.assignmentTypeLabel, projectScope));

  const sortMode = filters.sortMode || "name-asc";
  const sortedVehicles = [...allVehicles];
  if (sortMode === "name-desc") {
    sortedVehicles.sort((a, b) => b.name.localeCompare(a.name));
  } else if (sortMode === "type-name-asc") {
    sortedVehicles.sort((a, b) => (a.vehicleType?.name ?? "").localeCompare(b.vehicleType?.name ?? "") || a.name.localeCompare(b.name));
  } else if (sortMode === "type-name-desc") {
    sortedVehicles.sort((a, b) => (b.vehicleType?.name ?? "").localeCompare(a.vehicleType?.name ?? "") || a.name.localeCompare(b.name));
  }

  const exportRows: ExportRow[] = sortedVehicles.map(v => ({
    id: v.id,
    label: v.name,
    color: v.color,
    type: "row",
  }));

  const start = new Date(effectiveStartDate);
  const end = new Date(effectiveEndDate);

  const vehicleHolidays = await loadHolidays(effectiveStartDate, effectiveEndDate, i18n.holidayLabel);

  return {
    rows: exportRows,
    tasks: exportTasks,
    holidays: vehicleHolidays,
    dateRange: { start, end, days: getDaysBetween(start, end, filters.excludeWeekends) },
    metadata: { exportedAt: new Date(), exportedBy, filters: { ...filters, viewMode: "vehicles" } },
  };
}

export function getTasksForRowAndDay(
  data: ExportData,
  rowId: string,
  day: string
): ExportTask[] {
  return data.tasks.filter(task => {
    const taskStart = task.startDate;
    const taskEnd = task.endDate ?? task.startDate;
    if (day < taskStart || day > taskEnd) return false;

    const isVehicleMode = data.metadata.filters.viewMode === "vehicles";

    if (isVehicleMode) {
      return task.vehicleId === rowId;
    }

    switch (data.metadata.filters.viewMode) {
      case "users":
        return task.users.some(u => u.id === rowId);
      case "projects":
        return task.project?.id === rowId;
      case "places":
        return task.place?.id === rowId;
      case "resources":
        return task.resource?.id === rowId;
      default:
        return false;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Project/user stats for the export (optional PDF/Excel tab)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregates hours consumed and upcoming per project and per user for the given
 * period, plus lifetime budget info per project labor type.
 *
 * Applies the same filters as the main planning export (projectIds, teamIds,
 * userIds, businessUnitIds, statusIds) and the caller's task read scope, so
 * the stats match what's visible on the planning grid.
 */
export async function getProjectStatsForExport(
  filters: ExportFilters,
  i18n: Pick<ExportI18n, "collatorLocale">,
  perms: UserPermissions,
): Promise<ExportStatsData> {
  const config = await getConfigValues(["DURATION_DAY", "TIMEZONE"]);
  const durationDay = config.DURATION_DAY || "07:30";
  const [dh, dm] = durationDay.split(":").map(Number);
  const dailyHours = dh + (dm || 0) / 60;
  const today = getTodayInTimezone(config.TIMEZONE || "Europe/Paris");

  // Compute yesterday (inclusive end of "consumed" period) and today (start of "upcoming" period)
  const todayDate = new Date(`${today}T00:00:00Z`);
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);

  const emptyResponse: ExportStatsData = {
    projects: [],
    usersByProject: [],
    period: { startDate: filters.startDate, endDate: filters.endDate },
    totals: { totalHours: 0, consumedHours: 0, upcomingHours: 0, totalProjects: 0, totalUsers: 0, totalTasks: 0 },
    budgetTotals: { plannedHours: 0, lifetimeConsumed: 0, lifetimeUpcoming: 0, remaining: 0 },
    totalHours: 0,
    totalProjects: 0,
  };

  // ── 1. Resolve allowed user IDs from team/user/BU filters (same as planning) ──
  let allowedUserIds: Set<string> | null = null;
  if (filters.userIds?.length || filters.teamIds?.length || filters.businessUnitIds?.length) {
    const userConditions = [eq(users.active, true)];
    if (filters.userIds?.length) userConditions.push(inArray(users.id, filters.userIds));
    if (filters.teamIds?.length) userConditions.push(inArray(users.teamId, filters.teamIds));
    const candidateUsers = await db
      .select({ id: users.id, businessUnitId: users.businessUnitId })
      .from(users)
      .where(and(...userConditions));
    const filtered = filters.businessUnitIds?.length
      ? candidateUsers.filter(u => u.businessUnitId && filters.businessUnitIds!.includes(u.businessUnitId))
      : candidateUsers;
    allowedUserIds = new Set(filtered.map(u => u.id));
    if (allowedUserIds.size === 0) return emptyResponse;
  }

  // ── 2. Load tasks overlapping the period (optionally filtered by projectIds, statusIds) ──
  const taskConditions = [
    lte(tasks.startDate, filters.endDate),
    sql`COALESCE(${tasks.endDate}, ${tasks.startDate}) >= ${filters.startDate}`,
    ...taskScopeConditions(await getTaskAccessScope(perms)),
  ];
  if (filters.projectIds?.length) taskConditions.push(inArray(tasks.projectId, filters.projectIds));
  if (filters.statusIds?.length) taskConditions.push(inArray(tasks.statusId, filters.statusIds));

  const periodTaskRows = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      startDate: tasks.startDate,
      endDate: tasks.endDate,
      startTime: tasks.startTime,
      endTime: tasks.endTime,
      duration: tasks.duration,
      breakDuration: tasks.breakDuration,
      realDuration: tasks.realDuration,
      userId: taskUsers.userId,
      userName: users.name,
      userFirstName: users.firstName,
      laborTypeId: users.laborTypeId,
      laborTypeName: laborTypes.name,
      projectName: projects.name,
      projectColor: projects.color,
      groupName: projectGroups.name,
      projectBusinessUnitId: projects.businessUnitId,
    })
    .from(tasks)
    .innerJoin(taskUsers, eq(taskUsers.taskId, tasks.id))
    .innerJoin(users, eq(users.id, taskUsers.userId))
    .leftJoin(laborTypes, eq(laborTypes.id, users.laborTypeId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(projectGroups, eq(projectGroups.id, projects.groupId))
    .where(and(...taskConditions, ne(projects.status, "archived")));

  // ── 3. Aggregate per project + per (project × user) — PRORATED over the period ──
  type ProjectAgg = {
    projectId: string;
    projectName: string;
    projectColor: string | null;
    groupName: string | null;
    businessUnitId: string | null;
    taskIds: Set<string>;
    userIds: Set<string>;
    consumed: number;
    upcoming: number;
  };
  type UserProjectAgg = {
    projectId: string;
    userId: string;
    userName: string;
    laborTypeName: string | null;
    hours: number;
  };

  const projectAggs = new Map<string, ProjectAgg>();
  const userProjectAggs = new Map<string, UserProjectAgg>();

  // Consumed window: [periodStart, min(periodEnd, yesterday)]
  // Upcoming window: [max(periodStart, today), periodEnd]
  const consumedWindowEnd = filters.endDate < yesterday ? filters.endDate : yesterday;
  const upcomingWindowStart = filters.startDate > today ? filters.startDate : today;

  for (const row of periodTaskRows) {
    // Apply user-level filters (team / userIds / BU)
    if (allowedUserIds && !allowedUserIds.has(row.userId)) continue;
    // Apply project-level BU filter (rows without BU stay visible — matches /planning rule)
    if (filters.businessUnitIds?.length && row.projectBusinessUnitId && !filters.businessUnitIds.includes(row.projectBusinessUnitId)) continue;

    // PRORATA: hours actually within the export period
    const consumed = calculateTaskHoursInPeriod(row, filters.startDate, consumedWindowEnd, dailyHours);
    const upcoming = calculateTaskHoursInPeriod(row, upcomingWindowStart, filters.endDate, dailyHours);
    const hoursInPeriod = consumed + upcoming;
    if (hoursInPeriod === 0) continue;

    // Project aggregate
    let pAgg = projectAggs.get(row.projectId);
    if (!pAgg) {
      pAgg = {
        projectId: row.projectId,
        projectName: row.projectName,
        projectColor: row.projectColor,
        groupName: row.groupName,
        businessUnitId: row.projectBusinessUnitId,
        taskIds: new Set(),
        userIds: new Set(),
        consumed: 0,
        upcoming: 0,
      };
      projectAggs.set(row.projectId, pAgg);
    }
    pAgg.taskIds.add(row.id);
    pAgg.userIds.add(row.userId);
    pAgg.consumed += consumed;
    pAgg.upcoming += upcoming;

    // User × project aggregate (total hours in the period for this user on this project)
    const key = `${row.projectId}:${row.userId}`;
    let uAgg = userProjectAggs.get(key);
    if (!uAgg) {
      uAgg = {
        projectId: row.projectId,
        userId: row.userId,
        userName: [row.userFirstName, row.userName].filter(Boolean).join(" ") || row.userName,
        laborTypeName: row.laborTypeName,
        hours: 0,
      };
      userProjectAggs.set(key, uAgg);
    }
    uAgg.hours += hoursInPeriod;
  }

  const projectIdsFound = Array.from(projectAggs.keys());
  if (projectIdsFound.length === 0) return emptyResponse;

  // ── 4. Load lifetime task data (all tasks of these projects, no period restriction) for budget calculations ──
  const lifetimeTaskRows = await db
    .select({
      projectId: tasks.projectId,
      startDate: tasks.startDate,
      endDate: tasks.endDate,
      startTime: tasks.startTime,
      endTime: tasks.endTime,
      duration: tasks.duration,
      breakDuration: tasks.breakDuration,
      realDuration: tasks.realDuration,
      laborTypeId: users.laborTypeId,
    })
    .from(tasks)
    .innerJoin(taskUsers, eq(taskUsers.taskId, tasks.id))
    .innerJoin(users, eq(users.id, taskUsers.userId))
    .where(inArray(tasks.projectId, projectIdsFound));

  // Aggregate lifetime hours per (projectId, laborTypeId) → { consumed, upcoming }
  // Note: lifetime numbers are NOT period-limited — they use calculateTaskHours (entire task).
  const lifetimeByProjectLabor = new Map<string, { consumed: number; upcoming: number }>();
  for (const row of lifetimeTaskRows) {
    if (!row.laborTypeId) continue;
    const key = `${row.projectId}:${row.laborTypeId}`;
    const entry = lifetimeByProjectLabor.get(key) ?? { consumed: 0, upcoming: 0 };
    const hours = calculateTaskHours(row, dailyHours);
    const effectiveEnd = row.endDate || row.startDate;
    if (effectiveEnd < today) entry.consumed += hours;
    else entry.upcoming += hours;
    lifetimeByProjectLabor.set(key, entry);
  }

  // ── 5. Load labor budgets for the discovered projects ──
  const budgetRows = await db
    .select({
      projectId: projectLaborBudgets.projectId,
      laborTypeId: projectLaborBudgets.laborTypeId,
      plannedHours: projectLaborBudgets.plannedHours,
      laborTypeName: laborTypes.name,
      laborTypeInitials: laborTypes.initials,
    })
    .from(projectLaborBudgets)
    .innerJoin(laborTypes, eq(laborTypes.id, projectLaborBudgets.laborTypeId))
    .where(inArray(projectLaborBudgets.projectId, projectIdsFound));

  const budgetsByProject = new Map<string, ExportProjectBudget[]>();
  for (const b of budgetRows) {
    const key = `${b.projectId}:${b.laborTypeId}`;
    const lifetime = lifetimeByProjectLabor.get(key) ?? { consumed: 0, upcoming: 0 };
    const planned = parseFloat(b.plannedHours);
    const totalConsumed = Math.round(lifetime.consumed * 100) / 100;
    const totalUpcoming = Math.round(lifetime.upcoming * 100) / 100;
    const remaining = Math.round((planned - totalConsumed - totalUpcoming) * 100) / 100;
    const list = budgetsByProject.get(b.projectId) ?? [];
    list.push({
      laborTypeId: b.laborTypeId,
      laborTypeName: b.laborTypeName,
      laborTypeInitials: b.laborTypeInitials,
      plannedHours: planned,
      totalConsumed,
      totalUpcoming,
      remaining,
    });
    budgetsByProject.set(b.projectId, list);
  }

  // ── 6. Build final shape ──
  const projectStats: ExportProjectStat[] = Array.from(projectAggs.values())
    .map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      projectColor: p.projectColor,
      groupName: p.groupName,
      totalHours: Math.round((p.consumed + p.upcoming) * 100) / 100,
      consumedHours: Math.round(p.consumed * 100) / 100,
      upcomingHours: Math.round(p.upcoming * 100) / 100,
      taskCount: p.taskIds.size,
      userCount: p.userIds.size,
      budgets: (budgetsByProject.get(p.projectId) ?? []).sort((a, b) => a.laborTypeName.localeCompare(b.laborTypeName, i18n.collatorLocale)),
    }))
    .sort((a, b) => b.totalHours - a.totalHours);

  // Decorate user rows with project metadata for convenience
  const projectMeta = new Map(projectStats.map((p) => [p.projectId, { projectName: p.projectName, projectColor: p.projectColor }]));
  const usersByProject: ExportUserProjectStat[] = Array.from(userProjectAggs.values())
    .map((u) => ({
      projectId: u.projectId,
      projectName: projectMeta.get(u.projectId)?.projectName ?? "",
      projectColor: projectMeta.get(u.projectId)?.projectColor ?? null,
      userId: u.userId,
      userName: u.userName,
      laborTypeName: u.laborTypeName,
      hours: Math.round(u.hours * 100) / 100,
    }))
    .sort((a, b) => {
      const cmp = a.projectName.localeCompare(b.projectName, i18n.collatorLocale);
      if (cmp !== 0) return cmp;
      return b.hours - a.hours;
    });

  // Grand totals on the period
  const totalHours = projectStats.reduce((s, p) => s + p.totalHours, 0);
  const consumedHours = projectStats.reduce((s, p) => s + p.consumedHours, 0);
  const upcomingHours = projectStats.reduce((s, p) => s + p.upcomingHours, 0);
  const totalTasks = projectStats.reduce((s, p) => s + p.taskCount, 0);
  const uniqueUsers = new Set(usersByProject.map((u) => u.userId));

  // Budget totals (lifetime across all projects)
  let budgetPlanned = 0;
  let budgetLifetimeConsumed = 0;
  let budgetLifetimeUpcoming = 0;
  for (const p of projectStats) {
    for (const b of p.budgets) {
      budgetPlanned += b.plannedHours;
      budgetLifetimeConsumed += b.totalConsumed;
      budgetLifetimeUpcoming += b.totalUpcoming;
    }
  }
  const budgetRemaining = budgetPlanned - budgetLifetimeConsumed - budgetLifetimeUpcoming;

  return {
    projects: projectStats,
    usersByProject,
    period: { startDate: filters.startDate, endDate: filters.endDate },
    totals: {
      totalHours: Math.round(totalHours * 100) / 100,
      consumedHours: Math.round(consumedHours * 100) / 100,
      upcomingHours: Math.round(upcomingHours * 100) / 100,
      totalProjects: projectStats.length,
      totalUsers: uniqueUsers.size,
      totalTasks,
    },
    budgetTotals: {
      plannedHours: Math.round(budgetPlanned * 100) / 100,
      lifetimeConsumed: Math.round(budgetLifetimeConsumed * 100) / 100,
      lifetimeUpcoming: Math.round(budgetLifetimeUpcoming * 100) / 100,
      remaining: Math.round(budgetRemaining * 100) / 100,
    },
    // Backwards compat
    totalHours: Math.round(totalHours * 100) / 100,
    totalProjects: projectStats.length,
  };
}
