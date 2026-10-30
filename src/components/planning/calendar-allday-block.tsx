"use client";

import { useDraggable } from "@dnd-kit/core";
import { contrastColor } from "@/lib/utils";
import { TaskTooltip } from "./task-tooltip";
import { usePlanningStore } from "@/stores/planning-store";
import { usePermissions } from "@/hooks/use-permissions";
import type { TaskWithUsers } from "@/types";

function darkenColor(hex: string, amount: number): string {
  const c = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(c.substring(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(c.substring(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(c.substring(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

interface CalendarAllDayBlockProps {
  task: TaskWithUsers;
  columnId: string;
  onClick: (taskId: string) => void;
  onContextMenu?: (e: React.MouseEvent, taskId: string) => void;
}

export function CalendarAllDayBlock({ task, columnId, onClick, onContextMenu }: CalendarAllDayBlockProps) {
  const bgColor = task.project?.color || "#9ca3af";
  const txtColor = contrastColor(bgColor);
  const pendingDrop = usePlanningStore((s) => s.pendingDrop);

  const { canMoveTask, canCreateAnyTask } = usePermissions();
  const canDrag = (canMoveTask(task) || canCreateAnyTask) && task.isLocked !== true;
  const draggableId = `cal-allday:${task.id}:${columnId}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    data: { taskId: task.id, rowId: columnId },
    disabled: !canDrag,
  });

  const isPendingSource = pendingDrop?.taskId === task.id;
  const isDeleting = usePlanningStore((s) => s.deletingTaskIds.has(task.id));

  return (
    <TaskTooltip
      task={{
        ...task,
        createdAt: task.createdAt ? String(task.createdAt) : null,
        updatedAt: task.updatedAt ? String(task.updatedAt) : null,
      }}
      project={task.project}
      status={task.status}
    >
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        data-task-id={task.id}
        className={`cursor-pointer truncate rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight shadow-sm transition-[filter,opacity] hover:brightness-110 ${isDeleting ? "task-deleting" : ""}`}
        style={{
          backgroundColor: bgColor,
          color: txtColor,
          borderLeft: `2px solid ${darkenColor(bgColor, 0.25)}`,
          opacity: isDragging || isPendingSource ? 0.4 : 1,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(task.id);
        }}
        onContextMenu={(e) => {
          if (!onContextMenu) return;
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, task.id);
        }}
      >
        {task.project?.name ?? ""}{task.project?.name && task.title ? " · " : ""}{task.title ?? ""}
      </div>
    </TaskTooltip>
  );
}
