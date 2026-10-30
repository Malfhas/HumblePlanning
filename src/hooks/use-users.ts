"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateUser, UpdateUser } from "@/lib/validators/user";
import type { UserWithTeam } from "@/types";
import { throwIfNotOk } from "@/lib/api-client";

/** Throws an `ApiClientError` (status, code, fields, details) on failure. */
async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useUsers(search?: string, activeOnly = true, unscoped = false) {
  return useQuery({
    queryKey: ["users", search, activeOnly, unscoped],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (!activeOnly) params.set("active", "false");
      if (unscoped) params.set("unscoped", "true");
      return fetchApi<UserWithTeam[]>(`/api/users?${params}`);
    },
  });
}

export function useUser(id: string | null, unscoped = false) {
  return useQuery({
    queryKey: ["users", id, unscoped],
    queryFn: () => fetchApi<UserWithTeam>(`/api/users/${id}${unscoped ? "?unscoped=true" : ""}`),
    enabled: !!id,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUser) =>
      fetchApi("/api/users", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUser }) =>
      fetchApi(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useArchiveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      fetchApi(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}
