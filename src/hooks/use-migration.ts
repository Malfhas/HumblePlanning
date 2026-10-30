"use client";

import { onlineManager, useMutation, useQueryClient } from "@tanstack/react-query";
import { socket } from "@/lib/socket-client";
import { suspendAuthRedirect, resumeAuthRedirect } from "@/lib/session-cleanup";
import { throwIfNotOk } from "@/lib/api-client";

/** `entity`: stable identifier, label translated at render time (settings.panels.migration.entities.*). */
export interface MigrationTableAnalysis {
  entity: string;
  count: number;
}

/** Analysis warning: key settings.panels.migration.warnings.<key> + parameters. */
export interface MigrationWarning {
  key: string;
  params?: Record<string, string | number>;
}

export interface MigrationAnalysis {
  version: string;
  tables: MigrationTableAnalysis[];
  totalRecords: number;
  valid: boolean;
  warnings: MigrationWarning[];
}

export interface MigrationResult {
  success: boolean;
  userPassword: string;
  adminLogin: string;
  adminPassword: string;
  imported: Record<string, number>;
  forceReload: boolean;
}

export function useAnalyzeMigration() {
  return useMutation({
    mutationFn: async (file: File): Promise<MigrationAnalysis> => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/migration/analyze", { method: "POST", body: formData });
      await throwIfNotOk(res);
      return res.json();
    },
  });
}

export function useExecuteMigration() {
  const qc = useQueryClient();
  return useMutation({
    // The migration purges all sessions at commit: any background request
    // sent during or after the execution gets a 401. The automatic redirect
    // to /login is suspended BEFORE the call to cover that window.
    onMutate: () => {
      suspendAuthRedirect();
    },
    mutationFn: async (): Promise<MigrationResult> => {
      const res = await fetch("/api/migration/execute", { method: "POST" });
      await throwIfNotOk(res);
      return res.json();
    },
    onSuccess: () => {
      // Freeze all requests until "Finalise the migration" is clicked
      // (full page reload). Above all NO `qc.clear()`: clearing the cache
      // forces mounted components to refetch → 401 → the page empties
      // and the displayed credentials disappear.
      qc.cancelQueries();
      onlineManager.setOnline(false);
      socket.disconnect();
    },
    onError: () => {
      // Transaction rolled back on the server → sessions are intact
      resumeAuthRedirect();
    },
  });
}

export function useCleanupMigration() {
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/migration/cleanup", { method: "DELETE" });
    },
  });
}
