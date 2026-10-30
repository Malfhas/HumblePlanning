"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";
import type { ProjectLaborBudgetWithType } from "@/types";

interface BudgetWithHours extends ProjectLaborBudgetWithType {
  consumed: number;
  upcoming: number;
}

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  await throwIfNotOk(res);
  return res.json();
}

export function useProjectLaborBudgets(projectId: string | null) {
  return useQuery({
    queryKey: ["project-labor-budgets", projectId],
    queryFn: () => fetchApi<BudgetWithHours[]>(`/api/projects/${projectId}/labor-budgets`),
    enabled: !!projectId,
  });
}

export function useUpsertProjectLaborBudgets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, budgets }: { projectId: string; budgets: { laborTypeId: string; plannedHours: string }[] }) =>
      fetchApi(`/api/projects/${projectId}/labor-budgets`, { method: "PUT", body: JSON.stringify({ budgets }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-labor-budgets"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
