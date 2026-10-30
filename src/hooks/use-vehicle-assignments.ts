"use client";

import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";
import type { VehicleAssignmentWithRelations } from "@/types";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

const OPTIMISTIC_PREFIX = "__optimistic_va_";

/** Looks up a project by id in all `["projects", ...]` queries
 *  (filtered lists + singletons through `useProject(id)`). Used by the
 *  optimistic onMutate to show the right name + color from the 1st frame. */
export function lookupProjectInCache(
  qc: QueryClient,
  projectId: string
): { id: string; name: string; color: string | null } | null {
  const all = qc.getQueriesData<unknown>({ queryKey: ["projects"] });
  for (const [, data] of all) {
    if (Array.isArray(data)) {
      const hit = (data as Array<{ id: string; name: string; color?: string | null }>).find((p) => p?.id === projectId);
      if (hit) return { id: hit.id, name: hit.name, color: hit.color ?? null };
    } else if (data && typeof data === "object" && (data as { id?: string }).id === projectId) {
      const p = data as { id: string; name: string; color?: string | null };
      return { id: p.id, name: p.name, color: p.color ?? null };
    }
  }
  return null;
}

export function useVehicleAssignments(vehicleId?: string, startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (vehicleId) params.set("vehicleId", vehicleId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const qs = params.toString();

  return useQuery({
    queryKey: ["vehicle-assignments", vehicleId, startDate, endDate],
    queryFn: () => fetchApi<VehicleAssignmentWithRelations[]>(`/api/vehicle-assignments${qs ? `?${qs}` : ""}`),
  });
}

export function useVehicleAssignmentsByVehicle(vehicleId: string | null) {
  return useQuery({
    queryKey: ["vehicle-assignments", "vehicle", vehicleId],
    queryFn: () => fetchApi<VehicleAssignmentWithRelations[]>(`/api/vehicles/${vehicleId}/assignments`),
    enabled: !!vehicleId,
  });
}

export function useCreateVehicleAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      vehicleId: string;
      taskId?: string | null;
      projectId?: string | null;
      startDate: string;
      endDate: string;
      startTime?: string | null;
      endTime?: string | null;
      notes?: string | null;
      type?: string;
    }) =>
      fetchApi("/api/vehicle-assignments", { method: "POST", body: JSON.stringify(data) }),
    // Optimistic insert: immediately adds the new assignment to the
    // cache → the bar appears without waiting for the API round-trip.
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: ["vehicle-assignments"] });
      const previous = qc.getQueriesData<VehicleAssignmentWithRelations[]>({ queryKey: ["vehicle-assignments"] });
      const tempId = `${OPTIMISTIC_PREFIX}${Date.now()}`; // i18n-ignore technical identifier
      const now = new Date().toISOString();
      // Resolve the project from the TanStack Query cache — otherwise
      // the optimistic entry shows "Reservation"/"Maintenance" (pseudo-task
      // fallback) before the server returns the real project.
      const project = data.projectId ? lookupProjectInCache(qc, data.projectId) : null;
      const optimistic = {
        id: tempId,
        vehicleId: data.vehicleId,
        taskId: data.taskId ?? null,
        projectId: data.projectId ?? null,
        startDate: data.startDate,
        endDate: data.endDate,
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
        notes: data.notes ?? null,
        type: data.type ?? "reservation",
        isLocked: false,
        createdAt: now,
        updatedAt: now,
        project,
        vehicle: null,
        assignedBy: null,
        assignedByUser: null,
        lastModifier: null,
      } as unknown as VehicleAssignmentWithRelations;
      qc.setQueriesData<VehicleAssignmentWithRelations[]>(
        { queryKey: ["vehicle-assignments"] },
        (old) => (Array.isArray(old) ? [...old, optimistic] : old)
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, old]) => qc.setQueryData(key, old));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["vehicle-assignments"] }),
  });
}

export function useUpdateVehicleAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: {
      id: string;
      data: {
        vehicleId?: string;
        taskId?: string | null;
        projectId?: string | null;
        startDate?: string;
        endDate?: string;
        startTime?: string | null;
        endTime?: string | null;
        notes?: string | null;
        type?: string;
        isLocked?: boolean;
      };
    }) =>
      fetchApi(`/api/vehicle-assignments/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    // Optimistic patch: the bar updates immediately (resize,
    // move, lock, etc.) without waiting for the API.
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ["vehicle-assignments"] });
      const previous = qc.getQueriesData<VehicleAssignmentWithRelations[]>({ queryKey: ["vehicle-assignments"] });
      qc.setQueriesData<VehicleAssignmentWithRelations[]>(
        { queryKey: ["vehicle-assignments"] },
        (old) => (Array.isArray(old) ? old.map((a) => (a.id === id ? { ...a, ...data } : a)) : old)
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, old]) => qc.setQueryData(key, old));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["vehicle-assignments"] }),
  });
}

export function useDeleteVehicleAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/vehicle-assignments/${id}`, { method: "DELETE" }),
    // Optimistic remove: the bar disappears immediately → no flicker
    // between the end of the delete anim and the post-API refetch.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["vehicle-assignments"] });
      const previous = qc.getQueriesData<VehicleAssignmentWithRelations[]>({ queryKey: ["vehicle-assignments"] });
      qc.setQueriesData<VehicleAssignmentWithRelations[]>(
        { queryKey: ["vehicle-assignments"] },
        (old) => (Array.isArray(old) ? old.filter((a) => a.id !== id) : old)
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, old]) => qc.setQueryData(key, old));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["vehicle-assignments"] }),
  });
}
