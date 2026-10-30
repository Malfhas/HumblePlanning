"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { usePlanningStore } from "@/stores/planning-store";
import { useFilterStore } from "@/stores/filter-store";
import { useBuStore } from "@/stores/bu-store";
import { allocateSlotsByRow, type SlotTask } from "@/lib/utils/slot-allocator";
import { sortAndGroupRows, type PlanningRow, type GridRow } from "@/lib/utils/sort-rows";
import { toDateString } from "@/lib/utils/dates";
import type { ViewMode } from "@/stores/planning-store";
import { useSocket } from "@/hooks/use-socket";
import type { TaskWithUsers, Status, Holiday, PaginatedResponse, VehicleAssignmentWithRelations, ResourceAssignmentWithRelations } from "@/types";
import { usePermissions } from "@/hooks/use-permissions";
import { throwIfNotOk } from "@/lib/api-client";
import { INTL_TAG } from "@/i18n/config";

async function fetchApi<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  await throwIfNotOk(res);
  return res.json();
}

function getRowKey(viewMode: ViewMode): string {
  switch (viewMode) {
    case "users": return "users";
    case "projects": return "projectId";
    case "places": return "placeId";
    case "resources": return "resourceId";
    case "vehicles": return "vehicleId";
  }
}

export function usePlanningData() {
  // Fallback labels of pseudo-tasks (assignments, public holidays) and of
  // group headers: translated here (React hook) and not stored in the
  // TanStack Query cache (only the values derived by the useMemos carry them).
  const t = useTranslations("planning");
  const locale = useLocale();
  const { viewMode, startDate, endDate, sortMode } = usePlanningStore();
  const { userId: currentUserId, canResizeTask, can } = usePermissions();
  const { teamIds, userIds, projectIds, statusIds, businessUnitIds, siteAddressIds, resourceIds, vehicleIds, qualificationIds, groupIds, search } = useFilterStore();
  const { selectedBuIds } = useBuStore();
  // Both stores (BU + schedule filters) are persisted through Zustand
  // `persist`. Hydration from localStorage is ASYNCHRONOUS — on the
  // first render, `selectedBuIds: []` and `businessUnitIds: []`
  // (initial store values) until they are replaced by the real
  // localStorage values a few ms later. Without this guard,
  // the 1st render fires a fetch WITHOUT the BU filter (huge payload), then
  // hydration changes the queryKey → 2nd fetch with the filter. So
  // tasksQuery + vehicleAssignmentsQuery + resourceAssignmentsQuery are disabled
  // until both stores are hydrated → a single clean fetch.
  const buHydrated = useBuStore((s) => s._hasHydrated);
  const filtersHydrated = useFilterStore((s) => s._hasHydrated);
  const storesHydrated = buHydrated && filtersHydrated;
  const effectiveBuIds = useMemo(
    () => selectedBuIds.length > 0 ? selectedBuIds : businessUnitIds,
    [selectedBuIds, businessUnitIds]
  );
  const startStr = toDateString(startDate);
  const endStr = toDateString(endDate);

  // Smart polling: no periodic refetch while Socket.io is
  // connected (the server-side `task:changed` events already trigger
  // the targeted invalidation through `useSocket`). If the WS
  // drops, fall back to a backup polling every 2 minutes
  // so stale data is not kept forever. On
  // reconnection, `useSocket.onConnect` invalidates everything at once.
  const { connected: socketConnected } = useSocket();
  const refetchInterval: number | false = socketConnected ? false : 120_000;

  // Server-side BU filter: passes the selected BUs as a query param to
  // avoid transferring the tasks of hidden BUs. effectiveBuIds
  // combines the header selection (useBuStore) and the filter panel — header
  // first. Empty array = "all BUs" → no query param, SQL does not filter.
  const buParam = effectiveBuIds.length > 0 ? `&businessUnitIds=${effectiveBuIds.join(",")}` : "";

  // ────────────────────────────────────────────────────────────────────
  // GLOBAL LOADING — 2026-05-02
  //
  // The canvas (Canvas phase) can display 30k+ tasks without visible
  // degradation (O(visible) rendering, not O(total)). Time-based pagination
  // (rolling window) is therefore removed: it needlessly complicated the code and
  // introduced scroll bugs. SoPlanning pattern: a single fetch
  // for the whole requested range. The payload is gzipped by the API (~5 MB
  // for 30k tasks), acceptable for scheduling use.
  // ────────────────────────────────────────────────────────────────────
  const tasksQuery = useQuery({
    queryKey: ["tasks", "planning", startStr, endStr, effectiveBuIds],
    queryFn: () =>
      fetchApi<PaginatedResponse<TaskWithUsers>>(
        `/api/tasks?startDate=${startStr}&endDate=${endStr}&unpaginated=true${buParam}`
      ),
    placeholderData: keepPreviousData,
    refetchInterval,
    enabled: storesHydrated,
  });

  const tasksData = useMemo<TaskWithUsers[]>(() => {
    return tasksQuery.data?.data ?? [];
  }, [tasksQuery.data]);

  const rowsQuery = useQuery({
    queryKey: [viewMode, "planning-rows"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: () => fetchApi<any[]>(`/api/${viewMode === "vehicles" ? "vehicles" : viewMode}${viewMode === "users" ? "?planning=true" : ""}`),
    placeholderData: keepPreviousData,
  });

  // Vehicle assignments query — loaded in all views for vehicle icons on tasks
  const vehicleAssignmentsQuery = useQuery({
    queryKey: ["vehicle-assignments", "planning", startStr, endStr],
    queryFn: () =>
      fetchApi<VehicleAssignmentWithRelations[]>(
        `/api/vehicle-assignments?startDate=${startStr}&endDate=${endStr}`
      ),
    placeholderData: keepPreviousData,
    refetchInterval,
  });

  // Resource assignments query — loaded in all views for resource icons on tasks
  const resourceAssignmentsQuery = useQuery({
    queryKey: ["resource-assignments", "planning", startStr, endStr],
    queryFn: () =>
      fetchApi<ResourceAssignmentWithRelations[]>(
        `/api/resource-assignments?startDate=${startStr}&endDate=${endStr}`
      ),
    placeholderData: keepPreviousData,
    refetchInterval,
  });

  // Always load visible user IDs to filter tasks across all view modes
  const visibleUsersQuery = useQuery({
    queryKey: ["users", "planning-visible"],
    queryFn: () => fetchApi<{ id: string }[]>("/api/users?planning=true"),
    placeholderData: keepPreviousData,
  });

  const visibleUserIds = useMemo(() => {
    if (!visibleUsersQuery.data) return null;
    const set = new Set(visibleUsersQuery.data.map((u) => u.id));
    // Always include the current user so they see their own tasks even if not visible on planning
    if (currentUserId) set.add(currentUserId);
    return set;
  }, [visibleUsersQuery.data, currentUserId]);

  // Project → group mapping for group filter
  const projectsForGroupQuery = useQuery({
    queryKey: ["projects", "group-map"],
    queryFn: () => fetchApi<{ id: string; group?: { id: string } | null }[]>("/api/projects"),
    placeholderData: keepPreviousData,
    enabled: groupIds.length > 0,
  });

  const projectGroupMap = useMemo(() => {
    if (!projectsForGroupQuery.data) return null;
    const m = new Map<string, string>();
    for (const p of projectsForGroupQuery.data) {
      if ((p as any).group?.id) m.set(p.id, (p as any).group.id);
    }
    return m;
  }, [projectsForGroupQuery.data]);

  const statusesQuery = useQuery({
    queryKey: ["statuses"],
    queryFn: () => fetchApi<Status[]>("/api/statuses"),
  });

  const holidaysQuery = useQuery({
    queryKey: ["holidays", startStr, endStr],
    queryFn: () =>
      fetchApi<Holiday[]>(`/api/holidays?startDate=${startStr}&endDate=${endStr}`),
    placeholderData: keepPreviousData,
  });

  // Map userId → qualificationIds for qualification filtering
  const userQualificationsQuery = useQuery({
    queryKey: ["users", "with-qualifications"],
    queryFn: () => fetchApi<{ id: string; qualifications?: { id: string }[] }[]>("/api/users"),
    enabled: qualificationIds.length > 0,
    placeholderData: keepPreviousData,
  });

  const userQualificationMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!userQualificationsQuery.data) return map;
    for (const u of userQualificationsQuery.data) {
      if (u.qualifications?.length) {
        map.set(u.id, new Set(u.qualifications.map(q => q.id)));
      }
    }
    return map;
  }, [userQualificationsQuery.data]);

  const rowKey = getRowKey(viewMode);

  // Convert vehicle assignments to pseudo-tasks for the vehicles view
  const vehiclePseudoTasks = useMemo<TaskWithUsers[]>(() => {
    if (viewMode !== "vehicles" || !vehicleAssignmentsQuery.data) return [];
    return vehicleAssignmentsQuery.data.map((a) => {
      const typeLabels: Record<string, string> = { task: t("data.assignmentTypes.task"), reservation: t("data.assignmentTypes.reservation"), maintenance: t("data.assignmentTypes.maintenance") };
      let title: string;
      if (a.type === "task" && a.project?.name) {
        title = a.notes ? `${a.project.name} — ${a.notes}` : a.project.name;
      } else if (a.project?.name) {
        title = a.notes ? `${a.project.name} — ${a.notes}` : a.project.name;
      } else if (a.notes) {
        title = a.notes;
      } else {
        title = typeLabels[a.type] || a.type;
      }
      const creator = a.assignedByUser
        ? { id: a.assignedByUser.id, name: [a.assignedByUser.firstName, a.assignedByUser.name].filter(Boolean).join(" ") || a.assignedByUser.name }
        : null;
      const lastModifier = a.lastModifier
        ? { id: a.lastModifier.id, name: [a.lastModifier.firstName, a.lastModifier.name].filter(Boolean).join(" ") || a.lastModifier.name }
        : null;
      return {
        id: `va:${a.id}`,
        parentId: null,
        linkId: null,
        projectId: a.projectId || "",
        startDate: a.startDate,
        endDate: a.endDate || a.startDate,
        duration: null,
        durationDetails: null,
        startTime: a.startTime || null,
        endTime: a.endTime || null,
        title,
        notes: a.notes || null,
        link: null,
        statusId: "",
        placeId: null,
        resourceId: null,
        isLocked: (a as any).isLocked ?? false,
        isMilestone: false,
        files: [],
        customField: null,
        breakDuration: null,
        realDuration: null,
        creatorId: a.assignedBy || null,
        lastModifierId: a.lastModifier?.id || null,
        recurType: null,
        recurFrequency: null,
        recurEndDate: null,
        recurDayOfWeek: null,
        recurException: null,
        createdAt: String(a.createdAt),
        updatedAt: String(a.updatedAt ?? a.createdAt),
        users: [],
        project: a.project
          ? { id: a.project.id, name: a.project.name, color: a.project.color, businessNumber: null, businessUnitId: (a.project as any).businessUnitId ?? null, address: null, addressLat: null, addressLng: null, ownerId: (a.project as any).ownerId ?? "" }
          : a.type === "maintenance"
            ? { id: "", name: t("data.assignmentTypes.maintenance"), color: "#6b7280", businessNumber: null, businessUnitId: null, address: null, addressLat: null, addressLng: null, ownerId: "" }
            : a.type === "reservation"
              ? { id: "", name: t("data.assignmentTypes.reservation"), color: "#3b82f6", businessNumber: null, businessUnitId: null, address: null, addressLat: null, addressLng: null, ownerId: "" }
              : null,
        status: null,
        place: null,
        resource: null,
        creator,
        lastModifier,
        placeText: null,
        placeTextLat: null,
        placeTextLng: null,
        // Custom fields for vehicle assignment identification
        vehicleId: a.vehicleId,
        vehicleAssignmentType: a.type,
      } as TaskWithUsers;
    });
  }, [viewMode, vehicleAssignmentsQuery.data, t]);

  // Detect vehicle assignment conflicts (overlapping dates on same vehicle)
  const vehicleConflictIds = useMemo<Set<string>>(() => {
    if (viewMode !== "vehicles" || vehiclePseudoTasks.length < 2) return new Set();
    const conflicts = new Set<string>();
    // Group by vehicleId
    const byVehicle = new Map<string, typeof vehiclePseudoTasks>();
    for (const t of vehiclePseudoTasks) {
      const vid = (t as any).vehicleId as string;
      if (!vid) continue;
      const list = byVehicle.get(vid) ?? [];
      list.push(t);
      byVehicle.set(vid, list);
    }
    for (const assignments of byVehicle.values()) {
      for (let i = 0; i < assignments.length; i++) {
        for (let j = i + 1; j < assignments.length; j++) {
          const a = assignments[i];
          const b = assignments[j];
          const aEnd = a.endDate || a.startDate;
          const bEnd = b.endDate || b.startDate;
          // Overlap: a.start <= b.end && b.start <= a.end
          if (a.startDate <= bEnd && b.startDate <= aEnd) {
            conflicts.add(a.id);
            conflicts.add(b.id);
          }
        }
      }
    }
    return conflicts;
  }, [viewMode, vehiclePseudoTasks]);

  // Convert resource assignments to pseudo-tasks for the resources view
  const resourcePseudoTasks = useMemo<TaskWithUsers[]>(() => {
    if (viewMode !== "resources" || !resourceAssignmentsQuery.data) return [];
    return resourceAssignmentsQuery.data.map((a: ResourceAssignmentWithRelations) => {
      const typeLabels: Record<string, string> = { task: t("data.assignmentTypes.task"), reservation: t("data.assignmentTypes.reservation"), maintenance: t("data.assignmentTypes.maintenance") };
      let title: string;
      if (a.project?.name) {
        title = a.notes ? `${a.project.name} — ${a.notes}` : a.project.name;
      } else if (a.notes) {
        title = a.notes;
      } else {
        title = typeLabels[a.type] || a.type;
      }
      const creator = a.assignedByUser
        ? { id: a.assignedByUser.id, name: [a.assignedByUser.firstName, a.assignedByUser.name].filter(Boolean).join(" ") || a.assignedByUser.name }
        : null;
      const lastModifier = a.lastModifier
        ? { id: a.lastModifier.id, name: [a.lastModifier.firstName, a.lastModifier.name].filter(Boolean).join(" ") || a.lastModifier.name }
        : null;
      return {
        id: `ra:${a.id}`,
        parentId: null, linkId: null,
        projectId: a.projectId || "",
        startDate: a.startDate,
        endDate: a.endDate || a.startDate,
        duration: null, durationDetails: null,
        startTime: a.startTime || null,
        endTime: a.endTime || null,
        title, notes: a.notes || null, link: null,
        statusId: "", placeId: null, resourceId: a.resourceId,
        isLocked: (a as any).isLocked ?? false, isMilestone: false, files: [], customField: null,
        breakDuration: null, realDuration: null,
        creatorId: a.assignedBy || null, lastModifierId: a.lastModifier?.id || null,
        recurType: null, recurFrequency: null, recurEndDate: null, recurDayOfWeek: null, recurException: null,
        createdAt: String(a.createdAt), updatedAt: String(a.updatedAt ?? a.createdAt),
        users: [],
        project: a.project
          ? { id: a.project.id, name: a.project.name, color: a.project.color, businessNumber: null, businessUnitId: (a.project as any).businessUnitId ?? null, address: null, addressLat: null, addressLng: null, ownerId: (a.project as any).ownerId ?? "" }
          : a.type === "maintenance"
            ? { id: "", name: t("data.assignmentTypes.maintenance"), color: "#6b7280", businessNumber: null, businessUnitId: null, address: null, addressLat: null, addressLng: null, ownerId: "" }
            : { id: "", name: t("data.assignmentTypes.reservation"), color: "#3b82f6", businessNumber: null, businessUnitId: null, address: null, addressLat: null, addressLng: null, ownerId: "" },
        status: null, place: null, resource: null, creator, lastModifier,
        placeText: null, placeTextLat: null, placeTextLng: null,
        resourceAssignmentId: a.resourceId,
        resourceAssignmentType: a.type,
      } as TaskWithUsers;
    });
  }, [viewMode, resourceAssignmentsQuery.data, t]);

  // Detect resource assignment conflicts
  const resourceConflictIds = useMemo<Set<string>>(() => {
    if (viewMode !== "resources" || resourcePseudoTasks.length < 2) return new Set();
    const conflicts = new Set<string>();
    const byResource = new Map<string, typeof resourcePseudoTasks>();
    for (const t of resourcePseudoTasks) {
      const rid = (t as any).resourceAssignmentId as string;
      if (!rid) continue;
      const list = byResource.get(rid) ?? [];
      list.push(t);
      byResource.set(rid, list);
    }
    for (const assignments of byResource.values()) {
      for (let i = 0; i < assignments.length; i++) {
        for (let j = i + 1; j < assignments.length; j++) {
          const a = assignments[i], b = assignments[j];
          if (a.startDate <= (b.endDate || b.startDate) && b.startDate <= (a.endDate || a.startDate)) {
            conflicts.add(a.id);
            conflicts.add(b.id);
          }
        }
      }
    }
    return conflicts;
  }, [viewMode, resourcePseudoTasks]);

  // Build a map of projectId → Set<date> → vehicle names from assignments
  // Used to show vehicle icon on tasks sharing the same project+day
  const projectVehicleMap = useMemo(() => {
    const map = new Map<string, Map<string, string[]>>();
    const assignments = vehicleAssignmentsQuery.data ?? [];
    for (const a of assignments) {
      if (!a.projectId) continue;
      const vehicleName = a.vehicle?.name || t("data.vehicleFallback");
      // Expand date range to individual days
      const start = new Date(a.startDate);
      const end = new Date(a.endDate || a.startDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        let byDate = map.get(a.projectId);
        if (!byDate) { byDate = new Map(); map.set(a.projectId, byDate); }
        let names = byDate.get(dateStr);
        if (!names) { names = []; byDate.set(dateStr, names); }
        if (!names.includes(vehicleName)) names.push(vehicleName);
      }
    }
    return map;
  }, [vehicleAssignmentsQuery.data, t]);

  // Build project→date→resourceNames map for resource icon display
  const projectResourceMap = useMemo(() => {
    const map = new Map<string, Map<string, string[]>>();
    const assignments = resourceAssignmentsQuery.data ?? [];
    for (const a of assignments) {
      if (!a.projectId) continue;
      const resourceName = a.resource?.name || t("data.resourceFallback");
      const start = new Date(a.startDate);
      const end = new Date(a.endDate || a.startDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        let byDate = map.get(a.projectId);
        if (!byDate) { byDate = new Map(); map.set(a.projectId, byDate); }
        let names = byDate.get(dateStr);
        if (!names) { names = []; byDate.set(dateStr, names); }
        if (!names.includes(resourceName)) names.push(resourceName);
      }
    }
    return map;
  }, [resourceAssignmentsQuery.data, t]);

  const filteredTasks = useMemo(() => {
    // In vehicles view, use pseudo-tasks from vehicle assignments
    if (viewMode === "vehicles") {
      // Inject conflict flag
      if (vehicleConflictIds.size > 0) {
        return vehiclePseudoTasks.map((t) =>
          vehicleConflictIds.has(t.id) ? { ...t, hasConflict: true, conflictType: "vehicle" as const } : t
        );
      }
      return vehiclePseudoTasks;
    }
    // In resources view, use pseudo-tasks from resource assignments
    if (viewMode === "resources") {
      if (resourceConflictIds.size > 0) {
        return resourcePseudoTasks.map((t) =>
          resourceConflictIds.has(t.id) ? { ...t, hasConflict: true, conflictType: "resource" as const } : t
        );
      }
      return resourcePseudoTasks;
    }
    // `tasksData` aggregates all the pages loaded by
    // `useInfiniteQuery` (max 3 months in memory thanks to `maxPages: 3`),
    // deduplicating multi-month tasks by `id`.
    if (tasksData.length === 0) return [];

    // Enrich task with vehicle and resource names from assignments
    const enrichWithAssignments = (t: TaskWithUsers): TaskWithUsers => {
      if (!t.projectId) return t;
      let enriched = t;
      // Vehicle names
      const vByDate = projectVehicleMap.get(t.projectId);
      if (vByDate) {
        const start = new Date(t.startDate);
        const end = new Date(t.endDate || t.startDate);
        const vehicleNames: string[] = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const names = vByDate.get(d.toISOString().slice(0, 10));
          if (names) for (const n of names) if (!vehicleNames.includes(n)) vehicleNames.push(n);
        }
        if (vehicleNames.length > 0) enriched = { ...enriched, vehicleNames } as TaskWithUsers;
      }
      // Resource names
      const rByDate = projectResourceMap.get(t.projectId);
      if (rByDate) {
        const start = new Date(t.startDate);
        const end = new Date(t.endDate || t.startDate);
        const resourceNames: string[] = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const names = rByDate.get(d.toISOString().slice(0, 10));
          if (names) for (const n of names) if (!resourceNames.includes(n)) resourceNames.push(n);
        }
        if (resourceNames.length > 0) enriched = { ...enriched, resourceNames } as TaskWithUsers;
      }
      return enriched;
    };

    return tasksData.filter((t) => {
      // Hide tasks where no assigned user is visible on planning
      if (visibleUserIds) {
        const taskUserIds = t.users?.map(u => u.id) ?? [];
        if (taskUserIds.length > 0 && !taskUserIds.some((uid: string) => visibleUserIds.has(uid))) return false;
      }
      if (teamIds.length > 0) {
        const taskTeamIds = t.users?.map(u => u.teamId).filter(Boolean) ?? [];
        if (!taskTeamIds.some((tid) => teamIds.includes(tid as string))) return false;
      }
      if (userIds.length > 0) {
        const taskUserIds = t.users?.map(u => u.id) ?? [];
        if (!taskUserIds.some((uid: string) => userIds.includes(uid))) return false;
      }
      if (projectIds.length > 0 && !projectIds.includes(t.projectId)) return false;
      if (groupIds.length > 0 && projectGroupMap) {
        const taskGroupId = projectGroupMap.get(t.projectId);
        if (!taskGroupId || !groupIds.includes(taskGroupId)) return false;
      }
      if (statusIds.length > 0 && !statusIds.includes(t.statusId)) return false;
      // Business unit filter: for places/resources/vehicles views only, a task needs at least
      // one assigned user belonging to the selected BU. For users/projects views, row-level
      // BU filtering in `filteredRows` handles the hiding, so the task-level check here would
      // incorrectly hide tasks assigned to users without a BU — see user request.
      if (effectiveBuIds.length > 0 && viewMode !== "users" && viewMode !== "projects") {
        const taskUserBuIds = t.users?.map(u => u.businessUnitId).filter(Boolean) ?? [];
        if (!taskUserBuIds.some(buId => effectiveBuIds.includes(buId as string))) return false;
      }
      // Site address filter: task belongs to a project with a selected address
      if (siteAddressIds.length > 0 && !siteAddressIds.includes(t.projectId)) return false;
      if (resourceIds.length > 0 && t.resourceId && !resourceIds.includes(t.resourceId)) return false;
      // Vehicle filter: task's project must have at least one selected vehicle assigned during task dates
      if (vehicleIds.length > 0) {
        const assignments = vehicleAssignmentsQuery.data ?? [];
        const taskStart = t.startDate;
        const taskEnd = t.endDate || t.startDate;
        const hasVehicle = assignments.some(a =>
          a.projectId === t.projectId &&
          vehicleIds.includes(a.vehicleId) &&
          a.startDate <= taskEnd &&
          (a.endDate || a.startDate) >= taskStart
        );
        if (!hasVehicle) return false;
      }
      // Qualification filter: at least one assigned user must have one of the selected qualifications
      if (qualificationIds.length > 0) {
        const taskUserIds = t.users?.map(u => u.id) ?? [];
        const hasQualification = taskUserIds.some(uid => {
          const userQualifications = userQualificationMap.get(uid);
          return userQualifications && qualificationIds.some(qid => userQualifications.has(qid));
        });
        if (!hasQualification) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        const haystack = [
          t.title,
          t.notes,
          t.project?.name,
          t.project?.businessNumber,
          t.status?.name,
          t.place?.name,
          (t as any).placeText,
          t.resource?.name,
          ...(t.users?.map((u: any) => [u.firstName, u.name].filter(Boolean).join(" ")) ?? []),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(s)) return false;
      }
      return true;
    }).map(enrichWithAssignments);
  }, [tasksData, viewMode, vehiclePseudoTasks, vehicleConflictIds, resourcePseudoTasks, resourceConflictIds, projectVehicleMap, projectResourceMap, visibleUserIds, teamIds, userIds, projectIds, statusIds, effectiveBuIds, siteAddressIds, resourceIds, vehicleIds, qualificationIds, groupIds, projectGroupMap, vehicleAssignmentsQuery.data, resourceAssignmentsQuery.data, userQualificationMap, search]);

  const holidayMap = useMemo(() => {
    const map = new Map<string, { label: string; color: string }>();
    if (!holidaysQuery.data) return map;
    for (const h of holidaysQuery.data) {
      map.set(h.date, { label: h.label || t("data.holidayFallback"), color: h.color || "#f97316" });
    }
    return map;
  }, [holidaysQuery.data, t]);

  // Enrich rows with team/group info for sorting
  const enrichedRows = useMemo<PlanningRow[]>(() => {
    if (!rowsQuery.data) return [];
    return rowsQuery.data.map((row) => ({
      ...row,
      // Use displayName (First Last) for user rows if available
      name: row.displayName || row.name,
      type: "row" as const,
      teamId: row.teamId ?? row.team?.id ?? null,
      teamName: row.team?.name ?? null,
      teamColor: row.team?.color ?? null,
      teamSortOrder: row.team?.sortOrder ?? 0,
      groupId: row.groupId ?? row.group?.id ?? null,
      groupName: row.group?.name ?? null,
      groupColor: row.group?.color ?? null,
      groupSortOrder: row.group?.sortOrder ?? 0,
      sortOrder: row.sortOrder ?? 0,
      businessUnitId: row.businessUnitId ?? row.businessUnit?.id ?? null,
      businessUnitName: row.businessUnit?.name ?? null,
      businessUnitNumber: row.businessUnit?.number ?? null,
      businessUnitColor: row.businessUnit?.color ?? null,
      vehicleTypeId: row.vehicleTypeId ?? row.vehicleType?.id ?? null,
      vehicleTypeName: row.vehicleType?.name ?? null,
      vehicleTypeColor: row.vehicleType?.color ?? null,
      resourceTypeId: row.resourceTypeId ?? row.resourceType?.id ?? null,
      resourceTypeName: row.resourceType?.name ?? null,
      resourceTypeColor: row.resourceType?.color ?? null,
    }));
  }, [rowsQuery.data]);

  // Filter rows based on active filters
  const filteredRows = useMemo<PlanningRow[]>(() => {
    return enrichedRows.filter(row => {
      if (viewMode === "users") {
        if (userIds.length > 0 && !userIds.includes(row.id)) return false;
        if (teamIds.length > 0 && (!row.teamId || !teamIds.includes(row.teamId))) return false;
      }
      if (viewMode === "projects" && projectIds.length > 0 && !projectIds.includes(row.id)) return false;
      if (viewMode === "resources" && resourceIds.length > 0 && !resourceIds.includes(row.id)) return false;
      // BU filter — applies to all row-based views (users, projects, vehicles, resources)
      if (effectiveBuIds.length > 0) {
        if (selectedBuIds.length > 0) {
          // Header BU selector active → strict: must match
          if (!row.businessUnitId || !effectiveBuIds.includes(row.businessUnitId)) return false;
        } else if (viewMode === "users" || viewMode === "projects" || viewMode === "vehicles" || viewMode === "resources") {
          // Filter panel only → permissive: rows without BU stay visible
          if (row.businessUnitId && !effectiveBuIds.includes(row.businessUnitId)) return false;
        }
      }
      return true;
    });
  }, [enrichedRows, viewMode, userIds, teamIds, projectIds, resourceIds, effectiveBuIds]);

  // Sorted + grouped rows (includes header rows)
  const sortedRows = useMemo<GridRow[]>(() => {
    return sortAndGroupRows(filteredRows, sortMode, viewMode, {
      labels: { noTeam: t("rows.noTeam"), noGroup: t("rows.noGroup"), noType: t("rows.noType"), noBu: t("rows.noBu") },
      collatorLocale: INTL_TAG[locale],
    });
  }, [filteredRows, sortMode, viewMode, t, locale]);

  const slotData = useMemo(() => {
    const tasksWithRow: (SlotTask & { rowId: string })[] = [];

    // Per-task resize permission:
    // - `va:<id>` (vehicle assignment) → can("vehicles:edit")
    // - `ra:<id>` (resource assignment) → can("resources:edit")
    // - real task → canResizeTask(t) (checks `tasks:resize` + modify
    //   scope; stricter than canModifyTask because the
    //   "Resize tasks" permission can be disabled
    //   independently of the modify right).
    // If false, the hit-test yields subzone "body" and the renderer does not
    // draw the handles → no "ew-resize" cursor and no dark
    // side bands on non-resizable tasks.
    const computeCanResize = (t: TaskWithUsers): boolean => {
      if (t.id.startsWith("va:")) return can("vehicles:edit");
      if (t.id.startsWith("ra:")) return can("resources:edit");
      return canResizeTask(t);
    };

    for (const t of filteredTasks) {
      const canResize = computeCanResize(t);
      if (viewMode === "users") {
        const taskUsers = t.users ?? [];
        for (const u of taskUsers) {
          tasksWithRow.push({
            id: `${t.id}:${u.id}`,
            startDate: t.startDate,
            endDate: t.endDate || t.startDate,
            startTime: t.startTime ?? null,
            endTime: t.endTime ?? null,
            rowId: u.id,
            createdAt: String(t.createdAt ?? ""),
            updatedAt: String((t as { updatedAt?: string | Date }).updatedAt ?? t.createdAt ?? ""),
            isLocked: t.isLocked ?? false,
            canResize,
          });
        }
      } else {
        const key = t[rowKey] as string | undefined;
        if (!key) continue;
        tasksWithRow.push({
          id: t.id,
          startDate: t.startDate,
          endDate: t.endDate || t.startDate,
          startTime: t.startTime ?? null,
          endTime: t.endTime ?? null,
          rowId: key,
          createdAt: String(t.createdAt ?? ""),
          updatedAt: String((t as { updatedAt?: string | Date }).updatedAt ?? t.createdAt ?? ""),
          isLocked: t.isLocked ?? false,
          canResize,
        });
      }
    }

    if (holidayMap.size > 0 && rowsQuery.data) {
      for (const row of rowsQuery.data) {
        for (const [date] of holidayMap) {
          tasksWithRow.push({
            id: `holiday:${row.id}:${date}`, // i18n-ignore pseudo-task technical identifier
            startDate: date,
            endDate: date,
            rowId: row.id,
            priority: 0,
            canResize: false,
          });
        }
      }
    }

    return allocateSlotsByRow(tasksWithRow);
  }, [filteredTasks, viewMode, rowKey, holidayMap, rowsQuery.data, canResizeTask, can]);

  const statusMap = useMemo(() => {
    if (!statusesQuery.data) return new Map();
    return new Map(statusesQuery.data.map((s) => [s.id, s]));
  }, [statusesQuery.data]);

  // Build a map of vehicle assignments by ID for the task-bar to look up
  const vehicleAssignmentMap = useMemo(() => {
    if (!vehicleAssignmentsQuery.data) return new Map<string, VehicleAssignmentWithRelations>();
    return new Map(vehicleAssignmentsQuery.data.map((a) => [`va:${a.id}`, a]));
  }, [vehicleAssignmentsQuery.data]);

  const resourceAssignmentMap = useMemo(() => {
    if (!resourceAssignmentsQuery.data) return new Map<string, ResourceAssignmentWithRelations>();
    return new Map(resourceAssignmentsQuery.data.map((a: ResourceAssignmentWithRelations) => [`ra:${a.id}`, a]));
  }, [resourceAssignmentsQuery.data]);

  return {
    tasks: filteredTasks,
    rows: rowsQuery.data ?? [],
    sortedRows,
    statuses: statusesQuery.data ?? [],
    holidays: holidayMap,
    statusMap,
    slotData,
    vehicleAssignmentMap,
    resourceAssignmentMap,
    isLoading: tasksQuery.isLoading || rowsQuery.isLoading || statusesQuery.isLoading,
    // Scoped loading: `isLoadingRows` is true while the sidebar does not have
    // its rows (users/projects/etc) — nothing can be drawn without them.
    isLoadingRows: rowsQuery.isLoading || statusesQuery.isLoading,
    // 1st task load (empty cache). Switches to false on the 1st
    // response, even on later refetches. Used to keep the DOM skeleton
    // displayed while the grid has no task to show.
    isLoadingTasks: tasksQuery.isLoading,
    // isFetching exposed: triggers the in-cell skeleton ONLY
    // when the user is really waiting for fresh data:
    //   1. 1st load (empty cache)                    → isLoading=true
    //   2. Period change (placeholder shown)         → isPlaceholderData=true
    // During a background refetch triggered by a mutation (drag, resize,
    // copy-paste, socket invalidation), the cache is already aligned through
    // the optimistic update — no need for a spurious skeleton.
    isFetching:
      tasksQuery.isLoading ||
      (tasksQuery.isFetching && tasksQuery.isPlaceholderData),
    error: tasksQuery.error || rowsQuery.error || statusesQuery.error,
    // Time-based pagination removed 2026-05-02 — global loading. These
    // fields stay exposed as no-ops so as not to break SchedulerGrid /
    // ScrollSentinels, which still depend on them.
    fetchNextPage: () => {},
    fetchPreviousPage: () => {},
    isFetchingNextPage: false,
    isFetchingPreviousPage: false,
    hasNextPage: false,
    hasPreviousPage: false,
    firstLoadedAnchor: null as string | null,
    lastLoadedAnchor: null as string | null,
  };
}
