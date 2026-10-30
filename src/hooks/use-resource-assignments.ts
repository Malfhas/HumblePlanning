"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";
import { lookupProjectInCache } from "./use-vehicle-assignments";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

const OPTIMISTIC_PREFIX = "__optimistic_ra_";

export function useResourceAssignments(resourceId?: string, startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (resourceId) params.set("resourceId", resourceId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  return useQuery({
    queryKey: ["resource-assignments", resourceId, startDate, endDate],
    queryFn: () => fetchApi<any[]>(`/api/resource-assignments?${params}`),
  });
}

export function useCreateResourceAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      fetchApi("/api/resource-assignments", { method: "POST", body: JSON.stringify(data) }),
    // Optimistic insert: bar visible instantly (see vehicle-assignments).
    onMutate: async (data) => {
      await qc.cancelQueries({ queryKey: ["resource-assignments"] });
      const previous = qc.getQueriesData<any[]>({ queryKey: ["resource-assignments"] });
      const tempId = `${OPTIMISTIC_PREFIX}${Date.now()}`; // i18n-ignore technical identifier
      const now = new Date().toISOString();
      const projectId = data.projectId as string | null | undefined;
      const project = projectId ? lookupProjectInCache(qc, projectId) : null;
      const optimistic = {
        id: tempId,
        ...data,
        type: data.type ?? "reservation",
        isLocked: false,
        createdAt: now,
        updatedAt: now,
        project,
        resource: null,
        assignedBy: null,
        assignedByUser: null,
        lastModifier: null,
      };
      qc.setQueriesData<any[]>(
        { queryKey: ["resource-assignments"] },
        (old) => (Array.isArray(old) ? [...old, optimistic] : old)
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, old]) => qc.setQueryData(key, old));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["resource-assignments"] }),
  });
}

export function useUpdateResourceAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      fetchApi(`/api/resource-assignments/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ["resource-assignments"] });
      const previous = qc.getQueriesData<any[]>({ queryKey: ["resource-assignments"] });
      qc.setQueriesData<any[]>(
        { queryKey: ["resource-assignments"] },
        (old) => (Array.isArray(old) ? old.map((a) => (a.id === id ? { ...a, ...data } : a)) : old)
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, old]) => qc.setQueryData(key, old));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["resource-assignments"] }),
  });
}

export function useDeleteResourceAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/resource-assignments/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["resource-assignments"] });
      const previous = qc.getQueriesData<any[]>({ queryKey: ["resource-assignments"] });
      qc.setQueriesData<any[]>(
        { queryKey: ["resource-assignments"] },
        (old) => (Array.isArray(old) ? old.filter((a) => a.id !== id) : old)
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, old]) => qc.setQueryData(key, old));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["resource-assignments"] }),
  });
}
