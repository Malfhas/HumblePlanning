"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConfig } from "@/hooks/use-config";
import { apiFetch } from "@/lib/api-client";
import type { VersionStatusResponse } from "@/lib/services/update-check-service";

export type { VersionStatusResponse, ReleaseInfo, UpdateStatus, UpdateCheckError } from "@/lib/services/update-check-service";

const QUERY_KEY = "system-version";

/**
 * Update status (GET /api/system/version, permission pages:settings).
 * The key includes the UPDATE_CHECK_ENABLED setting: saving it in the
 * settings reloads the status. The server only contacts GitHub once every
 * 24 h; the one-hour client cache just avoids useless round-trips.
 */
export function useUpdateCheck({ enabled = true }: { enabled?: boolean } = {}) {
  const { data: config } = useConfig();
  return useQuery({
    queryKey: [QUERY_KEY, config?.UPDATE_CHECK_ENABLED ?? null],
    queryFn: () => apiFetch<VersionStatusResponse>("/api/system/version"),
    enabled: enabled && config !== undefined,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

/** "Check now" (POST /api/system/version/check, permission settings:edit). */
export function useForceUpdateCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<VersionStatusResponse>("/api/system/version/check", { method: "POST" }),
    onSuccess: (data) => qc.setQueriesData({ queryKey: [QUERY_KEY] }, data),
  });
}
