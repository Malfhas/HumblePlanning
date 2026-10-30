"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { TeamWithUsers } from "@/types";
import { throwIfNotOk } from "@/lib/api-client";

/** Throws an `ApiClientError` (translated message, status, code, fields) on failure. */
async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useTeams() {
  return useQuery({ queryKey: ["teams"], queryFn: () => fetchApi<TeamWithUsers[]>("/api/teams") });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color?: string; businessUnitId: string }) =>
      fetchApi("/api/teams", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; color?: string; businessUnitId?: string } }) =>
      fetchApi(`/api/teams/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/teams/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

export function useReorderTeamUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, userIds }: { teamId: string; userIds: string[] }) =>
      fetchApi(`/api/teams/${teamId}/reorder`, { method: "PUT", body: JSON.stringify({ userIds }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useReorderTeams() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamIds: string[]) =>
      fetchApi(`/api/teams/reorder`, { method: "PUT", body: JSON.stringify({ teamIds }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["users", "planning-visible"] });
    },
  });
}
