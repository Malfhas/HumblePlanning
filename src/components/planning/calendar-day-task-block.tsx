"use client";

import { useDraggable } from "@dnd-kit/core";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { contrastColor } from "@/lib/utils";
import { usePlanningStore } from "@/stores/planning-store";
import { usePermissions } from "@/hooks/use-permissions";
import { useDateFormat } from "@/hooks/use-date-format";
import { CalendarPeople, CalendarTaskEnd, CalendarTaskTooltip, darkenColor, taskHeadline, TASK_FALLBACK_COLOR } from "./calendar-items";
import type { TaskWithUsers } from "@/types";

interface CalendarDayTaskBlockProps {
  task: TaskWithUsers;
  columnId: string;
  onClick: (taskId: string) => void;
  onContextMenu?: (e: React.MouseEvent, taskId: string) => void;
  /** Unique draggable id when the same task appears more than once in the view. */
  draggableKey?: string;
  /** Calendar of everyone: the assignees of the task are shown. */
  showPeople?: boolean;
}

/** Task card of the calendar day lists ("days" view, day agenda of the mobile month). */
export function CalendarDayTaskBlock({ task, columnId, onClick, onContextMenu, draggableKey, showPeople }: CalendarDayTaskBlockProps) {
  const t = useTranslations("planning");
  const bgColor = task.project?.color || TASK_FALLBACK_COLOR;
  const txtColor = contrastColor(bgColor);
  const pendingDrop = usePlanningStore((s) => s.pendingDrop);

  const { canMoveTask, canCreateAnyTask } = usePermissions();
  const canDrag = (canMoveTask(task) || canCreateAnyTask) && task.isLocked !== true;
  const draggableId = `cal-day:${task.id}:${columnId}${draggableKey ? `:${draggableKey}` : ""}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId,
    data: { taskId: task.id, rowId: columnId },
    disabled: !canDrag,
  });

  const isPendingSource = pendingDrop?.taskId === task.id;
  const isDeleting = usePlanningStore((s) => s.deletingTaskIds.has(task.id));
  const { formatTime } = useDateFormat();
  const timeLabel = task.startTime
    ? `${formatTime(task.startTime)}${task.endTime ? ` – ${formatTime(task.endTime)}` : ""}`
    : "";

  return (
    <CalendarTaskTooltip task={task}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        data-task-id={task.id}
        className={`cursor-pointer rounded-md px-2 py-1.5 text-xs shadow-sm transition-[filter,opacity] hover:brightness-110 ${isDeleting ? "task-deleting" : ""}`}
        style={{
          backgroundColor: bgColor,
          color: txtColor,
          borderLeft: `3px solid ${darkenColor(bgColor, 0.25)}`,
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
        {/* Text on the left; the assignees on the right, vertically centered */}
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1 font-medium leading-tight">
              {task.isLocked && <Lock className="mt-px size-3 shrink-0 opacity-80" aria-hidden />}
              <span className="line-clamp-2">{taskHeadline(task, t("canvas.untitled"))}</span>
            </div>
            {(timeLabel || (task.title && task.project?.name)) && (
              <div className="mt-0.5 flex min-w-0 gap-1 text-[11px] leading-tight opacity-80">
                {timeLabel && <span className="shrink-0 tabular-nums">{timeLabel}</span>}
                {task.title && task.project?.name && <span className="truncate">{timeLabel ? "· " : ""}{task.project.name}</span>}
              </div>
            )}
          </div>
          {/* At the end: attachments, notes, milestone, then the assignees */}
          <CalendarTaskEnd
            task={task}
            after={showPeople ? <CalendarPeople users={task.users} max={3} size="sm" /> : undefined}
            iconClassName="size-3"
            className="gap-1.5"
          />
        </div>
      </div>
    </CalendarTaskTooltip>
  );
}
