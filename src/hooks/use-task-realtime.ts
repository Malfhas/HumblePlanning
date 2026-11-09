"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { socket, SOCKET_ENABLED } from "@/lib/socket-client";
import { useSocket } from "@/hooks/use-socket";

type TaskCachePage = { data: unknown[]; total: number };
type RemoteTaskEvent = { action?: string; taskId?: string; taskIds?: string[] };

/**
 * Real-time sync of the tasks changed elsewhere (other users, other tabs, the
 * AI assistant): applies the `task:changed` events to every cached task list.
 * Mounted once by the planning page, whatever the view (day grid, hours grid,
 * calendar): they all read the same `["tasks", …]` queries, whose 120 s refetch
 * is off while the socket is connected (`usePlanningData`).
 */
export function useTaskRealtime() {
  const queryClient = useQueryClient();
  const { connected } = useSocket();
  useEffect(() => {
    if (!SOCKET_ENABLED || !connected) return;
    const handleTaskChanged = async (event?: RemoteTaskEvent) => {
      // ── Deletions: remove from every list locally, no
      // refetch needed. The individual query is purged FIRST
      // to avoid a 404 if a `useTask(deletedId)` component is
      // still mounted (closing modal, etc.).
      if (event?.action === "deleted" && event.taskId) {
        const deletedId = event.taskId;
        queryClient.removeQueries({ queryKey: ["tasks", deletedId], exact: true });
        queryClient.setQueriesData<TaskCachePage>({ queryKey: ["tasks"] }, (old) => {
          if (!old?.data) return old;
          const filtered = old.data.filter((t) => (t as { id: string }).id !== deletedId);
          return { ...old, data: filtered, total: Math.max(0, old.total - (old.data.length - filtered.length)) };
        });
        return;
      }
      if (event?.action === "bulk-deleted" && event.taskIds) {
        const ids = new Set(event.taskIds);
        for (const id of event.taskIds) {
          queryClient.removeQueries({ queryKey: ["tasks", id], exact: true });
        }
        queryClient.setQueriesData<TaskCachePage>({ queryKey: ["tasks"] }, (old) => {
          if (!old?.data) return old;
          const filtered = old.data.filter((t) => !ids.has((t as { id: string }).id));
          return { ...old, data: filtered, total: Math.max(0, old.total - (old.data.length - filtered.length)) };
        });
        return;
      }
      // ── Creation / update / move / resize / copy of a
      // remote task: we fetch ONLY that task (~5 KB) and
      // merge it into the cache. Avoids the global refetch of /api/tasks
      // (~5 MB) that caused a ~1 second display delay.
      if (event?.taskId) {
        try {
          const res = await fetch(`/api/tasks/${event.taskId}`);
          if (!res.ok) return;
          const task = (await res.json()) as { id: string };
          queryClient.setQueriesData<TaskCachePage>({ queryKey: ["tasks"] }, (old) => {
            if (!old?.data) return old;
            const idx = old.data.findIndex((t) => (t as { id: string }).id === task.id);
            if (idx >= 0) {
              const next = old.data.slice();
              next[idx] = task;
              return { ...old, data: next };
            }
            return { ...old, data: [...old.data, task], total: old.total + 1 };
          });
          queryClient.setQueryData(["tasks", task.id], task);
        } catch {
          // Fallback: if the fetch fails, invalidate to reconverge
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
        }
      } else {
        // Event without taskId (generic bulk update, vehicle / resource
        // assignments): global invalidate
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }
      // Dependent queries (vehicle / resource icons on the bars,
      // project summaries) — vehicle/resource are required
      // for the canvas (icons), hence an active refetch. Projects are lazy
      // (refetchType: "none") because of the big payload + only /projects
      // really needs it → refetch when that screen mounts again.
      queryClient.invalidateQueries({ queryKey: ["projects"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["vehicle-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["resource-assignments"] });
    };
    const handleConnect = () => {
      // On reconnect, we do not know what we missed → global refetch.
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    };
    socket.on("task:changed", handleTaskChanged);
    socket.on("connect", handleConnect);
    return () => {
      socket.off("task:changed", handleTaskChanged);
      socket.off("connect", handleConnect);
    };
  }, [connected, queryClient]);
}
