"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";

export interface EmailStatus {
  configured: boolean;
  provider: string;
  missingKeys: string[];
}

/**
 * Special keys returned by /api/config that are not string values:
 * - `_envManaged: string[]`  list of SECRET_KEYS provided by .env
 * - `_dbConfigured: string[]` list of SECRET_KEYS with a non-empty DB value
 * - `_emailStatus: EmailStatus` email sending status
 *
 * To keep the `Record<string, string | null>` signature used by all the
 * existing consumers, these metadata are serialized as JSON strings on the server
 * (`_`-prefixed key) and dedicated helpers read them on the client.
 */

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  await throwIfNotOk(res);
  return res.json();
}

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => fetchApi<Record<string, string | null>>("/api/config"),
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, string>) =>
      fetchApi<Record<string, string | null>>("/api/config", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }),
  });
}

/**
 * Extracts the `_envManaged`, `_dbConfigured`, `_emailStatus` metadata from a config
 * response. The values are encoded as JSON strings on the server to stay
 * compatible with `Record<string, string | null>`.
 */
export function parseConfigMeta(config: Record<string, string | null> | undefined): {
  envManaged: string[];
  dbConfigured: string[];
  emailStatus: EmailStatus | null;
  altchaConfigured: boolean;
} {
  const parseJsonField = <T>(raw: string | null | undefined, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };
  return {
    envManaged: parseJsonField<string[]>(config?._envManaged, []),
    dbConfigured: parseJsonField<string[]>(config?._dbConfigured, []),
    emailStatus: parseJsonField<EmailStatus | null>(config?._emailStatus, null),
    altchaConfigured: config?._altchaConfigured === "true",
  };
}
