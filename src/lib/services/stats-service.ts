import { db } from "@/db";
import { tasks, taskUsers, users, projects, teams, laborTypes, projectLaborBudgets, holidays } from "@/db/schema";
import { eq, and, gte, lte, inArray, sql, ne } from "drizzle-orm";
import { getConfigValues } from "./config-service";
import { calculateTaskHours } from "@/lib/utils/hours";
import { getTodayInTimezone } from "@/lib/utils/dates";
import { restrictToScope } from "./permission-service";

/**
 * Business units the caller may see (`getVisibleBusinessUnitIds`): `null` =
 * every BU. Required by every statistic, so none aggregates other BUs.
 */
export type StatsBusinessUnitScope = string[] | null;

interface StatsFilters {
  startDate: string;
  endDate: string;
  userIds?: string[];
  teamIds?: string[];
  projectIds?: string[];
  laborTypeIds?: string[];
  businessUnitIds?: string[];
  granularity?: "day" | "week" | "month";
  includeWeekends?: boolean;
  includeHolidays?: boolean;
}

// ─── Helper: get daily hours from config ───
async function getDailyHours() {
  const config = await getConfigValues(["DURATION_DAY", "TIMEZONE", "INCLUDE_WEEKENDS", "INCLUDE_HOLIDAYS"]);
  const dur = config.DURATION_DAY || "07:30";
  const [h, m] = dur.split(":").map(Number);
  return {
    dailyHours: h + (m || 0) / 60,
    timezone: config.TIMEZONE || "Europe/Paris",
    includeWeekends: config.INCLUDE_WEEKENDS === "true",
    includeHolidays: config.INCLUDE_HOLIDAYS === "true",
  };
}

// ─── Helper: get working days in range ───
function getWorkingDaysCount(start: string, end: string, holidayDates: Set<string>, includeWeekends = false, includeHolidays = false): number {
  let count = 0;
  const s = new Date(start);
  const e = new Date(end);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    const dateStr = d.toISOString().split("T")[0];
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidayDates.has(dateStr);
    if (!includeWeekends && isWeekend) continue;
    if (!includeHolidays && isHoliday) continue;
    count++;
  }
  return count;
}

// ─── Helper: format date to period ───
function toPeriod(dateStr: string, granularity: string): string {
  const d = new Date(dateStr);
  if (granularity === "day") return dateStr;
  if (granularity === "week") {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().split("T")[0];
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Load task data with users ───
/** `assigneeBuIds`: keep only assignees of these BUs (`null` = no BU filter). */
async function loadTaskData(filters: StatsFilters, assigneeBuIds: string[] | null) {
  const conditions: any[] = [
    gte(tasks.startDate, filters.startDate),
    lte(tasks.startDate, filters.endDate),
  ];
  if (filters.projectIds?.length) conditions.push(inArray(tasks.projectId, filters.projectIds));

  const taskData = await db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      startDate: tasks.startDate,
      endDate: tasks.endDate,
      startTime: tasks.startTime,
      endTime: tasks.endTime,
      duration: tasks.duration,
      breakDuration: tasks.breakDuration,
      realDuration: tasks.realDuration,
      userId: users.id,
      userName: users.name,
      userFirstName: users.firstName,
      userColor: users.color,
      teamId: users.teamId,
      laborTypeId: users.laborTypeId,
      businessUnitId: users.businessUnitId,
      defaultHourlyRate: users.defaultHourlyRate,
    })
    .from(tasks)
    .innerJoin(taskUsers, eq(taskUsers.taskId, tasks.id))
    .innerJoin(users, eq(users.id, taskUsers.userId))
    .where(and(...conditions));

  // Apply user-level filters
  let filtered = taskData;
  if (filters.userIds?.length) filtered = filtered.filter((t) => filters.userIds!.includes(t.userId));
  if (filters.teamIds?.length) filtered = filtered.filter((t) => t.teamId && filters.teamIds!.includes(t.teamId));
  if (filters.laborTypeIds?.length) filtered = filtered.filter((t) => t.laborTypeId && filters.laborTypeIds!.includes(t.laborTypeId));
  if (assigneeBuIds) filtered = filtered.filter((t) => t.businessUnitId && assigneeBuIds.includes(t.businessUnitId));

  return filtered;
}

// ═══════════════════════════════════════════════════════
// STATS USERS
// ═══════════════════════════════════════════════════════
export async function getStatsUsers(filters: StatsFilters, buScope: StatsBusinessUnitScope) {
  const config = await getDailyHours();
  const dailyHours = config.dailyHours;
  const granularity = filters.granularity || "month";
  // Filters override config defaults
  const includeWeekends = filters.includeWeekends ?? config.includeWeekends;
  const includeHolidays = filters.includeHolidays ?? config.includeHolidays;
  // Users are attached to the BU they belong to
  const taskData = await loadTaskData(filters, restrictToScope(filters.businessUnitIds, buScope));

  // Load holidays for capacity calculation
  const allHolidays = await db.select({ date: holidays.date }).from(holidays);
  const holidaySet = new Set(allHolidays.map((h) => h.date));

  // Load teams and labor types for labels
  const allTeams = await db.select().from(teams);
  const teamMap = new Map(allTeams.map((t) => [t.id, t]));
  const allLaborTypes = await db.select().from(laborTypes);
  const ltMap = new Map(allLaborTypes.map((lt) => [lt.id, lt]));

  // Calculate hours per task-user
  const entries = taskData.map((t) => ({
    ...t,
    hours: Math.round(calculateTaskHours(t as any, dailyHours) * 100) / 100,
    displayName: [t.userFirstName, t.userName].filter(Boolean).join(" "),
    period: toPeriod(t.startDate, granularity),
  }));

  // KPIs
  const uniqueUsers = new Set(entries.map((e) => e.userId));
  const totalHours = Math.round(entries.reduce((s, e) => s + e.hours, 0) * 100) / 100;
  const workingDays = getWorkingDaysCount(filters.startDate, filters.endDate, holidaySet, includeWeekends, includeHolidays);
  const capacityPerUser = workingDays * dailyHours;

  // Hours by user
  const userHoursMap = new Map<string, { userName: string; teamId: string | null; totalHours: number }>();
  for (const e of entries) {
    const existing = userHoursMap.get(e.userId);
    if (existing) {
      existing.totalHours += e.hours;
    } else {
      userHoursMap.set(e.userId, { userName: e.displayName, teamId: e.teamId, totalHours: e.hours });
    }
  }

  const hoursByUser = Array.from(userHoursMap.entries()).map(([userId, data]) => {
    const team = data.teamId ? teamMap.get(data.teamId) : null;
    return {
      userId,
      userName: data.userName,
      teamName: team?.name ?? null,
      teamColor: team?.color ?? null,
      totalHours: Math.round(data.totalHours * 100) / 100,
      capacityHours: capacityPerUser,
      occupancyRate: capacityPerUser > 0 ? Math.round((data.totalHours / capacityPerUser) * 100) : 0,
    };
  }).sort((a, b) => b.totalHours - a.totalHours);

  // Workload timeline
  const timelineMap = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!timelineMap.has(e.period)) timelineMap.set(e.period, new Map());
    const periodMap = timelineMap.get(e.period)!;
    periodMap.set(e.displayName, (periodMap.get(e.displayName) || 0) + e.hours);
  }
  const workloadTimeline = Array.from(timelineMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, userMap]) => ({ date, ...Object.fromEntries(userMap) }));

  // Hours by team
  const teamHoursMap = new Map<string, { hours: number; users: Set<string> }>();
  for (const e of entries) {
    const teamKey = e.teamId || "__none__";
    const existing = teamHoursMap.get(teamKey) || { hours: 0, users: new Set<string>() };
    existing.hours += e.hours;
    existing.users.add(e.userId);
    teamHoursMap.set(teamKey, existing);
  }
  const hoursByTeam = Array.from(teamHoursMap.entries()).map(([teamId, data]) => {
    const team = teamId !== "__none__" ? teamMap.get(teamId) : null;
    return {
      teamId: teamId === "__none__" ? null : teamId,
      teamName: team?.name ?? null, // null = no team (label translated at display time)
      teamColor: team?.color ?? "#6b7280",
      totalHours: Math.round(data.hours * 100) / 100,
      userCount: data.users.size,
    };
  }).sort((a, b) => b.totalHours - a.totalHours);

  // Hours by labor type
  const ltHoursMap = new Map<string, number>();
  for (const e of entries) {
    if (!e.laborTypeId) continue;
    ltHoursMap.set(e.laborTypeId, (ltHoursMap.get(e.laborTypeId) || 0) + e.hours);
  }
  const hoursByLaborType = Array.from(ltHoursMap.entries()).map(([ltId, hours]) => {
    const lt = ltMap.get(ltId);
    return {
      laborTypeId: ltId,
      laborTypeName: lt?.name ?? null, // null = deleted type (label translated at display time)
      initials: lt?.initials ?? "?",
      totalHours: Math.round(hours * 100) / 100,
    };
  }).sort((a, b) => b.totalHours - a.totalHours);

  // User-project matrix
  const matrixMap = new Map<string, Map<string, number>>();
  const projectNames = new Map<string, string>();
  for (const e of entries) {
    const key = e.userId;
    if (!matrixMap.has(key)) matrixMap.set(key, new Map());
    const projMap = matrixMap.get(key)!;
    projMap.set(e.projectId, (projMap.get(e.projectId) || 0) + e.hours);
  }
  // Load project names
  const allProjects = await db.select({ id: projects.id, name: projects.name, color: projects.color }).from(projects);
  for (const p of allProjects) projectNames.set(p.id, p.name);

  const userProjectMatrix: any[] = [];
  for (const [userId, projMap] of matrixMap) {
    const user = userHoursMap.get(userId);
    for (const [projectId, hours] of projMap) {
      userProjectMatrix.push({
        userId,
        userName: user?.userName ?? "",
        projectId,
        projectName: projectNames.get(projectId) ?? "",
        hours: Math.round(hours * 100) / 100,
      });
    }
  }

  return {
    kpis: {
      totalUsers: uniqueUsers.size,
      totalHoursWorked: totalHours,
      avgHoursPerUser: uniqueUsers.size > 0 ? Math.round((totalHours / uniqueUsers.size) * 10) / 10 : 0,
      avgOccupancyRate: hoursByUser.length > 0 ? Math.round(hoursByUser.reduce((s, u) => s + u.occupancyRate, 0) / hoursByUser.length) : 0,
    },
    hoursByUser,
    workloadTimeline,
    hoursByTeam,
    hoursByLaborType,
    userProjectMatrix,
  };
}

// ═══════════════════════════════════════════════════════
// STATS PROJECTS
// ═══════════════════════════════════════════════════════
export async function getStatsProjects(filters: StatsFilters, buScope: StatsBusinessUnitScope) {
  const { dailyHours, timezone } = await getDailyHours();
  const granularity = filters.granularity || "month";
  const today = getTodayInTimezone(timezone);
  // No user-BU filter in loadTaskData — we filter by project BU below
  const taskData = await loadTaskData(filters, null);

  // Load projects (filtered by BU if specified, always within the BU scope)
  const projectBuIds = restrictToScope(filters.businessUnitIds, buScope);
  let allProjects = await db.select().from(projects).where(ne(projects.status, "archived"));
  if (projectBuIds) {
    allProjects = allProjects.filter((p) => p.businessUnitId && projectBuIds.includes(p.businessUnitId));
  }
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));

  // Calculate hours per task (only for projects in scope)
  const entries = taskData
    .filter((t) => projectMap.has(t.projectId))
    .map((t) => ({
      ...t,
      hours: Math.round(calculateTaskHours(t as any, dailyHours) * 100) / 100,
      period: toPeriod(t.startDate, granularity),
      effectiveEnd: t.endDate || t.startDate,
    }));

  // Hours by project
  const projHoursMap = new Map<string, { consumed: number; upcoming: number; taskCount: number; userIds: Set<string> }>();
  for (const e of entries) {
    const existing = projHoursMap.get(e.projectId) || { consumed: 0, upcoming: 0, taskCount: 0, userIds: new Set<string>() };
    if (e.effectiveEnd < today) {
      existing.consumed += e.hours;
    } else {
      existing.upcoming += e.hours;
    }
    existing.taskCount++;
    existing.userIds.add(e.userId);
    projHoursMap.set(e.projectId, existing);
  }

  // Load labor budgets as fallback for budgetTime
  const allLaborBudgets = await db.select({
    projectId: projectLaborBudgets.projectId,
    total: sql<number>`COALESCE(SUM(${projectLaborBudgets.plannedHours}), 0)`,
  }).from(projectLaborBudgets).groupBy(projectLaborBudgets.projectId);
  const laborBudgetMap = new Map(allLaborBudgets.map((b) => [b.projectId, parseFloat(String(b.total))]));

  // Project progress
  const projectProgress = allProjects.map((p) => {
    const hours = projHoursMap.get(p.id) || { consumed: 0, upcoming: 0, taskCount: 0, userIds: new Set() };
    const budgetHours = p.budgetTime ? parseFloat(p.budgetTime) : (laborBudgetMap.get(p.id) || 0);
    const total = hours.consumed + hours.upcoming;
    return {
      projectId: p.id,
      projectName: p.name,
      projectColor: p.color,
      status: p.status,
      budgetHours,
      consumedHours: Math.round(hours.consumed * 100) / 100,
      upcomingHours: Math.round(hours.upcoming * 100) / 100,
      completionRate: budgetHours > 0 ? Math.round((hours.consumed / budgetHours) * 100) : 0,
      taskCount: hours.taskCount,
      userCount: hours.userIds.size,
    };
  }).filter((p) => p.consumedHours > 0 || p.upcomingHours > 0 || p.budgetHours > 0)
    .sort((a, b) => b.consumedHours - a.consumedHours);

  // Monthly breakdown
  const monthlyMap = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!monthlyMap.has(e.period)) monthlyMap.set(e.period, new Map());
    const m = monthlyMap.get(e.period)!;
    const pName = projectMap.get(e.projectId)?.name ?? e.projectId;
    m.set(pName, (m.get(pName) || 0) + e.hours);
  }
  const monthlyBreakdown = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, projMap]) => ({
      date,
      ...Object.fromEntries(Array.from(projMap.entries()).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    }));

  // Projects by status
  const statusCounts = new Map<string, { count: number; hours: number }>();
  for (const p of allProjects) {
    const existing = statusCounts.get(p.status) || { count: 0, hours: 0 };
    existing.count++;
    const h = projHoursMap.get(p.id);
    if (h) existing.hours += h.consumed + h.upcoming;
    statusCounts.set(p.status, existing);
  }
  const projectsByStatus = Array.from(statusCounts.entries()).map(([status, data]) => ({
    status, // identifier (todo, in_progress, done, archived): label translated at display time
    count: data.count,
    totalHours: Math.round(data.hours * 100) / 100,
  }));

  // Hours timeline (cumulative)
  const sortedMonths = Array.from(monthlyMap.keys()).sort();
  let cumulative = 0;
  const hoursTimeline = sortedMonths.map((date) => {
    const m = monthlyMap.get(date)!;
    const consumed = Array.from(m.values()).reduce((s, v) => s + v, 0);
    cumulative += consumed;
    return {
      date,
      consumed: Math.round(consumed * 100) / 100,
      cumulative: Math.round(cumulative * 100) / 100,
    };
  });

  // KPIs
  const totalConsumed = projectProgress.reduce((s, p) => s + p.consumedHours, 0);
  const totalPlanned = projectProgress.reduce((s, p) => s + p.budgetHours, 0);

  return {
    kpis: {
      totalProjects: allProjects.length,
      activeProjects: allProjects.filter((p) => p.status === "in_progress").length,
      totalPlannedHours: Math.round(totalPlanned * 100) / 100,
      totalConsumedHours: Math.round(totalConsumed * 100) / 100,
      globalCompletionRate: totalPlanned > 0 ? Math.round((totalConsumed / totalPlanned) * 100) : 0,
    },
    projectProgress,
    monthlyBreakdown,
    projectsByStatus,
    hoursTimeline,
  };
}

// ═══════════════════════════════════════════════════════
// STATS ROI
// ═══════════════════════════════════════════════════════
export async function getStatsRoi(filters: StatsFilters, buScope: StatsBusinessUnitScope) {
  const { dailyHours } = await getDailyHours();
  const granularity = filters.granularity || "month";
  const taskData = await loadTaskData(filters, null);

  // Load projects with budget, within the BU scope (by project BU)
  let allProjects = await db.select().from(projects);
  if (buScope) {
    allProjects = allProjects.filter((p) => p.businessUnitId && buScope.includes(p.businessUnitId));
  }
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));

  // Calculate cost per task-user (user's default hourly rate)
  const entries = taskData.filter((t) => !buScope || projectMap.has(t.projectId)).map((t) => {
    const hours = Math.round(calculateTaskHours(t as any, dailyHours) * 100) / 100;
    const rate = t.defaultHourlyRate ? parseFloat(t.defaultHourlyRate) : 0;
    return {
      ...t,
      hours,
      rate,
      cost: Math.round(hours * rate * 100) / 100,
      displayName: [t.userFirstName, t.userName].filter(Boolean).join(" "),
      period: toPeriod(t.startDate, granularity),
    };
  });

  // Profit by project
  const projCostMap = new Map<string, { laborCost: number; hours: number }>();
  for (const e of entries) {
    const existing = projCostMap.get(e.projectId) || { laborCost: 0, hours: 0 };
    existing.laborCost += e.cost;
    existing.hours += e.hours;
    projCostMap.set(e.projectId, existing);
  }

  const profitByProject = allProjects
    .filter((p) => projCostMap.has(p.id) || (p.budgetAmount && parseFloat(p.budgetAmount) > 0))
    .map((p) => {
      const costs = projCostMap.get(p.id) || { laborCost: 0, hours: 0 };
      const budgetAmount = p.budgetAmount ? parseFloat(p.budgetAmount) : 0;
      const totalCost = Math.round(costs.laborCost * 100) / 100;
      const profit = Math.round((budgetAmount - totalCost) * 100) / 100;
      return {
        projectId: p.id,
        projectName: p.name,
        projectColor: p.color,
        budgetAmount,
        laborCost: totalCost,
        totalCost,
        profit,
        profitMargin: budgetAmount > 0 ? Math.round((profit / budgetAmount) * 100) : 0,
      };
    })
    .sort((a, b) => b.budgetAmount - a.budgetAmount);

  // ROI timeline
  const timelineMap = new Map<string, { cost: number }>();
  for (const e of entries) {
    const existing = timelineMap.get(e.period) || { cost: 0 };
    existing.cost += e.cost;
    timelineMap.set(e.period, existing);
  }
  let cumulativeCost = 0;
  const roiTimeline = Array.from(timelineMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => {
      cumulativeCost += data.cost;
      return {
        month,
        cost: Math.round(data.cost * 100) / 100,
        cumulativeCost: Math.round(cumulativeCost * 100) / 100,
      };
    });

  // Cost by labor type
  const ltCostMap = new Map<string, { hours: number; cost: number }>();
  const allLT = await db.select().from(laborTypes);
  const ltMap = new Map(allLT.map((lt) => [lt.id, lt]));
  for (const e of entries) {
    if (!e.laborTypeId) continue;
    const existing = ltCostMap.get(e.laborTypeId) || { hours: 0, cost: 0 };
    existing.hours += e.hours;
    existing.cost += e.cost;
    ltCostMap.set(e.laborTypeId, existing);
  }
  const costByLaborType = Array.from(ltCostMap.entries()).map(([ltId, data]) => {
    const lt = ltMap.get(ltId);
    return {
      laborTypeId: ltId,
      laborTypeName: lt?.name ?? null, // null = deleted type (label translated at display time)
      hours: Math.round(data.hours * 100) / 100,
      avgRate: data.hours > 0 ? Math.round((data.cost / data.hours) * 100) / 100 : 0,
      totalCost: Math.round(data.cost * 100) / 100,
    };
  }).sort((a, b) => b.totalCost - a.totalCost);

  // Cost by user
  const userCostMap = new Map<string, { name: string; hours: number; cost: number; projects: Set<string> }>();
  for (const e of entries) {
    const existing = userCostMap.get(e.userId) || { name: e.displayName, hours: 0, cost: 0, projects: new Set<string>() };
    existing.hours += e.hours;
    existing.cost += e.cost;
    existing.projects.add(e.projectId);
    userCostMap.set(e.userId, existing);
  }
  const costByUser = Array.from(userCostMap.entries()).map(([userId, data]) => ({
    userId,
    userName: data.name,
    hours: Math.round(data.hours * 100) / 100,
    totalCost: Math.round(data.cost * 100) / 100,
    projectCount: data.projects.size,
  })).sort((a, b) => b.totalCost - a.totalCost);

  // KPIs
  const totalCost = entries.reduce((s, e) => s + e.cost, 0);
  const totalRevenue = profitByProject.reduce((s, p) => s + p.budgetAmount, 0);
  const totalProfit = totalRevenue - totalCost;

  return {
    kpis: {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      avgProfitMargin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
    },
    profitByProject,
    roiTimeline,
    costByLaborType,
    costByUser,
  };
}
