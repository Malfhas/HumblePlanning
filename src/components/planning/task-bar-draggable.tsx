"use client";

import { memo, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import { TaskBar } from "./task-bar";
import { TaskTooltip } from "./task-tooltip";
import { usePlanningStore } from "@/stores/planning-store";
import type { ViewMode } from "@/stores/planning-store";
import type { TaskWithUsers, Status } from "@/types";

interface DraggableTaskBarProps {
  task: TaskWithUsers;
  status: Status | undefined;
  viewMode?: ViewMode;
  showUserCount?: boolean;
  showFileIcon?: boolean;
  slot: number;
  rowId: string;
  /** Permissions computed upstream (at SchedulerGrid level) to avoid
   *  instantiating usePermissions() — which holds 3 useQuery — on every
   *  bar. With ~300 bars, that created ~900 React Query subscriptions
   *  notified on every session/permissions mutation. */
  canMoveTask: (task: TaskWithUsers) => boolean;
  canResizeTask: (task: TaskWithUsers) => boolean;
  canCreateAnyTask: boolean;
  onTaskClick?: (taskId: string) => void;
  onTaskContextMenu?: (e: React.MouseEvent, taskId: string, rowId: string) => void;
  onResize?: (taskId: string, startDate: string, endDate: string) => void;
}

// Wrapped in memo(): without it, every parent re-render (e.g. vertical scroll
// that re-evaluates GridRow) re-runs useDraggable and 3
// Zustand selectors on ~300 bars. With memo, only the bars whose
// props (task, status, slot, etc.) actually change re-render.
export const DraggableTaskBar = memo(function DraggableTaskBar({
  task,
  status,
  viewMode,
  showUserCount,
  showFileIcon,
  slot,
  rowId,
  canMoveTask,
  canResizeTask,
  canCreateAnyTask,
  onTaskClick,
  onTaskContextMenu,
  onResize,
}: DraggableTaskBarProps) {
  const draggableId = `${task.id}:${rowId}`;
  // Allow the drag if the user can move the task (modifyScope OK)
  // or can create (copy through drag). The DropActionMenu then handles
  // the visibility of "Move" vs "Copy" based on the fine-grained permissions.
  const canDrag = (canMoveTask(task) || canCreateAnyTask) && task.isLocked !== true;
  const canResize = canResizeTask(task) && task.isLocked !== true;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    data: { taskId: task.id, rowId },
    disabled: !canDrag,
  });
  // Granular Zustand selectors: only this bar re-renders when its own
  // data changes (not every bar on each store mutation).
  // Before: `pendingDrop` read in full on ~100-300 bars → all of them
  //   re-rendered on every setPendingDrop during a drag.
  // Before: `deletingTaskIds.has(...)` read the whole Set → every bar
  //   re-rendered on every markTaskDeleting.
  const isPendingSource = usePlanningStore(
    useCallback((s) => s.pendingDrop?.taskId === task.id, [task.id])
  );
  // Primitive boolean selector: Zustand only notifies on an actual change
  // of the value. (`ganttResizeActive` is already a primitive, so it is fine
  // even without useCallback, but the wrapper makes the intent explicit and
  // avoids any subtle future trap if the store shape evolves.)
  const isResizing = usePlanningStore(
    useCallback((s) => s.ganttResizeActive, [])
  );
  const isDeleting = usePlanningStore(
    useCallback((s) => s.deletingTaskIds.has(task.id), [task.id])
  );

  const setRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
  }, [setNodeRef]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const taskAny = task as any;
  return (
    <TaskTooltip
      task={taskAny}
      project={task.project}
      status={status}
      viewMode={viewMode}
      forceHidden={isResizing || isDragging}
    >
      <TaskBar
        ref={setRef}
        task={taskAny}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status={status as any}
        project={task.project}
        viewMode={viewMode}
        showUserCount={showUserCount}
        showFileIcon={showFileIcon}
        slot={slot}
        onClick={onTaskClick}
        onContextMenu={onTaskContextMenu ? (e, taskId) => onTaskContextMenu(e, taskId, rowId) : undefined}
        onResize={canResize ? onResize : undefined}
        rowId={rowId}
        className={isDeleting ? "task-deleting" : undefined}
        style={{ opacity: isDragging ? 0.3 : isPendingSource ? 0.35 : 1 }}
        {...listeners}
        {...attributes}
      />
    </TaskTooltip>
  );
});
