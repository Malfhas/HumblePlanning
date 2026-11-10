import type { ExportFilters } from "@/lib/services/export-service";
import { getTodayInTimezone } from "@/lib/utils/dates";
import type { SortMode, CalendarMode } from "@/lib/types/planning";

export type CellContent = "project" | "title" | "user-name" | "user-login";

// The only calendar export is the person calendar (an unknown or removed mode,
// such as the former "team-day", exports the schedule).
const CALENDAR_MODES: CalendarMode[] = ["personal"];

/** A calendar date (YYYY-MM-DD) moved by `days`. */
function addDaysIso(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function parseExportFilters(params: URLSearchParams): ExportFilters {
  const rawCalendarMode = params.get("calendarMode") as CalendarMode | null;
  const calendarMode = rawCalendarMode && CALENDAR_MODES.includes(rawCalendarMode) ? rawCalendarMode : undefined;
  return {
    viewMode: (params.get("viewMode") as ExportFilters["viewMode"]) || "users",
    startDate: params.get("startDate") || getTodayInTimezone(),
    endDate: params.get("endDate") || addDaysIso(getTodayInTimezone(), 30),
    sortMode: (params.get("sortMode") as SortMode) || undefined,
    cellContent: (params.get("cellContent") as CellContent) || undefined,
    teamIds: params.get("teamIds")?.split(",").filter(Boolean),
    userIds: params.get("userIds")?.split(",").filter(Boolean),
    projectIds: params.get("projectIds")?.split(",").filter(Boolean),
    statusIds: params.get("statusIds")?.split(",").filter(Boolean),
    placeIds: params.get("placeIds")?.split(",").filter(Boolean),
    resourceIds: params.get("resourceIds")?.split(",").filter(Boolean),
    businessUnitIds: params.get("businessUnitIds")?.split(",").filter(Boolean),
    includeStats: params.get("includeStats") === "1",
    excludeWeekends: params.get("excludeWeekends") === "1",
    calendarMode,
    calendarUserId: params.get("calendarUserId") || undefined,
    calendarDays: params.get("calendarDays") ? parseInt(params.get("calendarDays")!, 10) : undefined,
  };
}
