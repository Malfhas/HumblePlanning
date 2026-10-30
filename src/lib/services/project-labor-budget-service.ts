import { db } from "@/db";
import { projectLaborBudgets, tasks, taskUsers, users } from "@/db/schema";
import { eq, sql, and, lt, gt } from "drizzle-orm";
import { getConfigValues } from "./config-service";
import { getTodayInTimezone } from "@/lib/utils/dates";

export async function getProjectLaborBudgets(projectId: string) {
  return db.query.projectLaborBudgets.findMany({
    where: eq(projectLaborBudgets.projectId, projectId),
    with: { laborType: { columns: { id: true, name: true, initials: true } } },
  });
}

export async function upsertProjectLaborBudgets(
  projectId: string,
  budgets: { laborTypeId: string; plannedHours: string }[]
) {
  return db.transaction(async (tx) => {
    await tx.delete(projectLaborBudgets).where(eq(projectLaborBudgets.projectId, projectId));

    const validBudgets = budgets.filter((b) => b.laborTypeId && parseFloat(b.plannedHours) > 0);
    if (validBudgets.length > 0) {
      await tx.insert(projectLaborBudgets).values(
        validBudgets.map((b) => ({
          projectId,
          laborTypeId: b.laborTypeId,
          plannedHours: b.plannedHours,
        }))
      );
    }

    return tx.query.projectLaborBudgets.findMany({
      where: eq(projectLaborBudgets.projectId, projectId),
      with: { laborType: { columns: { id: true, name: true, initials: true } } },
    });
  });
}

/**
 * Compute consumed and upcoming hours per labor type from tasks
 */
export async function computeLaborHours(projectId: string) {
  const config = await getConfigValues(["DURATION_DAY", "TIMEZONE"]);
  const durationDay = config.DURATION_DAY || "07:30";
  const [dh, dm] = durationDay.split(":").map(Number);
  const dailyHours = dh + (dm || 0) / 60;

  const today = getTodayInTimezone(config.TIMEZONE || "Europe/Paris");

  // Get all tasks for this project with their assigned users
  const taskData = await db
    .select({
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
    .where(eq(tasks.projectId, projectId));

  const hoursMap = new Map<string, { consumed: number; upcoming: number }>();

  for (const t of taskData) {
    if (!t.laborTypeId) continue;

    // Calculate hours for this task
    let hours = 0;
    if (t.realDuration) {
      hours = parseFloat(t.realDuration);
    } else if (t.startTime && t.endTime) {
      const [sh, sm] = t.startTime.split(":").map(Number);
      const [eh, em] = t.endTime.split(":").map(Number);
      let dailyH = (eh + em / 60) - (sh + sm / 60);
      if (t.breakDuration) {
        const [bh, bm] = t.breakDuration.split(":").map(Number);
        dailyH -= (bh + bm / 60);
      }
      const start = new Date(t.startDate);
      const end = t.endDate ? new Date(t.endDate) : start;
      const nbDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      hours = nbDays * Math.max(dailyH, 0);
    } else if (t.duration) {
      const [durH, durM] = t.duration.split(":").map(Number);
      hours = durH + (durM || 0) / 60;
    } else {
      const start = new Date(t.startDate);
      const end = t.endDate ? new Date(t.endDate) : start;
      const nbDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      hours = nbDays * dailyHours;
    }

    hours = Math.round(hours * 100) / 100;

    // Categorize: consumed (past) or upcoming (future)
    const effectiveEnd = t.endDate || t.startDate;
    const entry = hoursMap.get(t.laborTypeId) ?? { consumed: 0, upcoming: 0 };

    if (effectiveEnd < today) {
      entry.consumed += hours;
    } else {
      entry.upcoming += hours;
    }

    entry.consumed = Math.round(entry.consumed * 100) / 100;
    entry.upcoming = Math.round(entry.upcoming * 100) / 100;
    hoursMap.set(t.laborTypeId, entry);
  }

  return hoursMap;
}

/**
 * Get budgets enriched with computed hours
 */
export async function getProjectLaborBudgetsWithHours(projectId: string) {
  const [budgets, hoursMap] = await Promise.all([
    getProjectLaborBudgets(projectId),
    computeLaborHours(projectId),
  ]);

  return budgets.map((b) => {
    const hours = hoursMap.get(b.laborTypeId);
    return {
      ...b,
      consumed: hours?.consumed ?? 0,
      upcoming: hours?.upcoming ?? 0,
    };
  });
}
