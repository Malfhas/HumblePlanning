/**
 * Gantt of a project (PDF and Excel exports): one row per distinct task title of the project (case and spaces
 * ignored), the tasks of the period on it, coloured by their status.
 */

import { AppError } from "@/lib/errors";
import { getExportData, type ExportData, type ExportFilters, type ExportI18n, type ExportTask } from "@/lib/services/export-service";
import type { UserPermissions } from "@/lib/services/permission-service";

/** Order of the rows: by first start (a staircase), or by title (numbers read as numbers). */
export type ProjectGanttSort = "date" | "alpha";

/** One column per day, or per week (ISO, Monday first). */
export type ProjectGanttScale = "days" | "weeks";

export interface ProjectGanttRow {
  id: string;
  label: string;
  /** Its tasks, earliest first. */
  tasks: ExportTask[];
}

export interface ProjectGantt {
  /** The project, as labelled on the planning (business number and name). */
  projectLabel: string;
  rows: ProjectGanttRow[];
  /** The export data of the project over the period (dates, holidays, tasks). */
  data: ExportData;
}

export function parseProjectGanttSort(value: string | null | undefined): ProjectGanttSort {
  return value === "alpha" ? "alpha" : "date";
}

export function parseProjectGanttScale(value: string | null | undefined): ProjectGanttScale {
  return value === "weeks" ? "weeks" : "days";
}

/** Monday (YYYY-MM-DD) of the ISO week of `day`. */
export function weekOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * The Gantt by week: one column per week holding a day of the period (its Monday), each task over the weeks it
 * touches. Holidays no longer cut the bars: a column is a whole week.
 */
export function toWeekScale(gantt: ProjectGantt): ProjectGantt {
  const byWeek = (task: ExportTask): ExportTask => ({ ...task, startDate: weekOf(task.startDate), endDate: weekOf(task.endDate ?? task.startDate) });
  const weeks = [...new Set(gantt.data.dateRange.days.map(weekOf))];
  return {
    ...gantt,
    rows: gantt.rows.map(row => ({ ...row, tasks: row.tasks.map(byWeek) })),
    data: { ...gantt.data, tasks: gantt.data.tasks.map(byWeek), holidays: new Map(), dateRange: { ...gantt.data.dateRange, days: weeks } },
  };
}

/** Earliest first, then the longest, then by creation order of the list. */
function byStart(a: ExportTask, b: ExportTask): number {
  return a.startDate.localeCompare(b.startDate)
    || (b.endDate ?? b.startDate).localeCompare(a.endDate ?? a.startDate)
    || (a.startTime ?? "").localeCompare(b.startTime ?? "");
}

/**
 * Rows of the Gantt: the tasks grouped by title, without regard to case or spaces, labelled with the title of the
 * earliest one. The tasks without title share one row named after the project; it is the only row when no task
 * has a title (an empty project too).
 */
export function groupTasksByTitle(tasks: readonly ExportTask[], projectLabel: string, sort: ProjectGanttSort, locale: string): ProjectGanttRow[] {
  const groups = new Map<string, ProjectGanttRow>();
  const untitled: ExportTask[] = [];
  for (const task of [...tasks].sort(byStart)) {
    const title = task.title?.trim().replace(/\s+/g, " ");
    if (!title) {
      untitled.push(task);
      continue;
    }
    const key = title.toLocaleLowerCase(locale);
    const group = groups.get(key);
    if (group) group.tasks.push(task);
    else groups.set(key, { id: `title:${key}`, label: title, tasks: [task] });
  }
  const rows = [...groups.values()];
  if (untitled.length > 0 || rows.length === 0) rows.push({ id: "project", label: projectLabel, tasks: untitled });

  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const firstStart = (row: ProjectGanttRow) => row.tasks[0]?.startDate ?? "9999-12-31";
  return rows.sort((a, b) => sort === "alpha"
    ? collator.compare(a.label, b.label)
    : firstStart(a).localeCompare(firstStart(b)) || collator.compare(a.label, b.label));
}

/**
 * The Gantt of `projectId` over the period of `filters`, within the read scope of the user. The planning filters
 * (people, teams, statuses, business units) do not apply: every task of the project is shown. A project the user
 * cannot see, or an archived one, is not found.
 */
export async function getProjectGantt(
  filters: ExportFilters, projectId: string, sort: ProjectGanttSort, locale: string,
  exportedBy: string, i18n: ExportI18n, perms: UserPermissions,
): Promise<ProjectGantt> {
  const data = await getExportData(
    { viewMode: "projects", startDate: filters.startDate, endDate: filters.endDate, excludeWeekends: filters.excludeWeekends, projectIds: [projectId] },
    exportedBy, i18n, perms,
  );
  const project = data.rows.find(row => row.type === "row" && row.id === projectId);
  if (!project) throw new AppError("projects.errors.notFound");
  const tasks = data.tasks.filter(task => task.project?.id === projectId);
  return { projectLabel: project.label, rows: groupTasksByTitle(tasks, project.label, sort, locale), data: { ...data, tasks } };
}
