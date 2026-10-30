"use client";

import { useQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { idsToResolve } from "./actions";

/**
 * Labels of the objects targeted by a proposed write (task title, name
 * of the project, of the people, of the status…), read through the application routes (separate
 * cache): without this, the `delete-task` card would be empty and
 * the `create-task` one would not say who the task is assigned to. An object
 * the user cannot read stays labelled as such, without error.
 */

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

type Named = { id: string; name?: string | null };

export function useActionLabels(input: unknown): (key: string, id: string) => string | undefined {
  const t = useTranslations("aiChat.actions.labels");
  const { intlTag } = useDateFormat();
  const INACCESSIBLE = t("notVisible");
  const ids = idsToResolve(input);
  const singles = [
    ...(ids.taskId ?? []).map((id) => ({ key: "taskId", id, queryKey: ["ai-chat-label", "task", id], url: `/api/tasks/${id}` })),
    ...(ids.projectId ?? []).map((id) => ({ key: "projectId", id, queryKey: ["ai-chat-label", "project", id], url: `/api/projects/${id}` })),
    ...[...(ids.userIds ?? []), ...(ids.ownerId ?? [])].map((id) => ({ key: "user", id, queryKey: ["ai-chat-label", "user", id], url: `/api/users/${id}` })),
  ];
  const lists = [
    ...(ids.statusId ? [{ key: "statusId", queryKey: ["ai-chat-label", "statuses"], url: "/api/statuses" }] : []),
    ...(ids.placeId ? [{ key: "placeId", queryKey: ["ai-chat-label", "places"], url: "/api/places" }] : []),
    ...(ids.resourceId ? [{ key: "resourceId", queryKey: ["ai-chat-label", "resources"], url: "/api/resources?includeOutOfService=false" }] : []),
    ...(ids.groupId ? [{ key: "groupId", queryKey: ["ai-chat-label", "groups"], url: "/api/groups" }] : []),
    ...(ids.businessUnitId ? [{ key: "businessUnitId", queryKey: ["ai-chat-label", "business-units"], url: "/api/business-units" }] : []),
  ];

  const singleQueries = useQueries({
    queries: singles.map((q) => ({
      queryKey: q.queryKey,
      queryFn: () => fetchJson<Record<string, unknown>>(q.url),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const listQueries = useQueries({
    queries: lists.map((q) => ({
      queryKey: q.queryKey,
      queryFn: () => fetchJson<Named[] | { data?: Named[] }>(q.url),
      retry: false,
      staleTime: 60_000,
    })),
  });

  return (key, id) => {
    if (key === "taskId" || key === "projectId" || key === "userIds" || key === "ownerId") {
      const target = key === "userIds" || key === "ownerId" ? "user" : key;
      const index = singles.findIndex((q) => q.key === target && q.id === id);
      const query = singleQueries[index];
      if (!query || query.isPending) return undefined;
      if (query.isError || !query.data) return INACCESSIBLE;
      const d = query.data;
      if (target === "taskId") {
        const title = (d.title as string | null) || t("untitledTask");
        const start = typeof d.startDate === "string" ? new Date(`${d.startDate.slice(0, 10)}T00:00:00`) : null;
        if (!start || Number.isNaN(start.getTime())) return title;
        const day = new Intl.DateTimeFormat(intlTag, { dateStyle: "short" }).format(start);
        // i18n-ignore task title and already formatted date
        return `${title} (${day})`;
      }
      if (target === "projectId") {
        return d.businessNumber ? `${String(d.businessNumber)} - ${String(d.name)}` : String(d.name ?? INACCESSIBLE);
      }
      return [d.firstName, d.name].filter(Boolean).join(" ") || INACCESSIBLE;
    }
    const index = lists.findIndex((q) => q.key === key);
    const query = listQueries[index];
    if (!query || query.isPending) return undefined;
    if (query.isError || !query.data) return INACCESSIBLE;
    const list = Array.isArray(query.data) ? query.data : (query.data.data ?? []);
    return list.find((element) => element.id === id)?.name ?? INACCESSIBLE;
  };
}
