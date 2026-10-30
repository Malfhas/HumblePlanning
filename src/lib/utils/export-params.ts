import type { ExportFilters } from "@/lib/services/export-service";
import type { SortMode, CalendarMode } from "@/lib/types/planning";

export type CellContent = "project" | "title" | "user-name" | "user-login";

export function parseExportFilters(params: URLSearchParams): ExportFilters {
  const calendarMode = (params.get("calendarMode") as CalendarMode) || undefined;
  return {
    viewMode: (params.get("viewMode") as ExportFilters["viewMode"]) || "users",
    startDate: params.get("startDate") || new Date().toISOString().split("T")[0],
    endDate: params.get("endDate") || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
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
    calendarMode: calendarMode && calendarMode !== "off" ? calendarMode : undefined,
    calendarUserId: params.get("calendarUserId") || undefined,
    selectedDay: params.get("selectedDay") || undefined,
    calendarDays: params.get("calendarDays") ? parseInt(params.get("calendarDays")!, 10) : undefined,
  };
}
