"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useCallback } from "react";
import { throwIfNotOk } from "@/lib/api-client";

import type { UserWithTeam } from "@/types";

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

interface SessionResponse {
  user: { id: string; email?: string; name?: string };
  session: { id: string; expiresAt: string; token: string };
}

/**
 * Resolution of the 3 mutex groups of Block 3 (schedule scope).
 * Must stay in sync with the server-side `permission-service.ts`.
 */
export type ProjectScope = "all" | "bu" | "team" | "own" | "assigned_only";
export type UserScope = "all" | "bu" | "team" | "self";
export type ModifyScope = "readonly" | "all" | "team" | "own_project" | "own";

async function fetchApi<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  await throwIfNotOk(res);
  return res.json();
}

function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => fetchApi<SessionResponse>("/api/auth/get-session"),
    staleTime: 5 * 60 * 1000,
  });
}

function useFullUser(userId: string | undefined) {
  return useQuery({
    queryKey: ["users", userId],
    queryFn: () => fetchApi<UserWithTeam>(`/api/users/${userId}`),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

// ════════════════════════════════════════════════════════════════════════
// Main hook
// ════════════════════════════════════════════════════════════════════════

export function usePermissions() {
  const { data: sessionData } = useSession();
  const userId = sessionData?.user?.id;
  const { data: fullUser } = useFullUser(userId);

  const role = fullUser?.role ?? null;

  // Fetch permissions from dedicated auth endpoint (no roles:view required)
  const { data: permData } = useQuery({
    queryKey: ["auth-permissions", userId],
    queryFn: () => fetchApi<{ permissions: string[]; isAdmin: boolean }>("/api/auth/permissions"),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  const isAdmin = permData?.isAdmin ?? role?.isAdmin ?? false;

  const permissions: string[] = useMemo(() => {
    if (isAdmin) return [];
    return permData?.permissions ?? [];
  }, [isAdmin, permData]);

  const can = useCallback(
    (permission: string): boolean => {
      if (isAdmin) return true;
      return permissions.includes(permission);
    },
    [permissions, isAdmin]
  );

  // ──── Block 3 — Scope resolution ───────────────────────────────────

  const projectScope = useMemo<ProjectScope>(() => {
    if (isAdmin) return "all";
    if (permissions.includes("scope:projects_all")) return "all";
    if (permissions.includes("scope:projects_bu")) return "bu";
    if (permissions.includes("scope:projects_team")) return "team";
    if (permissions.includes("scope:projects_own")) return "own";
    return "assigned_only";
  }, [isAdmin, permissions]);

  const userScope = useMemo<UserScope>(() => {
    if (isAdmin) return "all";
    if (permissions.includes("scope:users_all")) return "all";
    if (permissions.includes("scope:users_bu")) return "bu";
    if (permissions.includes("scope:users_team")) return "team";
    return "self";
  }, [isAdmin, permissions]);

  const modifyScope = useMemo<ModifyScope>(() => {
    if (isAdmin) return "all";
    if (permissions.includes("scope:modify_all")) return "all";
    if (permissions.includes("scope:modify_team")) return "team";
    if (permissions.includes("scope:modify_own_project")) return "own_project";
    if (permissions.includes("scope:modify_own")) return "own";
    return "readonly";
  }, [isAdmin, permissions]);

  const buScope = useMemo<"all" | "own">(() => {
    if (isAdmin) return "all";
    if (permissions.includes("scope:bu_all")) return "all";
    return "own";
  }, [isAdmin, permissions]);

  // ──── Task-level capability checks ─────────────────────────────────

  /**
   * True if the user can modify a task (generic fields).
   * Based on the modification level + the task's assignees / creator.
   */
  const canModifyTask = useCallback(
    (task: {
      users?: { id: string; teamId?: string | null }[] | null;
      creatorId?: string | null;
      project?: { ownerId?: string | null } | null;
      projectOwnerId?: string | null;
      teamId?: string | null;
    }): boolean => {
      if (isAdmin) return true;
      if (modifyScope === "readonly") return false;
      if (modifyScope === "all") return true;
      if (!userId) return false;

      if (modifyScope === "team") {
        const myTeamId = fullUser?.teamId;
        if (!myTeamId) return false;
        return task.users?.some((u) => u.teamId === myTeamId) ?? false;
      }

      if (modifyScope === "own_project") {
        const ownerId = task.projectOwnerId ?? task.project?.ownerId ?? null;
        return ownerId === userId;
      }

      // modifyScope === "own"
      const isAssigned = task.users?.some((u) => u.id === userId) ?? false;
      return isAssigned || task.creatorId === userId;
    },
    [isAdmin, modifyScope, userId, fullUser?.teamId]
  );

  /** True if the user can create tasks (ignores the visibility scope). */
  const canCreateAnyTask = useMemo(
    () => isAdmin || (modifyScope !== "readonly" && permissions.includes("tasks:create")),
    [isAdmin, modifyScope, permissions]
  );

  /**
   * True if the user can create a task on the clicked row of the
   * schedule (pre-check on click to silently block opening the popup
   * in the cases where the modifyScope definitely forbids creation).
   *
   * Partial cases: in viewMode=projects with modifyScope=team/own, or in
   * viewMode=users with modifyScope=own_project, the missing info
   * (user or project) is not known yet — let it through, the final gate
   * stays on the dialog's Save button + the server.
   */
  const canCreateOnPlanningRow = useCallback(
    (
      viewMode: "users" | "projects" | "resources" | "vehicles" | string,
      row: { id: string; teamId?: string | null; ownerId?: string | null } | null | undefined
    ): boolean => {
      if (isAdmin) return true;
      if (!permissions.includes("tasks:create")) return false;
      if (modifyScope === "readonly") return false;
      if (!userId || !row) return true;

      if (viewMode === "users") {
        if (modifyScope === "team") {
          const myTeamId = fullUser?.teamId;
          if (!myTeamId) return false;
          return row.teamId === myTeamId;
        }
        if (modifyScope === "own") {
          return row.id === userId;
        }
      }

      if (viewMode === "projects") {
        if (modifyScope === "own_project") {
          return (row.ownerId ?? null) === userId;
        }
      }

      return true;
    },
    [isAdmin, permissions, modifyScope, userId, fullUser?.teamId]
  );

  /**
   * True if the user can create a task with the given assignees and project,
   * honoring their `scope:modify_*` (mirror of the server-side `canCreateTask`
   * in `permission-service.ts`).
   */
  const canCreateTaskFor = useCallback(
    (params: {
      assignedUsers: { id: string; teamId?: string | null }[];
      projectOwnerId?: string | null;
    }): boolean => {
      if (isAdmin) return true;
      if (!permissions.includes("tasks:create")) return false;
      if (modifyScope === "readonly") return false;
      if (!userId) return false;

      if (modifyScope === "team") {
        const myTeamId = fullUser?.teamId;
        if (!myTeamId) return false;
        if (params.assignedUsers.length === 0) return false;
        return params.assignedUsers.every((u) => u.teamId === myTeamId);
      }

      if (modifyScope === "own_project") {
        return (params.projectOwnerId ?? null) === userId;
      }

      if (modifyScope === "own") {
        if (params.assignedUsers.length === 0) return false;
        return params.assignedUsers.every((u) => u.id === userId);
      }

      // modifyScope === "all" — no extra restriction on the client
      // (the server still applies the users visibility scope).
      return true;
    },
    [isAdmin, modifyScope, permissions, userId, fullUser?.teamId]
  );

  /** True if the user can delete this specific task. */
  const canDeleteTask = useCallback(
    (task: Parameters<typeof canModifyTask>[0]): boolean => {
      if (isAdmin) return true;
      if (!permissions.includes("tasks:delete")) return false;
      return canModifyTask(task);
    },
    [isAdmin, permissions, canModifyTask]
  );

  /** True if the user can move this task (drag & drop). */
  const canMoveTask = useCallback(
    (task: Parameters<typeof canModifyTask>[0]): boolean => {
      if (isAdmin) return true;
      if (!permissions.includes("tasks:move")) return false;
      return canModifyTask(task);
    },
    [isAdmin, permissions, canModifyTask]
  );

  /** True if the user can resize this task. */
  const canResizeTask = useCallback(
    (task: Parameters<typeof canModifyTask>[0]): boolean => {
      if (isAdmin) return true;
      if (!permissions.includes("tasks:resize")) return false;
      return canModifyTask(task);
    },
    [isAdmin, permissions, canModifyTask]
  );

  /** True if the user can lock/unlock this task. */
  const canLockTask = useCallback(
    (task: Parameters<typeof canModifyTask>[0]): boolean => {
      if (isAdmin) return true;
      if (!permissions.includes("tasks:lock")) return false;
      return canModifyTask(task);
    },
    [isAdmin, permissions, canModifyTask]
  );

  /** True if the user can assign/unassign users to a task. */
  const canAssignToTask = useCallback(
    (task: Parameters<typeof canModifyTask>[0]): boolean => {
      if (isAdmin) return true;
      if (!permissions.includes("tasks:assign")) return false;
      return canModifyTask(task);
    },
    [isAdmin, permissions, canModifyTask]
  );

  // ──── Project-level capability checks ──────────────────────────────

  // Decoupled from modifyScope (which governs /planning task edits only).
  // Visibility of the project is already enforced by projectScope upstream:
  // if the client received the project, they have projects:edit right over it.
  const canModifyProject = useCallback(
    (_project: { ownerId?: string | null }): boolean => {
      void _project;
      if (isAdmin) return true;
      return permissions.includes("projects:edit");
    },
    [isAdmin, permissions]
  );

  return {
    user: fullUser ?? null,
    userId: userId ?? null,
    role,
    permissions,
    isAdmin,
    can,
    // Scope resolvers
    projectScope,
    userScope,
    modifyScope,
    buScope,
    // Task capabilities
    canCreateAnyTask,
    canCreateTaskFor,
    canCreateOnPlanningRow,
    canModifyTask,
    canDeleteTask,
    canMoveTask,
    canResizeTask,
    canLockTask,
    canAssignToTask,
    // Project capabilities
    canModifyProject,
    isLoading: !fullUser,
  };
}
