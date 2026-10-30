"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { TaskFilters, CreateTask, UpdateTask, MoveTask, ResizeTask, CopyTask, RepeatTask } from "@/lib/validators/task";
import type { TaskWithUsers, PaginatedResponse } from "@/types";
import { throwIfNotOk } from "@/lib/api-client";

/** Errors: `ApiClientError` (message translated by the server, `status`, `code`). */
async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  await throwIfNotOk(res);
  return res.json();
}

export function useTasks(filters: TaskFilters, enabled = true) {
  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined) params.set(k, String(v));
      });
      return fetchApi<PaginatedResponse<TaskWithUsers>>(`/api/tasks?${params}`);
    },
    enabled,
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: ["tasks", id],
    queryFn: () => fetchApi<TaskWithUsers>(`/api/tasks/${id}`),
    enabled: !!id,
    retry: (count, error) => {
      // Don't retry on 404 (task deleted) or 403 (access denied)
      if ((error as any)?.status === 404 || (error as any)?.status === 403) return false;
      return count < 2;
    },
  });
}

// Prefix of the optimistic IDs generated client-side (TanStack Query onMutate)
// to show tasks/copies before the POST has returned the real UUID.
const OPTIMISTIC_PREFIX = "__optimistic_";

/**
 * Replaces an optimistic ID with the real task in ALL tasks caches.
 * Called from onSuccess of useCreateTask / useCopyTask as soon as the POST
 * has returned the full task with its real UUID.
 *
 * Before this fix: the optimistic ID stayed in the cache until the refetch
 * (invalidateQueries, ~300ms after the POST). Meanwhile, any subsequent
 * action (copy/delete/move) was sent with __optimistic_XXX in the URL
 * → 400 on the backend (or silent skip on the client) → action lost.
 *
 * After this fix: as soon as the POST resolves (~200ms), the cache has the real UUID.
 * Subsequent actions use the real UUID → nothing is lost.
 */
function replaceOptimisticIdInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  optimisticId: string,
  realTask: TaskWithUsers,
) {
  queryClient.setQueriesData<PaginatedResponse<TaskWithUsers>>({ queryKey: ["tasks"] }, (old) => {
    if (!old?.data) return old;
    const data = old.data.map((t) => (t.id === optimisticId ? realTask : t));
    return { ...old, data };
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTask) =>
      fetchApi<TaskWithUsers>("/api/tasks", { method: "POST", body: JSON.stringify(data) }),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["tasks"] });
      // Find project from cache so the optimistic task bar renders with correct name/color
      let project: { id: string; name: string; color: string } | undefined;
      if (data.projectId) {
        const projectsCache = queryClient.getQueriesData({ queryKey: ["projects"] });
        for (const [, cached] of projectsCache) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const list = (cached as any)?.data ?? (cached as any);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const found = Array.isArray(list) ? list.find((p: any) => p.id === data.projectId) : null;
          if (found) { project = { id: found.id, name: found.name, color: found.color }; break; }
        }
      }
      // i18n-ignore technical identifier
      const optimisticId = `__optimistic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: Partial<TaskWithUsers> = {
        id: optimisticId,
        title: data.title ?? "",
        startDate: data.startDate,
        endDate: data.endDate ?? data.startDate,
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
        projectId: data.projectId,
        project: project as TaskWithUsers["project"],
        statusId: data.statusId,
        users: (data.userIds ?? []).map((uid) => ({ id: uid, name: "" } as any)),
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueriesData<PaginatedResponse<TaskWithUsers>>({ queryKey: ["tasks"] }, (old) => {
        if (!old?.data) return old;
        return { ...old, data: [...old.data, optimistic as TaskWithUsers], total: old.total + 1 };
      });
      return { previousData, optimisticId };
    },
    onSuccess: (realTask, _vars, context) => {
      // Replace the optimistic ID with the real UUID in the cache BEFORE the
      // refetch. Lets subsequent actions (copy/delete/move) be sent
      // with the real UUID even if the user clicks before the refetch.
      if (context?.optimisticId && realTask?.id) {
        replaceOptimisticIdInCache(queryClient, context.optimisticId, realTask);
      }
    },
    onError: (_, __, context) => {
      // Rollback — the optimistic task disappears
      context?.previousData?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      // Safety net: if onSuccess failed (e.g. malformed response), the refetch
      // guarantees we converge to the DB state. But on the happy path,
      // onSuccess already replaced the ID, so the refetch is transparent.
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // refetchType: "none": mark the projects caches as stale
      // (the consumed* budgets depend on tasks) BUT do not refetch
      // actively. Screens that mount a useQuery(["projects",...])
      // will refetch on their next remount. Avoids spamming
      // `/api/projects` (2.2 MB → 400 KB after Fix A, but still)
      // on every drag/drop/edit of a task from the planning grid.
      queryClient.invalidateQueries({ queryKey: ["projects"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTask }) => {
      if (id.startsWith(OPTIMISTIC_PREFIX)) return Promise.resolve({ success: true, skipped: true });
      return fetchApi(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) });
    },
    // Optimistic update: merge the new fields into the existing task
    // immediately → the grid reflects the change without
    // waiting for the server round-trip (~1s on some networks).
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["tasks"] });
      // If projectId changes, look up the full project (name + color)
      // in the projects cache to apply it to the bar immediately.
      let newProject: { id: string; name: string; color: string } | undefined;
      const dataAny = data as Record<string, unknown>;
      if (dataAny.projectId) {
        const projectsCache = queryClient.getQueriesData({ queryKey: ["projects"] });
        for (const [, cached] of projectsCache) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const list = (cached as any)?.data ?? cached;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const found = Array.isArray(list) ? list.find((p: any) => p.id === dataAny.projectId) : null;
          if (found) { newProject = { id: found.id, name: found.name, color: found.color }; break; }
        }
      }
      const nowIso = new Date().toISOString();
      // userIds → users[] (the cache stores users, not userIds)
      const { userIds, ...restData } = dataAny as { userIds?: string[] } & Record<string, unknown>;
      queryClient.setQueriesData<PaginatedResponse<TaskWithUsers>>({ queryKey: ["tasks"] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((t) =>
            t.id === id
              ? {
                  ...t,
                  ...restData,
                  ...(userIds
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ? { users: userIds.map((uid) => ({ id: uid, name: "" } as any)) }
                    : {}),
                  ...(newProject ? { project: newProject } : {}),
                  updatedAt: nowIso,
                } as TaskWithUsers
              : t
          ),
        };
      });
      return { previousData };
    },
    onError: (_, __, context) => {
      context?.previousData?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // refetchType: "none": mark the projects caches as stale
      // (the consumed* budgets depend on tasks) BUT do not refetch
      // actively. Screens that mount a useQuery(["projects",...])
      // will refetch on their next remount. Avoids spamming
      // `/api/projects` (2.2 MB → 400 KB after Fix A, but still)
      // on every drag/drop/edit of a task from the planning grid.
      queryClient.invalidateQueries({ queryKey: ["projects"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: "single" | "all" | "before" | "after" }) => {
      // Race condition: if the user clicks create→delete very fast, the id
      // may still be optimistic (the POST has not returned the real UUID).
      // In that case, skip the DELETE: the optimistic update already removed
      // the task from the cache, and the POST (which will eventually succeed) is
      // invalidated by the onSettled below. Result: the task appears
      // then disappears immediately, as expected.
      if (id.startsWith(OPTIMISTIC_PREFIX)) return Promise.resolve({ success: true, skipped: true });
      const params = scope ? `?scope=${scope}` : "";
      return fetchApi(`/api/tasks/${id}${params}`, { method: "DELETE" });
    },
    // Optimistic update: remove the task from the cache immediately so that
    // the row height shrinks as soon as the local animation ends,
    // without waiting for the refetch.
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["tasks"] });
      queryClient.setQueriesData<PaginatedResponse<TaskWithUsers>>({ queryKey: ["tasks"] }, (old) => {
        if (!old?.data) return old;
        const filtered = old.data.filter((t) => t.id !== id);
        return { ...old, data: filtered, total: Math.max(0, old.total - (old.data.length - filtered.length)) };
      });
      return { previousData };
    },
    onError: (_, __, context) => {
      context?.previousData?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSuccess: (_, { id }) => {
      // Purge the individual query of the deleted task BEFORE invalidating
      // the lists. Without this, `invalidateQueries` marks
      // `["tasks", id]` stale, then any still-mounted component reading
      // `useTask(id)` (closing modal, leftover preview, etc.) refetches
      // → /api/tasks/{deletedId} → 404 in the console.
      queryClient.removeQueries({ queryKey: ["tasks", id], exact: true });
      // `invalidateQueries({ queryKey: ["tasks"] })` matches by prefix:
      // covers both `["tasks", "planning-window", anchor, buIds]`
      // (rolling window infiniteQuery) and the paginated `["tasks"]` (/tasks page).
      // TanStack Query only refetches observed pages (maxPages=3 on
      // /planning, so at most 3 months reloaded).
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // refetchType: "none": mark the projects caches as stale
      // (the consumed* budgets depend on tasks) BUT do not refetch
      // actively. Screens that mount a useQuery(["projects",...])
      // will refetch on their next remount. Avoids spamming
      // `/api/projects` (2.2 MB → 400 KB after Fix A, but still)
      // on every drag/drop/edit of a task from the planning grid.
      queryClient.invalidateQueries({ queryKey: ["projects"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useRepeatTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: RepeatTask }) => {
      if (id.startsWith(OPTIMISTIC_PREFIX)) return Promise.resolve({ success: true, skipped: true });
      return fetchApi(`/api/tasks/${id}/repeat`, { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // refetchType: "none": mark the projects caches as stale
      // (the consumed* budgets depend on tasks) BUT do not refetch
      // actively. Screens that mount a useQuery(["projects",...])
      // will refetch on their next remount. Avoids spamming
      // `/api/projects` (2.2 MB → 400 KB after Fix A, but still)
      // on every drag/drop/edit of a task from the planning grid.
      queryClient.invalidateQueries({ queryKey: ["projects"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useMoveTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: MoveTask }) => {
      if (id.startsWith(OPTIMISTIC_PREFIX)) return Promise.resolve({ success: true, skipped: true });
      return fetchApi(`/api/tasks/${id}/move`, { method: "PUT", body: JSON.stringify(data) });
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["tasks"] });
      const nowIso = new Date().toISOString();
      queryClient.setQueriesData<PaginatedResponse<TaskWithUsers>>({ queryKey: ["tasks"] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((t) =>
            t.id === id ? { ...t, startDate: data.startDate, endDate: data.endDate ?? t.endDate, updatedAt: nowIso, ...(data.userIds ? { users: data.userIds.map((uid: string) => ({ id: uid, name: "" })) } : {}) } : t
          ),
        };
      });
      return { previousData };
    },
    onError: (_, __, context) => {
      context?.previousData?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // refetchType: "none": mark the projects caches as stale
      // (the consumed* budgets depend on tasks) BUT do not refetch
      // actively. Screens that mount a useQuery(["projects",...])
      // will refetch on their next remount. Avoids spamming
      // `/api/projects` (2.2 MB → 400 KB after Fix A, but still)
      // on every drag/drop/edit of a task from the planning grid.
      queryClient.invalidateQueries({ queryKey: ["projects"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useResizeTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ResizeTask }) => {
      if (id.startsWith(OPTIMISTIC_PREFIX)) return Promise.resolve({ success: true, skipped: true });
      return fetchApi(`/api/tasks/${id}/resize`, { method: "PUT", body: JSON.stringify(data) });
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["tasks"] });
      // Why: no updatedAt here, resize must not change the slot
      // order (the slot allocator sorts by updatedAt). Without this, the
      // resized bar could visually jump from one slot to another
      // during the optimistic update, giving an "overshoots then
      // comes back" effect perceived as a glitch.
      queryClient.setQueriesData<PaginatedResponse<TaskWithUsers>>({ queryKey: ["tasks"] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((t) =>
            t.id === id ? { ...t, startDate: data.startDate ?? t.startDate, endDate: data.endDate, ...(data.startTime !== undefined ? { startTime: data.startTime } : {}), ...(data.endTime !== undefined ? { endTime: data.endTime } : {}) } : t
          ),
        };
      });
      return { previousData };
    },
    onError: (_, __, context) => {
      context?.previousData?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // refetchType: "none": mark the projects caches as stale
      // (the consumed* budgets depend on tasks) BUT do not refetch
      // actively. Screens that mount a useQuery(["projects",...])
      // will refetch on their next remount. Avoids spamming
      // `/api/projects` (2.2 MB → 400 KB after Fix A, but still)
      // on every drag/drop/edit of a task from the planning grid.
      queryClient.invalidateQueries({ queryKey: ["projects"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useRemoveUserFromTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, userId, scope }: { taskId: string; userId: string; scope?: "single" | "all" | "after" }) => {
      if (taskId.startsWith(OPTIMISTIC_PREFIX) || userId.startsWith(OPTIMISTIC_PREFIX)) {
        return Promise.resolve({ success: true, skipped: true });
      }
      const params = scope ? `?scope=${scope}` : "";
      return fetchApi(`/api/tasks/${taskId}/users/${userId}${params}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // refetchType: "none": mark the projects caches as stale
      // (the consumed* budgets depend on tasks) BUT do not refetch
      // actively. Screens that mount a useQuery(["projects",...])
      // will refetch on their next remount. Avoids spamming
      // `/api/projects` (2.2 MB → 400 KB after Fix A, but still)
      // on every drag/drop/edit of a task from the planning grid.
      queryClient.invalidateQueries({ queryKey: ["projects"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useCopyTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: CopyTask }) => {
      // Defensive skip: if the user clicks copy on a task whose optimistic ID
      // has not yet been replaced by the real UUID (unlucky path with
      // latency > 500ms), return skipped to avoid a useless 400.
      // The onSettled refetch will sync with the DB state.
      if (id.startsWith(OPTIMISTIC_PREFIX)) {
        return Promise.resolve({ success: true, skipped: true } as unknown as TaskWithUsers);
      }
      return fetchApi<TaskWithUsers>(`/api/tasks/${id}/copy`, { method: "POST", body: JSON.stringify(data) });
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["tasks"] });
      // Find the source task to clone its visual properties
      let source: TaskWithUsers | undefined;
      for (const [, cached] of previousData) {
        const found = (cached as PaginatedResponse<TaskWithUsers> | undefined)?.data?.find((t) => t.id === id);
        if (found) { source = found; break; }
      }
      let optimisticId: string | undefined;
      if (source) {
        // Compute correct end date preserving the source's duration
        const durationMs = source.endDate
          ? new Date(source.endDate).getTime() - new Date(source.startDate).getTime()
          : 0;
        const newEnd = new Date(new Date(data.startDate).getTime() + durationMs);
        // i18n-ignore technical identifier
        optimisticId = `__optimistic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const nowIso = new Date().toISOString();
        // Why: the copy is a "new" task in the target cell.
        // updatedAt = now → slot allocator puts it at the bottom (below the
        // tasks already in place, which have an older updatedAt).
        // Without this field, the copy inherited the source's updatedAt
        // (often old) and landed on top of the existing bars.
        const optimistic: TaskWithUsers = {
          ...source,
          id: optimisticId,
          startDate: data.startDate,
          endDate: newEnd.toISOString().slice(0, 10),
          // Why: if data provides startTime/endTime (paste on an hourly cell,
          // drop in hours view), apply them; otherwise inherit from the source.
          // Without this, the optimistic copy appeared in the original slot
          // for a flash before the server moved it to the right slot.
          ...(data.startTime !== undefined ? { startTime: data.startTime } : {}),
          ...(data.endTime !== undefined ? { endTime: data.endTime } : {}),
          // Same for the row fields (projectId, placeId, resourceId,
          // userIds), otherwise the copy appears in the source row.
          ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
          ...(data.placeId !== undefined ? { placeId: data.placeId } : {}),
          ...(data.resourceId !== undefined ? { resourceId: data.resourceId } : {}),
          users: data.userIds ? data.userIds.map((uid) => ({ id: uid, name: "" } as any)) : source.users,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        queryClient.setQueriesData<PaginatedResponse<TaskWithUsers>>({ queryKey: ["tasks"] }, (old) => {
          if (!old?.data) return old;
          return { ...old, data: [...old.data, optimistic], total: old.total + 1 };
        });
      }
      return { previousData, optimisticId };
    },
    onSuccess: (realTask, _vars, context) => {
      // Same logic as useCreateTask: replace the optimistic ID with the
      // real UUID in the cache as soon as the POST resolves. Lets subsequent
      // actions on the copy (edit, delete, re-copy) use the real UUID.
      if (context?.optimisticId && realTask && (realTask as TaskWithUsers).id) {
        replaceOptimisticIdInCache(queryClient, context.optimisticId, realTask as TaskWithUsers);
      }
    },
    onError: (_, __, context) => {
      context?.previousData?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // refetchType: "none": mark the projects caches as stale
      // (the consumed* budgets depend on tasks) BUT do not refetch
      // actively. Screens that mount a useQuery(["projects",...])
      // will refetch on their next remount. Avoids spamming
      // `/api/projects` (2.2 MB → 400 KB after Fix A, but still)
      // on every drag/drop/edit of a task from the planning grid.
      queryClient.invalidateQueries({ queryKey: ["projects"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}
