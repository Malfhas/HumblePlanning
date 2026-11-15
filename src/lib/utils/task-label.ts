import type { ViewMode } from "@/stores/planning-store";
import type { TaskLabelMode } from "@/lib/types/task-label";

/**
 * Computes the label shown on a task bar for the active view
 * mode (users / projects / places / resources / vehicles).
 *
 * Logic aligned with the old DOM grid (see `task-bar.tsx`):
 *  - **users** view     → project name (the row already carries the user)
 *  - **projects** view  → name of the user(s)
 *  - **places** / **resources** view → "Project — Users"
 *  - **vehicles** view  → task title
 *  - Fallback           → title or `untitled` (translated label, precomputed
 *    by the caller: `planning.canvas.untitled`)
 */
export function getTaskLabel(
  task: {
    title?: string | null;
    user?: { name?: string | null } | null;
    users?: { name?: string | null }[];
    project?: { name?: string | null } | null;
  },
  viewMode: ViewMode | undefined,
  untitled: string,
  taskLabelMode: TaskLabelMode = "project"
): string {
  const title = task.title || untitled;
  const userName = task.users?.length
    ? task.users.map((u) => u.name).filter(Boolean).join(", ")
    : task.user?.name;
  switch (viewMode) {
    case "users": {
      const taskName = task.title?.trim();
      const projectName = task.project?.name?.trim();
      if (taskLabelMode === "title") return taskName || projectName || untitled;
      if (taskLabelMode === "both") {
        return taskName && projectName
          ? `${taskName} · ${projectName}`
          : taskName || projectName || untitled;
      }
      return projectName || taskName || untitled;
    }
    case "projects":
      return userName || title;
    case "places":
    case "resources": {
      const parts = [task.project?.name, userName].filter(Boolean);
      return parts.length > 0 ? parts.join(" — ") : title;
    }
    case "vehicles":
      return title;
    default:
      return title;
  }
}
