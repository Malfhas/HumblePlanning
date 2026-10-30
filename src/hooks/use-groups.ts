"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";
import type { ProjectGroupWithProjects } from "@/types";

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

/**
 * @param enabled Disables the fetch when the consumer knows it does not
 *   need the list right away (typically: filter panel not opened yet
 *   on /planning). Saves 1 round-trip when the schedule mounts
 *   and frees bandwidth for `/api/tasks`.
 */
export function useGroups(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["groups"],
    queryFn: () => fetchApi<ProjectGroupWithProjects[]>("/api/groups"),
    enabled: options?.enabled ?? true,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color?: string; sortOrder?: number; businessUnitId: string }) =>
      fetchApi("/api/groups", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; color?: string; sortOrder?: number; businessUnitId?: string } }) =>
      fetchApi(`/api/groups/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/groups/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  });
}

export function useReorderGroupProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, projectIds }: { groupId: string; projectIds: string[] }) =>
      fetchApi(`/api/groups/${groupId}/reorder`, { method: "PUT", body: JSON.stringify({ projectIds }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useReorderGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupIds: string[]) =>
      fetchApi(`/api/groups/reorder`, { method: "PUT", body: JSON.stringify({ groupIds }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
