"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { RoleWithPermissions } from "@/types";
import { throwIfNotOk, type ApiClientError } from "@/lib/api-client";

/** Roles API error: `details.users` on a 409 (role still assigned). */
export type RoleApiError = ApiClientError & {
  details?: { users?: Array<{ id: string; name: string; firstName: string | null; email: string | null }> };
};

/** Well-known UUID of the "Super Administrateur" role (same as role-service.ts). */
export const SUPER_ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000005";

/**
 * Display name of a role. The Super Admin (non-renamable system role)
 * is displayed in the user's language (`roles.system.superAdmin`); its
 * name in the database is unchanged. The other roles are editable data.
 */
export function roleDisplayName(
  role: { id?: string | null; name: string } | null | undefined,
  t: (key: "system.superAdmin") => string,
): string {
  if (!role) return "";
  return role.id === SUPER_ADMIN_ROLE_ID ? t("system.superAdmin") : role.name;
}

/** `roleDisplayName` bound to the current language. */
export function useRoleDisplayName() {
  const t = useTranslations("roles");
  return (role: { id?: string | null; name: string } | null | undefined) => roleDisplayName(role, t);
}

/** Throws a `RoleApiError` (ApiClientError: translated message, status, code, details). */
async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: () => fetchApi<RoleWithPermissions[]>("/api/roles"),
  });
}

export function useRole(id: string | undefined) {
  return useQuery({
    queryKey: ["roles", id],
    queryFn: () => fetchApi<RoleWithPermissions>(`/api/roles/${id}`),
    enabled: !!id,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string | null; color?: string; permissions?: string[] }) =>
      fetchApi("/api/roles", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string | null; color?: string; permissions?: string[] } }) =>
      fetchApi(`/api/roles/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/api/roles/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }),
  });
}
